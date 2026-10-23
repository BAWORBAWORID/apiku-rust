use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use std::collections::HashMap;
use serde_json::json;
use serde_json::Value;
use reqwest::header;
// AlightMotion Preset v2 — native conversion of api/am/presetv2.js + src/utils/amService.js

// Firebase / Alight Motion constants (dibawa dari JS — API key ada di source Node)
const API_KEY: &str = "AIzaSy...CEq0";
const API_KEY_WEB: &str = "AIzaSy...6Ki0";
const IDT_V3: &str = "https://www.googleapis.com/identitytoolkit/v3/relyingparty";
const FIREBASE_AUTH_BASE: &str = "https://identitytoolkit.googleapis.com/v1/accounts";
const ALIGHT_CONTINUE_URL: &str = "https://alightcreative.com/am/auth/finish";
const CLOUD_FUNCTIONS_BASE: &str = "https://us-central1-alight-creative.cloudfunctions.net";
const VERIFY_PURCHASE_URL: &str = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";
const PRODUCT_ID: &str = "am.full.sub.annual.19q4";
const PURCHASE_TOKEN: &str = "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
const SKU_TYPE: &str = "subs";
const FIREBASE_INSTANCE_ID_TOKEN: &str = "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";
const UA: &str = "Mozilla/5.0 (Linux; Android 13; Redmi Note 7 Build/TQ3A.230901.001.B1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36";

fn android_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("content-type", "application/json".parse().unwrap());
    h.insert("x-android-package", "com.alightcreative.motion".parse().unwrap());
    h.insert("x-android-cert", "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8".parse().unwrap());
    h.insert(header::USER_AGENT, "Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)".parse().unwrap());
    h
}

fn generate_code_order() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut r = |len: usize| (0..len).map(|_| rng.gen_range(0..10).to_string()).collect::<String>();
    format!("GPA.{}.{}.{}.{}", r(4), r(4), r(4), r(5))
}

/// Ekstrak oobCode dari full URL maupun kode telanjang (decode nested sampai 3x).
fn extract_oob_code(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    let mut clean = raw.trim().to_string();
    for _ in 0..3 {
        let decoded = urlencoding::decode(&clean).map(|s| s.to_string()).unwrap_or_else(|_| clean.clone());
        if decoded == clean {
            break;
        }
        clean = decoded;
    }
    let re = regex::Regex::new(r#"(?:[?&])?oobCode=([a-zA-Z0-9_-]+)"#).unwrap();
    if let Some(m) = re.captures(&clean) {
        return Some(m.get(1).unwrap().as_str().to_string());
    }
    if clean.len() >= 30 && clean.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Some(clean);
    }
    None
}

fn extract_api_key(raw: &str) -> String {
    let mut clean = raw.trim().to_string();
    for _ in 0..3 {
        let decoded = urlencoding::decode(&clean).map(|s| s.to_string()).unwrap_or_else(|_| clean.clone());
        if decoded == clean {
            break;
        }
        clean = decoded;
    }
    let re = regex::Regex::new(r#"(?:[?&])?apiKey=([a-zA-Z0-9_-]+)"#).unwrap();
    re.captures(&clean)
        .and_then(|m| m.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| API_KEY.to_string())
}

/// Apply premium via verifyPurchase cloud function.
async fn apply_premium(
    client: &reqwest::Client,
    id_token: &str,
    order_id: Option<String>,
) -> Result<Value, String> {
    let final_order = order_id.unwrap_or_else(generate_code_order);
    let res = client
        .post(VERIFY_PURCHASE_URL)
        .header("authorization", format!("Bearer {id_token}"))
        .header("firebase-instance-id-token", FIREBASE_INSTANCE_ID_TOKEN)
                    .header("content-type", "application/json; charset=utf-8")
                    .header("user-agent", "okhttp/3.12.1")
        .json(&json!({
            "data": {
                "productId": PRODUCT_ID,
                "token": PURCHASE_TOKEN,
                "skuType": SKU_TYPE,
                "orderId": final_order
            }
        }))
        .send()
        .await
        .map_err(|e| format!("verifyPurchase gagal: {e}"))?;

    let mut data: Value = res.json().await.unwrap_or_else(|_| json!({}));
    if let Value::Object(o) = &mut data {
        o.insert("applied_order_id".to_string(), Value::String(final_order));
    }
    Ok(data)
}

// AlightMotion Preset Finder v2 — native conversion of api/am/presetv2.js.
// Pure GET ke bintangapi.my.id/api/amfind/ dan petakan field ke format Node.

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body.map(|Json(v)| v));
    let input_url = match p_str(&params, &["url", "link"]) {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi (URL video TikTok)"),
    };
    if !input_url.to_lowercase().contains("tiktok.com") {
        return jerr(StatusCode::BAD_REQUEST, "URL tidak valid. Masukkan URL video TikTok yang benar.");
    }

    let client = http_client(90);
    let upstream: Value = match client
        .get("https://bintangapi.my.id/api/amfind/")
        .query(&[("url", input_url.as_str())])
                    .header("origin", "https://starlabs.biz.id")
                    .header("referer", "https://starlabs.biz.id/")
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal memproses pencarian preset Alight Motion: {e}")),
        },
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal memproses pencarian preset Alight Motion: {e}")),
    };

    if !upstream.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        let msg = upstream
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Preset Alight Motion tidak ditemukan untuk video ini");
        return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "message": msg }))).into_response();
    }

    let d = upstream.get("data").cloned().unwrap_or(json!({}));
    let preset_items = d.pointer("/preset/items").cloned().unwrap_or(json!([]));
    let is_found = preset_items.as_array().map(|a| !a.is_empty()).unwrap_or(false);
    let _ = UA;

    Json(json!({
        "status": true,
        "found": is_found,
        "message": if is_found { "Preset Alight Motion berhasil ditemukan" } else { "Preset tidak ditemukan pada video ini" },
        "result": {
            "query_url": d.get("query_url").cloned().unwrap_or(Value::String(input_url)),
            "found_in": d.get("found_in").cloned().unwrap_or(Value::Null),
            "source": d.get("source").cloned().unwrap_or(Value::Null),
            "presets": preset_items,
            "preset_info": d.get("preset").cloned().unwrap_or(Value::Null),
            "total_comments_scanned": d.get("total_comments_scanned").cloned().unwrap_or(json!(0)),
            "video": d.get("video").map(|v| json!({
                "id": v.get("id").cloned().unwrap_or(Value::Null),
                "caption": v.get("caption").cloned().unwrap_or(Value::Null),
                "duration": v.get("duration").cloned().unwrap_or(Value::Null),
                "views": v.get("views").cloned().unwrap_or(Value::Null),
                "likes": v.get("likes").cloned().unwrap_or(Value::Null),
                "comments": v.get("comments").cloned().unwrap_or(Value::Null),
                "shares": v.get("shares").cloned().unwrap_or(Value::Null),
                "created_at": v.get("created_at").cloned().unwrap_or(Value::Null),
                "play_url": v.get("play_url").cloned().unwrap_or(Value::Null),
                "play_hd_url": v.get("play_hd_url").cloned().unwrap_or(Value::Null),
                "play_wm_url": v.get("play_wm_url").cloned().unwrap_or(Value::Null),
                "audio_url": v.get("audio_url").cloned().unwrap_or(Value::Null),
                "url": v.get("url").cloned().unwrap_or(Value::Null)
            })).unwrap_or(Value::Null),
            "user": d.get("user").cloned().unwrap_or(Value::Null),
            "thumbnail": d.get("thumbnail").cloned().unwrap_or(Value::Null)
        }
    })).into_response()

}

fn merge_params(query: HashMap<String, String>, body: Option<Value>) -> serde_json::Map<String, Value> {
    let mut map = serde_json::Map::new();
    for (k, v) in &query { map.insert(k.clone(), serde_json::json!(v)); }
    if let Some(Value::Object(b)) = body { for (k, v) in b { map.insert(k, v); } }
    map
}

fn http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent("Mozilla/5.0 (Linux; Android 13; Redmi Note 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .expect("client")
}

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "status": false, "message": msg }))).into_response()
}

fn p_str(params: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(v) = params.get(*k) {
            if let Some(s) = v.as_str() {
                if !s.trim().is_empty() { return Some(s.trim().to_string()); }
            }
        }
    }
    None
}

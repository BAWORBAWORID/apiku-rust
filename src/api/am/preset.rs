use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use std::collections::HashMap;
use serde_json::json;
use serde_json::Value;
use reqwest::header;
// AlightMotion Preset — native conversion of api/am/preset.js + src/utils/amService.js

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

// AlightMotion Preset Finder — native conversion of api/am/preset.js.
// SSE dari amfinder.web.id/api/find -> ambil event result; video tanpa watermark
// di-download lalu di-upload ke uguu.se (multipart) agar link permanen.
const BASE: &str = "https://amfinder.web.id";

/// Baca stream SSE sampai event "result", parse JSON-nya.
async fn find_presets_sse(client: &reqwest::Client, tiktok_url: &str) -> Result<Value, String> {
    let endpoint = format!("{BASE}/api/find?url={}", urlencoding::encode(tiktok_url));
    let res = client
        .get(&endpoint)
                    .header("accept", "text/event-stream")
        .header("referer", format!("{BASE}/"))
        .header("origin", BASE)
                    .header("cache-control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("Koneksi timeout ke upstream AMFinder: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Upstream AMFinder HTTP {}", res.status().as_u16()));
    }

    let mut buffer = String::new();
    let mut last_event = String::new();
    let mut stream = res;

    loop {
        let chunk = tokio::time::timeout(std::time::Duration::from_secs(60), stream.chunk())
            .await
            .map_err(|_| "Timeout menunggu result AMFinder".to_string())?
            .map_err(|e| format!("stream error: {e}"))?;
        let Some(bytes) = chunk else {
            return Err("Stream selesai tanpa hasil result".into());
        };
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..pos + 1).collect();
            let line = line.trim();
            if let Some(ev) = line.strip_prefix("event: ") {
                last_event = ev.trim().to_string();
                continue;
            }
            if let Some(raw) = line.strip_prefix("data: ") {
                if last_event != "result" {
                    continue;
                }
                if let Ok(j) = serde_json::from_str::<Value>(raw) {
                    return Ok(j);
                }
                return Err("Gagal mengurai respons JSON dari upstream".into());
            }
        }
    }
}

/// Upload buffer ke uguu.se, kembalikan URL (best-effort).
async fn upload_uguu(client: &reqwest::Client, buffer: bytes::Bytes, filename: &str) -> Option<String> {
    let part = reqwest::multipart::Part::bytes(buffer.to_vec()).file_name(filename.to_string());
    let form = reqwest::multipart::Form::new().part("files[]", part);
    let res = client
        .post("https://uguu.se/upload.php")
        .header("user-agent", UA)
        .multipart(form)
        .send()
        .await
        .ok()?;
    let data: Value = res.json().await.ok()?;
    data.pointer("/files/0/url")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body.map(|Json(v)| v));
    let input_url = match p_str(&params, &["url", "link"]) {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi (URL video TikTok)"),
    };
    if !input_url.to_lowercase().contains("tiktok.com") {
        return jerr(StatusCode::BAD_REQUEST, "URL tidak valid. Masukkan URL video TikTok yang benar.");
    }

    let client = http_client(120);
    let data = match find_presets_sse(&client, &input_url).await {
        Ok(d) => d,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    // Video no-wm: download lalu upload ke uguu
    let mut video_no_wm: Value = Value::Null;
    let target = data
        .pointer("/video/playUrlNoWm")
        .or_else(|| data.pointer("/video/playUrl"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(target) = target {
        let buf = match client
            .get(&target)
            .header("user-agent", UA)
            .send()
            .await
        {
            Ok(r) => r.bytes().await.ok(),
            Err(_) => None,
        };
        match buf {
            Some(buf) => {
                video_no_wm = upload_uguu(
                    &client,
                    buf,
                    &format!("tiktok_{}.mp4", data.pointer("/video/id").and_then(|i| i.as_str()).unwrap_or("video")),
                )
                .await
                .map(Value::String)
                .unwrap_or(Value::String(target.clone()));
            }
            _ => video_no_wm = Value::String(target),
        }
    }

    let found = data.get("found").and_then(|f| f.as_bool()).unwrap_or(false);
    Json(json!({
        "status": true,
        "found": found,
        "message": data.get("message").cloned().unwrap_or(Value::String(
            if found { "Preset ditemukan".into() } else { "Preset tidak ditemukan".into() }
        )),
        "author": data.get("author").cloned().unwrap_or(Value::Null),
        "videoUrl": data.get("videoUrl").cloned().unwrap_or(Value::Null),
        "video": video_no_wm,
        "presets": data.get("presetLinks").cloned().unwrap_or(json!([])),
        "otherLinks": data.get("otherLinks").cloned().unwrap_or(json!([])),
        "description": data.pointer("/video/description").and_then(|d| d.as_str()).map(|s| s.trim().to_string()),
        "stats": data.pointer("/video/stats").cloned().unwrap_or(Value::Null),
        "cover": data.pointer("/video/cover").cloned().unwrap_or(Value::Null),
        "authorDetail": data.get("authorDetail").cloned().unwrap_or(Value::Null),
        "checked": data.get("checked").cloned().unwrap_or(Value::Null)
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

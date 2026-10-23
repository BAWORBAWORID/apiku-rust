use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use std::collections::HashMap;
use serde_json::json;
use serde_json::Value;
use reqwest::header;
// AlightMotion Bulk — native conversion of api/am/bulk.js + src/utils/amService.js

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

// AlightMotion Bulk — native conversion of api/am/bulk.js.
// Respons instan { email, status, inboxUrl, orderId } per akun; proses magic-link,
// polling inbox generator.email, verifikasi & apply premium berjalan di background (spawned task).
const ACTIVE_DOMAINS: [&str; 8] = [
    "hungtpt.site", "samvix.life", "capcut.space", "minexpool.cloud",
    "kunseller.top", "evilgodshop.uk", "skyserver.cyou", "villastream.xyz",
];

fn rand_alnum(n: usize) -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..n).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

/// Generator.email inbox HTML polling: cari link verifikasi firebase/alight.
async fn wait_verify_link(client: &reqwest::Client, email: &str, max_attempts: usize) -> Option<String> {
    let patterns = [
        regex::Regex::new(r#"https://alight-creative\.firebaseapp\.com/__/auth/links\?link=[^\"'>\s]+"#).ok()?,
        regex::Regex::new(r#"https://alightcreative\.com/auth_action/\?[^\"'>\s]*oobCode=[^\"'>\s&]+"#).ok()?,
    ];
    for _ in 0..max_attempts {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let user = email.split('@').next().unwrap_or_default();
        let domain = email.split('@').nth(1).unwrap_or_default();
        let url = format!("https://generator.email/{domain}/{user}");
        if let Ok(res) = client.get(&url).send().await {
            if let Ok(html) = res.text().await {
                for p in &patterns {
                    if let Some(m) = p.captures(&html) {
                        return Some(m.get(0).unwrap().as_str().replace("&amp;", "&"));
                    }
                }
            }
        }
    }
    None
}

async fn verify_and_fetch_profile(client: &reqwest::Client, email: &str, link: &str) -> Result<(String, Value), String> {
    let oob = extract_oob_code(link).ok_or("Gagal mengekstrak oobCode.")?;
    let signin: Value = client
        .post(format!("{IDT_V3}/emailLinkSignin?key={API_KEY}"))
        .headers(android_headers())
        .json(&json!({ "email": email, "oobCode": oob, "clientType": "CLIENT_TYPE_ANDROID" }))
        .send()
        .await
        .map_err(|e| format!("emailLinkSignin gagal: {e}"))?
        .json()
        .await
        .map_err(|e| format!("emailLinkSignin gagal: {e}"))?;
    let id_token = signin
        .get("idToken")
        .and_then(|v| v.as_str())
        .ok_or("Verifikasi login gagal")?
        .to_string();

    let account: Value = client
        .post(format!("{IDT_V3}/getAccountInfo?key={API_KEY}"))
        .headers(android_headers())
        .json(&json!({ "idToken": id_token }))
        .send()
        .await
        .map_err(|e| format!("getAccountInfo gagal: {e}"))?
        .json()
        .await
        .map_err(|e| format!("getAccountInfo gagal: {e}"))?;
    Ok((id_token, account.pointer("/users/0").cloned().unwrap_or(Value::Null)))
}

async fn send_magic_link_v3_quiet(client: &reqwest::Client, email: &str) -> Result<(), String> {
    let res = client
        .post(format!("{IDT_V3}/getOobConfirmationCode?key={API_KEY}"))
        .headers(android_headers())
        .json(&json!({
            "requestType": 6,
            "email": email,
            "androidInstallApp": true,
            "canHandleCodeInApp": true,
            "continueUrl": "https://alightcreative.com?ui_sid=0366624874&ui_sd=0",
            "iosBundleId": "com.alightcreative.motion",
            "androidPackageName": "com.alightcreative.motion",
            "androidMinimumVersion": "585",
            "clientType": "CLIENT_TYPE_ANDROID"
        }))
        .send()
        .await
        .map_err(|e| format!("getOobConfirmationCode gagal: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    Ok(())
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body.map(|Json(v)| v));
    let count = params
        .get("count")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1);
    let n = count.clamp(1, 20);

    let client = http_client(60);

    // 1. Generate akun & orderId instan
    let mut results: Vec<Value> = Vec::with_capacity(n);
    for i in 0..n {
        let suffix = rand_alnum(7);
        let domain = ACTIVE_DOMAINS[i % ACTIVE_DOMAINS.len()];
        let user = format!("am_{}_{suffix}", chrono::Utc::now().timestamp_millis());
        let email = format!("{user}@{domain}");
        results.push(json!({
            "email": email,
            "status": "success",
            "inboxUrl": format!("https://generator.email/{domain}/{user}"),
            "orderId": generate_code_order()
        }));
    }

    // 2. Background: send magic link -> poll inbox -> verify -> apply premium
    let bg_results = results.clone();
    let bg_client = client.clone();
    tokio::spawn(async move {
        let total = bg_results.len();
        for (i, item) in bg_results.iter().enumerate() {
            let email = item.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let order_id = item.get("orderId").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            tracing::info!("[AM Bulk BG] [{}/{}] Memproses: {email}", i + 1, total);
            let _ = send_magic_link_v3_quiet(&bg_client, &email).await;
            if let Some(link) = wait_verify_link(&bg_client, &email, 25).await {
                if let Ok((id_token, _profile)) = verify_and_fetch_profile(&bg_client, &email, &link).await {
                    let _ = apply_premium(&bg_client, &id_token, Some(order_id)).await;
                }
            }
            if i + 1 < total {
                tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
            }
        }
        tracing::info!("[AM Bulk BG] Selesai memproses seluruh {total} akun di latar belakang.");
    });

    // 3. Respon instan
    Json(json!({ "status": true, "total": n, "processing": false, "results": results })).into_response()
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

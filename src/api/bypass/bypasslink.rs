// BypassLink — native conversion of api/bypass/bypasslink.js
// Uses bypass.tools mobile API. Note: the Node version first harvests Cloudflare
// cookies via puppeteer-real-browser; native Rust cannot do that, so we call the
// API without the CF cookie (works when upstream is not challenging) and return
// an honest error when it is.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

const BYPASS_TOOLS: &str = "https://bypass.tools";
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

async fn resolve_bypass(target_url: &str, android_id: Option<&str>) -> Result<String, String> {
    let client = client()?;
    let random_id: String = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..16).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
    };
    let seed = format!("bypasstools:{}", android_id.unwrap_or(&random_id));
    let device_id = format!("{:x}", Sha256::digest(seed.as_bytes()));

    let init_res = client
        .post(format!("{}/api/mobile/init", BYPASS_TOOLS))
                    .header("Content-Type", "application/json")
        .json(&json!({
            "deviceId": device_id,
            "platform": "android",
            "appVersion": "1.0.0",
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !init_res.status().is_success() {
        return Err(format!(
            "Init session failed: HTTP {} (upstream Cloudflare challenge; butuh browser engine)",
            init_res.status()
        ));
    }
    let init_data: Value = init_res.json().await.map_err(|e| e.to_string())?;
    let session_token = init_data
        .get("sessionToken")
        .and_then(|t| t.as_str())
        .ok_or("Failed to acquire session token from bypass.tools")?;

    let bypass_res = client
        .post(format!("{}/api/mobile/bypass", BYPASS_TOOLS))
                    .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", session_token))
        .header("X-Device-ID", &device_id)
        .json(&json!({ "url": target_url, "forceRefresh": false }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = bypass_res.status();
    let bypass_data: Value = bypass_res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(bypass_data
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or(&format!("Bypass failed: HTTP {}", status))
            .to_string());
    }
    bypass_data
        .get("result")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Empty result returned from bypass.tools".to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();
    let get = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| {
                body.as_ref()
                    .and_then(|Json(v)| v.get(k).and_then(|u| u.as_str()).map(|s| s.to_string()))
            })
    };
    let url = match get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'url' wajib diisi",
                "example": {
                    "get": "/api/bypass/bypasslink?url=https://linkvertise.com/546946/mYoUbm5Ro7gU?o=sharing",
                    "post": { "url": "https://linkvertise.com/546946/mYoUbm5Ro7gU?o=sharing" },
                },
            })))
            .into_response()
        }
    };
    if url::Url::parse(&url).is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Format URL tidak valid"
        })))
        .into_response();
    }
    if url.to_lowercase().contains("tinyurl.com") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Layanan ini tidak mendukung bypass shortlink TinyURL (https://tinyurl.com/...)"
        })))
        .into_response();
    }
    let android_id = get("androidId");

    match resolve_bypass(&url, android_id.as_deref()).await {
        Ok(bypassed) => Json(json!({
            "status": true,
            "result": {
                "originalUrl": url,
                "bypassedUrl": bypassed,
                "responseTime": format!("{}ms", started.elapsed().as_millis()),
            }
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": e,
            "result": { "responseTime": format!("{}ms", started.elapsed().as_millis()) }
        })))
        .into_response(),
    }
}

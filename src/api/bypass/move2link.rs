// Move2link Bypass — native conversion of api/bypass/move2link.js
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const CSRF_TOKEN: &str = "f62i45iojk53j53kjqnfa";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn extract_slug(url_or_slug: &str) -> Option<String> {
    let cleaned = url_or_slug.trim();
    if cleaned.starts_with("http://") || cleaned.starts_with("https://") {
        let parsed = url::Url::parse(cleaned).ok()?;
        let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
        return segments.last().map(|s| s.to_string());
    }
    Some(cleaned.to_string())
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let part = token.split('.').nth(1)?;
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, part)
        .ok()
        .or_else(|| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, part).ok())?;
    serde_json::from_slice(&decoded).ok()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

async fn bypass_move2link(url_or_slug: &str) -> Result<Value, String> {
    let slug = extract_slug(url_or_slug)
        .filter(|s| !s.is_empty())
        .ok_or("Invalid move2link URL or slug provided")?;
    let client = client()?;

    let bypass_url = format!("https://api.move2link.com/{}", slug);
    let no_redirect_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let initial = no_redirect_client
        .get(&bypass_url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let location = initial
        .headers()
        .get("location")
        .and_then(|l| l.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Failed to get redirect token (status {})", initial.status()))?;
    if location.contains("link-not-found") {
        return Err("Shortlink not found or has expired".to_string());
    }

    let token = url::Url::parse(&location)
        .ok()
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v.to_string())
        })
        .ok_or("Missing token in redirection URL")?;
    let payload = decode_jwt_payload(&token).ok_or("Invalid JWT token received")?;

    let mut token = token;
    let mut current_step: i64 = payload
        .get("step")
        .and_then(|s| s.as_str().and_then(|s| s.parse().ok()).or_else(|| s.as_i64()))
        .unwrap_or(0);
    let max_step: i64 = payload
        .get("max_step")
        .and_then(|s| s.as_str().and_then(|s| s.parse().ok()).or_else(|| s.as_i64()))
        .unwrap_or(3);

    while current_step < max_step - 1 {
        let track_res = client
            .put("https://m2l-api.siendu.com/api/v1/views/track")
                        .header("Content-Type", "application/json")
            .header("User-Agent", UA)
            .body(
                json!({ "token": token, "csrf_token": CSRF_TOKEN, "imps": [1200, 1500, 1800] })
                    .to_string(),
            )
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !track_res.status().is_success() {
            return Err(format!("Track step {} failed: {}", current_step, track_res.status()));
        }
        let track_json: Value = track_res.json().await.map_err(|e| e.to_string())?;
        token = track_json
            .pointer("/data/token")
            .and_then(|t| t.as_str())
            .ok_or(format!("Missing token in track step {}", current_step))?
            .to_string();
        current_step += 1;
    }

    let finalize_res = client
        .post("https://m2l-api.siendu.com/api/v1/views/finalize")
                    .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .body(
            json!({ "token": token, "csrf_token": CSRF_TOKEN, "imps": [1200, 1500, 1800] })
                .to_string(),
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !finalize_res.status().is_success() {
        return Err(format!("Finalize step failed: {}", finalize_res.status()));
    }
    let finalize_json: Value = finalize_res.json().await.map_err(|e| e.to_string())?;
    let final_redirect = finalize_json
        .pointer("/data/redirect_url")
        .and_then(|u| u.as_str())
        .ok_or("Finalize did not return a redirect URL")?
        .to_string();

    Ok(json!({
        "success": true,
        "slug": slug,
        "originalUrl": url_or_slug,
        "destinationUrl": final_redirect,
        "stepsPassed": max_step,
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let url_param = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });
    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "error": "Parameter 'url' wajib diisi",
                "example": "https://move2link.com/abc123"
            })))
            .into_response()
        }
    };

    let now = chrono::Utc::now().to_rfc3339();
    match bypass_move2link(&url).await {
        Ok(result) => Json(json!({ "status": true, "result": result, "timestamp": now })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": e, "timestamp": now
        })))
        .into_response(),
    }
}

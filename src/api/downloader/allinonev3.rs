// All-In-One Downloader v3 — native conversion of api/downloader/allinonev3.js
// Flow: HEAD-resolve redirect → detect platform → GET downloadin.web.id proxy API.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn detect_platform(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains("tiktok.com") || lower.contains("douyin.com") { return "tiktok"; }
    if lower.contains("instagram.com") { return "instagram"; }
    if lower.contains("youtube.com") || lower.contains("youtu.be") { return "youtube"; }
    if lower.contains("facebook.com") || lower.contains("fb.watch") || lower.contains("fb.com") { return "facebook"; }
    if lower.contains("twitter.com") || lower.contains("x.com") { return "twitter"; }
    if lower.contains("threads.net") { return "threads"; }
    if lower.contains("pinterest.com") || lower.contains("pin.it") { return "pinterest"; }
    if lower.contains("spotify.com") { return "spotify"; }
    if lower.contains("soundcloud.com") { return "soundcloud"; }
    if lower.contains("capcut.com") { return "capcut"; }
    if lower.contains("snackvideo.com") { return "snackvideo"; }
    if lower.contains("linkedin.com") { return "linkedin"; }
    "tiktok"
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "platform"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "error": "Parameter 'url' wajib diisi."
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": e.to_string()
        }))).into_response(),
    };

    // resolveUrl via HEAD redirect-follow
    let target_url = client
        .head(&url)
        .header("User-Agent", UA)
        .send()
        .await
        .ok()
        .map(|r| r.url().to_string())
        .unwrap_or_else(|| url.clone());

    let selected_platform = merged
        .get("platform")
        .map(|s| s.to_string())
        .unwrap_or_else(|| detect_platform(&target_url).to_string());

    let api = format!(
        "https://www.downloadin.web.id/api/download-proxy?platform={}&url={}",
        urlencoding::encode(&selected_platform),
        urlencoding::encode(&target_url)
    );

    let resp = match client
        .get(&api)
        .header("User-Agent", UA)
                    .header("Referer", "https://www.downloadin.web.id/")
                    .header("Origin", "https://www.downloadin.web.id")
                    .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": format!("Terjadi kesalahan pada server saat memproses unduhan: {e}")
        }))).into_response(),
    };

    let status = resp.status();
    if !status.is_success() {
        return (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(json!({
            "status": false,
            "error": format!("Gagal mengambil data media (HTTP {})", status.as_u16())
        }))).into_response();
    }

    let result: Value = resp.json().await.unwrap_or(Value::Null);

    Json(json!({
        "status": true,
        "platform": selected_platform,
        "result": result
    })).into_response()

}

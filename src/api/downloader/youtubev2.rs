// YouTube Downloader v2 (VidsSave) — native conversion of api/downloader/youtubev2.js
// Provider: api.vidssave.com/api/contentsite_api/media/parse (form POST)
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const PARSE_URL: &str = "https://api.vidssave.com/api/contentsite_api/media/parse";
const AUTH: &str = "20250901majwlqo";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengunduh video YouTube: {e}"),
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    let form = [
        ("auth", AUTH),
        ("domain", "api-ak.vidssave.com"),
        ("origin", "cache"),
        ("link", url.as_str()),
    ];
    let data: Value = match client
        .post(PARSE_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": format!("Gagal mengunduh video YouTube: {e}"),
                "timestamp": chrono::Utc::now().timestamp_millis()
            }))).into_response(),
        },
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengunduh video YouTube: {e}"),
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    let ok = data.get("status").and_then(|s| s.as_i64()) == Some(1)
        && data.get("status_code").and_then(|s| s.as_str()) == Some("success");
    let media = data.get("data");
    if !ok || media.is_none() {
        let msg = data.get("msg").and_then(|m| m.as_str()).unwrap_or("Gagal memproses link video.");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response();
    }
    let d = media.unwrap();

    let downloads: Vec<Value> = d
        .get("resources")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            let size = item.get("size").and_then(|s| s.as_f64()).unwrap_or(0.0);
            json!({
                "quality": item.get("quality"),
                "format": item.get("format"),
                "type": item.get("type"),
                "size": item.get("size"),
                "size_formatted": format!("{:.2} MB", size / (1024.0 * 1024.0)),
                "download_url": item.get("download_url")
            })
        })
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "title": d.get("title").cloned().unwrap_or(json!("YouTube Video")),
            "duration": d.get("duration").cloned().unwrap_or(json!(0)),
            "thumbnail": d.get("thumbnail").cloned().unwrap_or(json!("")),
            "downloads": downloads
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()

}

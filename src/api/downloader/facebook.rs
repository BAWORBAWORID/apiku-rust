// Facebook Downloader — native conversion of api/downloader/facebook.js
// Provider: getmyfb.com/process (form id+locale) → scrape hasil HTML
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const ENDPOINT: &str = "https://getmyfb.com/process";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

fn extract_result(html: &str) -> Option<Value> {
    let thumbnail = html
        .split("results-item-image")
        .nth(1)
        .and_then(|s| s.split("src=\"").nth(1))
        .and_then(|s| s.split('"').next())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let title = html
        .split("results-item-text")
        .nth(1)
        .and_then(|s| s.split('>').nth(1))
        .and_then(|s| s.split('<').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut hd = None;
    let mut sd = None;
    let mut mp3 = None;

    let mut rest = html;
    while let Some(idx) = rest.find("results-list-item") {
        let after = &rest[idx..];
        let end = after.find("</li>").unwrap_or(after.len().min(2000));
        let block = &after[..end];
        let href = block
            .split("href=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
            .map(|s| s.to_string());
        let text = block.to_lowercase();
        if let Some(link) = href {
            if text.contains("720p") {
                hd = Some(link);
            } else if text.contains("360p") {
                sd = Some(link);
            } else if text.contains("mp3") {
                mp3 = Some(link);
            }
        }
        rest = &after[end..];
    }

    if hd.is_none() && sd.is_none() && mp3.is_none() {
        return None;
    }
    Some(json!({
        "thumbnail": thumbnail,
        "title": title,
        "hd": hd,
        "sd": sd,
        "mp3": mp3
    }))
}

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
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": format!("Gagal mengunduh video Facebook: {e}")
        }))).into_response(),
    };

    let html = match client
        .post(ENDPOINT)
                    .header("HX-Request", "true")
                    .header("HX-Trigger", "form")
                    .header("HX-Target", "target")
                    .header("HX-Current-URL", "https://getmyfb.com/id")
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("Referer", "https://getmyfb.com/id")
        .body(format!("id={}&locale=id", urlencoding::encode(&url)))
        .send()
        .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": format!("Gagal mengunduh video Facebook: {e}")
        }))).into_response(),
    };

    match extract_result(&html) {
        Some(result) => Json(json!({ "status": true, "result": result })).into_response(),
        None => (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Video Facebook tidak ditemukan"
        }))).into_response(),
    }
}

// Google Drive Downloader — native conversion of api/downloader/gdrive.js
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

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
            "status": false, "message": "URL wajib diisi"
        }))).into_response(),
    };

    if !url.contains("drive.google.com/file/d/") {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "GDrive: Invalid URL",
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response();
    }

    // id = 5th path segment (url.split("/")[5])
    let id = url.split('/').nth(5).unwrap_or("").to_string();

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("GDrive: {e}"),
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response(),
    };

    let name = match client
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
    {
        Ok(r) => {
            let html = r.text().await.unwrap_or_default();
            html.find("<title>")
                .and_then(|i| {
                    let rest = &html[i + 7..];
                    let t = rest.split('<').next().unwrap_or("").trim().to_string();
                    Some(t.split('-').next().unwrap_or("").trim().to_string())
                })
                .unwrap_or_default()
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("GDrive: {e}"),
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response(),
    };

    Json(json!({
        "status": true,
        "data": {
            "name": name,
            "download": format!("https://drive.usercontent.google.com/uc?id={id}&export=download"),
            "link": url,
            "id": id
        },
        "timestamp": chrono::Utc::now().to_rfc3339()
    })).into_response()

}

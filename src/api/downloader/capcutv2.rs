// CapCut Downloader v2 (3bic.com) — native conversion of api/downloader/capcutv2.js
use axum::{
    extract::{Query, Json as AxumJson},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://3bic.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";

fn is_capcut(url: &str) -> bool {
    // watch / template-detail / t / tv2 paths
    let rest = url.strip_prefix("https://").unwrap_or(url);
    let rest = rest.strip_prefix("www.").unwrap_or(rest);
    let lower = rest.to_lowercase();
    lower.starts_with("capcut.com/watch/")
        || lower.starts_with("capcut.com/template-detail/")
        || lower.starts_with("capcut.com/t/")
        || lower.starts_with("capcut.com/tv2/")
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
        _ => return Json(json!({ "status": false, "message": "Parameter 'url' wajib diisi" })).into_response(),
    };

    if !is_capcut(&url) {
        return Json(json!({
            "status": false,
            "message": "URL tidak valid. Pastikan URL berasal dari CapCut (capcut.com)."
        })).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(json!({ "status": false, "message": e.to_string() })).into_response(),
    };

    let data: Value = match client
        .post(format!("{BASE_URL}/api/download"))
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .header("Referer", format!("{BASE_URL}/"))
        .header("Origin", BASE_URL)
        .json(&json!({ "url": url }))
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => return Json(json!({
            "status": false, "message": format!("Gagal mengambil data video CapCut: {e}")
        })).into_response(),
    };

    if data.get("code").and_then(|c| c.as_i64()) == Some(200) {
        let original = data.get("originalVideoUrl").and_then(|u| u.as_str()).unwrap_or("");
        let video_url = if original.starts_with("http") {
            original.to_string()
        } else {
            format!("{BASE_URL}{original}")
        };
        Json(json!({
            "status": true,
            "result": {
                "platform": "CapCut",
                "title": data.get("title").cloned().unwrap_or(json!("No Title")),
                "author": data.get("authorName").cloned().unwrap_or(json!("Unknown")),
                "cover": data.get("coverUrl"),
                "downloadLink": video_url
            }
        }))
        .into_response()
    } else {
        let msg = data.get("message").and_then(|m| m.as_str()).unwrap_or("Upstream tidak mengembalikan video");
        Json(json!({
            "status": false,
            "message": format!("Gagal mengambil data video CapCut: {msg}")
        })).into_response()
    }
}

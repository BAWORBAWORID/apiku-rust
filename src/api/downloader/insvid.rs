// Insvid YouTube Downloader — native conversion of api/downloader/insvid.js
// Provider: ac.insvid.com/converter (POST JSON {id, fileType})
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn extract_video_id(input: &str) -> Option<String> {
    let s = input.trim();
    if s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Some(s.to_string());
    }
    for key in ["youtu.be/", "/shorts/", "/embed/"] {
        if let Some(rest) = s.split(key).nth(1) {
            let id: String = rest.chars().take_while(|c| *c != '/' && *c != '?' && *c != '&').collect();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    if let Some(pos) = s.find("v=") {
        let rest = &s[pos + 2..];
        let id: String = rest.chars().take_while(|c| *c != '&' && *c != '#').collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    None
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "fileType"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }

    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "error": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    let format = merged.get("fileType").map(|s| s.to_uppercase()).unwrap_or_else(|| "MP3".into());
    if format != "MP3" && format != "MP4" {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "error": "Parameter 'fileType' harus 'MP3' atau 'MP4'"
        }))).into_response();
    }

    let video_id = match extract_video_id(&url) {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "code": 400, "input_url": url, "result_url": null,
            "error": "Invalid YouTube URL or video ID"
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "code": 500, "input_url": url, "result_url": null, "error": e.to_string()
        }))).into_response(),
    };

    let resp = client
        .post("https://ac.insvid.com/converter")
                    .header("accept", "*/*")
                    .header("content-type", "application/json")
                    .header("origin", "https://ac.insvid.com")
        .header(
            "referer",
            format!("https://ac.insvid.com/widget?url=https://www.youtube.com/watch?v={video_id}&el=147"),
        )
        .json(&json!({ "id": video_id, "fileType": format }))
        .send()
        .await;

    match resp {
        Ok(r) => {
            let data: Value = r.json().await.unwrap_or(Value::Null);
            if data.get("status").and_then(|s| s.as_str()) == Some("ok") && data.get("link").is_some() {
                Json(json!({
                    "status": true, "code": 200,
                    "input_url": url, "video_id": video_id, "file_type": format,
                    "result_url": data.get("link")
                }))
                .into_response()
            } else {
                let msg = data.get("message").and_then(|m| m.as_str()).unwrap_or("Gagal mendapatkan link download");
                (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "code": 400,
                    "input_url": url, "video_id": video_id, "result_url": null,
                    "error": msg
                }))).into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "code": 500,
            "input_url": url, "result_url": null, "error": e.to_string()
        }))).into_response(),
    }
}

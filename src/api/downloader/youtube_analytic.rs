// YouTube Downloader & Analyzer (recapio) — native conversion of api/downloader/youtube-analytic.js
// Node version drives recapio.com via browser-context session (cookies + WS chat).
// Native subset: param validation + honest NEEDS_BROWSER error — transcript/
// summary/analyze semua butuh sesi browser recapio.
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
    for key in ["youtu.be/", "/shorts/", "/embed/", "/live/"] {
        if let Some(rest) = s.split(key).nth(1) {
            let id: String = rest.chars().take_while(|c| *c != '/' && *c != '?' && *c != '&').collect();
            if id.len() == 11 {
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
        for k in ["url", "action", "prompt"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'url' wajib diisi",
            "help": "Contoh: https://youtube.com/watch?v=VIDEO_ID atau https://youtu.be/VIDEO_ID"
        }))).into_response(),
    };

    if extract_video_id(&url).is_none() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Invalid YouTube URL"
        }))).into_response();
    }

    let action = merged.get("action").cloned().unwrap_or_else(|| "summary".into());
    if !["summary", "analyze", "transcript"].contains(&action.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": format!("Unknown action: {action}")
        }))).into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "Summary/analyze/transcript via recapio.com membutuhkan sesi browser engine — belum didukung native.",
        "action": action
    }))).into_response()
}

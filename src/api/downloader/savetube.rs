// SaveTube Downloader — native conversion of api/downloader/savetube.js
// Provider: apis.davidcyril.name.ng/download/savetube (GET url+format)
use axum::{
    extract::{Query, Json as AxumJson},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_BASE: &str = "https://apis.davidcyril.name.ng/download/savetube";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const VALID_FORMATS: [&str; 6] = ["144", "240", "360", "480", "720", "1080"];

fn extract_video_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.split("youtu.be/").nth(1) {
        let id: String = rest.chars().take_while(|c| *c != '/' && *c != '?' && *c != '&').collect();
        if !id.is_empty() { return Some(id); }
    }
    if let Some(pos) = trimmed.find("v=") {
        let rest = &trimmed[pos + 2..];
        let id: String = rest.chars().take_while(|c| *c != '&' && *c != '#' && *c != '/').collect();
        if id.len() == 11 { return Some(id); }
    }
    if let Some(rest) = trimmed.split("/embed/").nth(1) {
        let id: String = rest.chars().take_while(|c| *c != '/' && *c != '?' && *c != '"').collect();
        if !id.is_empty() { return Some(id); }
    }
    None
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "format"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }

    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return Json(json!({ "status": false, "message": "Parameter 'url' wajib diisi" })).into_response(),
    };

    let video_id = match extract_video_id(&url) {
        Some(v) => v,
        None => return Json(json!({ "status": false, "message": "URL YouTube tidak valid" })).into_response(),
    };

    let fmt_raw = merged.get("format").cloned().unwrap_or_else(|| "mp3".into());
    let fmt = match fmt_raw.as_str() {
        "mp4" | "webm" => "720".to_string(),
        other => other.to_string(),
    };
    if fmt != "mp3" && !VALID_FORMATS.contains(&fmt.as_str()) {
        return Json(json!({
            "status": false,
            "message": "Format tidak didukung. Gunakan: mp3, 144, 240, 360, 480, 720, 1080"
        })).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(json!({ "status": false, "message": format!("Request timeout: {e}") })).into_response(),
    };

    let api_url = format!("{API_BASE}?url={}&format={}", urlencoding::encode(&url), urlencoding::encode(&fmt));
    let data: Value = match client.get(&api_url)            .header("Accept", "application/json").send().await {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(_) => return Json(json!({ "status": false, "message": "Invalid JSON" })).into_response(),
        },
        Err(e) => return Json(json!({ "status": false, "message": format!("Request timeout: {e}") })).into_response(),
    };

    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let d = data.get("data");
    if !success || d.is_none() {
        let msg = data.get("error").or_else(|| data.get("message")).and_then(|m| m.as_str()).unwrap_or("Gagal mengambil data");
        return Json(json!({ "status": false, "message": msg })).into_response();
    }
    let d = d.unwrap();

    Json(json!({
        "status": true,
        "result": {
            "title": d.get("title"),
            "type": d.get("type"),
            "quality": d.get("quality"),
            "duration": d.get("duration"),
            "cover": d.get("cover"),
            "videoId": video_id,
            "download_url": d.get("download_url")
        }
    })).into_response()

}

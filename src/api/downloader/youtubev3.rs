// YouTube Downloader v4 (scriptmind.co) — native conversion of api/downloader/youtubev3.js
// Node version: resolve preview → download tunnel streams → ffmpeg merge → upload.
// Native subset: resolve + metadata/tunnel URLs (param json=1 sepenuhnya native);
// merge membutuhkan ffmpeg lokal → di mode normal kembalikan tunnels supaya
// pemanggil bisa merge sendiri (jujur, tanpa proxy Node).
use axum::{
    extract::{Query, Json as AxumJson},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const RESOLVE_URL: &str = "https://scriptmind.co/api/media/resolve/preview";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "json"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return Json(json!({ "status": false, "message": "Parameter 'url' wajib diisi" })).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(json!({ "status": false, "message": format!("Gagal resolve video: {e}") })).into_response(),
    };

    let guest_id = format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        rand::random::<u8>(), rand::random::<u8>(), rand::random::<u8>(), rand::random::<u8>(),
        rand::random::<u8>(), rand::random::<u8>(),
        rand::random::<u8>(), rand::random::<u8>(),
        rand::random::<u8>(), rand::random::<u8>(),
        rand::random::<u8>(), rand::random::<u8>(), rand::random::<u8>(), rand::random::<u8>(), rand::random::<u8>(), rand::random::<u8>()
    );

    let data: Value = match client
        .post(RESOLVE_URL)
                    .header("Content-Type", "application/json")
        .json(&json!({ "url": url, "platform": "youtube", "pageType": "video", "guestId": guest_id }))
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => return Json(json!({ "status": false, "message": format!("Gagal resolve video: {e}") })).into_response(),
    };

    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    if !success || data.get("result").is_none() {
        let msg = data.get("message").and_then(|m| m.as_str()).unwrap_or("respons upstream tidak valid");
        return Json(json!({ "status": false, "message": format!("Gagal resolve video: {msg}") })).into_response();
    }
    let result = data.get("result").cloned().unwrap_or(Value::Null);

    // resolved may be a JSON string or object
    let resolved: Value = match result.get("resolved") {
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
        Some(v) => v.clone(),
        None => Value::Null,
    };

    let meta = json!({
        "title": result.get("title"),
        "duration": result.get("duration"),
        "canonicalUrl": result.get("canonicalUrl"),
        "platform": result.get("platform").cloned().unwrap_or(json!("youtube")),
        "mediaApiToken": result.get("mediaApiToken"),
        "resolvedStatus": resolved.get("status"),
        "resolveType": resolved.get("type"),
        "outputType": resolved.pointer("/output/type"),
        "filename": resolved.pointer("/output/filename"),
        "tunnels": resolved.get("tunnel").cloned().unwrap_or(json!([]))
    });

    // Node version merges via ffmpeg; native: return metadata + tunnels
    Json(json!({
        "status": true,
        "input": url,
        "result": meta,
        "note": "Mode merge ffmpeg belum didukung native — metadata + tunnel URLs dikembalikan agar bisa digabung mandiri.",
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()

}

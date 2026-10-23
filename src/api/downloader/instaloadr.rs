// Instaloadr Instagram Downloader — native conversion of api/downloader/instaloadr.js
// Provider: instaloadr.com/api/fetch (POST JSON {url, media_type})
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://www.instaloadr.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "link"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let target = merged
        .get("url")
        .or_else(|| merged.get("link"))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if target.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'url' wajib diisi. Masukkan URL post atau reels Instagram."
        }))).into_response();
    }
    let lower = target.to_lowercase();
    if !(lower.contains("instagram.com/p/") || lower.contains("instagram.com/reel/") || lower.contains("instagram.com/tv/")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "URL tidak valid. Contoh yang benar: https://www.instagram.com/reel/xxx/"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil media Instagram dari Instaloadr: {e}")
        }))).into_response(),
    };

    let data: Value = match client
        .post(format!("{BASE_URL}/api/fetch"))
                    .header("Content-Type", "application/json")
        .header("referer", format!("{BASE_URL}/"))
        .header("origin", BASE_URL)
        .json(&json!({ "url": target, "media_type": "post" }))
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": format!("Gagal mengambil media Instagram dari Instaloadr: {e}")
            }))).into_response(),
        },
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": format!("Gagal mengambil media Instagram dari Instaloadr: {e}")
        }))).into_response(),
    };

    let items = data.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
    if items.is_empty() {
        return (StatusCode::NOT_FOUND, Json(json!({
            "status": false,
            "message": "Media tidak ditemukan. Pastikan URL benar dan akun tidak privat."
        }))).into_response();
    }

    let total = items.len();
    let result: Vec<Value> = items
        .iter()
        .map(|item| {
            json!({
                "type": item.get("media_type").cloned().unwrap_or(json!("mp4")),
                "download_url": item.get("download_url").cloned().unwrap_or(Value::Null),
                "thumbnail_url": item.get("thumbnail_url").cloned().unwrap_or(Value::Null),
                "audio_url": item.get("audio_url").cloned().unwrap_or(Value::Null),
                "width": item.get("width").cloned().unwrap_or(Value::Null),
                "height": item.get("height").cloned().unwrap_or(Value::Null),
                "duration": item.get("duration").cloned().unwrap_or(Value::Null)
            })
        })
        .collect();

    Json(json!({
        "status": true,
        "source_url": data.get("source_url").cloned().unwrap_or(json!(target)),
        "total": total,
        "result": result
    })).into_response()

}

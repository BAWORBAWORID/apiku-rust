// FlacDownloader Download — native conversion of api/downloader/flac.js
// Node version: session token (sp file) + /asset download + custom Blowfish
// (inline P/S tables dari bundle flacdownloader.com) chunked decrypt.
// Blowfish S-boxes tidak lengkap di sumber (S_INIT kosong, dimuat eksternal)
// dan crate blowfish tidak ada di Cargo.toml — endpoint error jujur.
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
        for k in ["track_id", "format", "save_to_local"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let track_id = merged.get("track_id").map(|s| s.trim().to_string()).unwrap_or_default();
    if track_id.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'track_id' wajib diisi",
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "flacdownloader.com membutuhkan dekripsi Blowfish custom (S-box dari bundle situs) — belum didukung native.",
        "track_id": track_id,
        "timestamp": chrono::Utc::now().timestamp_millis()
    }))).into_response()
}

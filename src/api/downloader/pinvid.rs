// Pinterest Video Downloader — native conversion of api/downloader/pinvid.js
// Node version: parse master .m3u8 (video variant + audio media), download HLS
// segments via node-hls-downloader, merge with ffmpeg, stream file back.
// Native subset: membutuhkan HLS segment downloader + ffmpeg binary — belum
// didukung native; endpoint mengembalikan error jujur.
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
    let url = merged.get("url").cloned().unwrap_or_default();
    if url.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' (.m3u8) wajib diisi."
        }))).into_response();
    }
    if !url.contains(".m3u8") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "URL yang dimasukkan harus berformat .m3u8 (dapatkan dari hasil search /api/search/pinvid-search)."
        }))).into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "Download HLS (m3u8 → segment → merge ffmpeg) belum didukung native — butuh HLS downloader engine + ffmpeg."
    }))).into_response()
}

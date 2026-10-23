// AI Enhance HD v6 — native conversion of api/imagehd/ai-enhancev6.js
// Visual Paradigm super-resolution via multipart POST -> image bytes back.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_URL: &str = "https://ai-services.visual-paradigm.com/api/super-resolution/file";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn bin_response(bytes: Vec<u8>, content_type: &str, extra: &[(&str, String)]) -> Response {
    let mut b = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type);
    for (k, v) in extra {
        b = b.header(*k, v);
    }
    b.body(axum::body::Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let url_param = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });

    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let image_buffer = match client
        .get(&url)
        .header("User-Agent", BROWSER_UA)
        
        .send()
        .await
    {
        Ok(r) => match r.bytes().await {
            Ok(b) => b.to_vec(),
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal download gambar: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal download gambar: {e}")),
    };

    let part = match reqwest::multipart::Part::bytes(image_buffer)
        .file_name("image.jpg")
        .mime_str("image/jpeg")
    {
        Ok(p) => p,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let form = reqwest::multipart::Form::new().part("file", part);

    let res = match client
        .post(API_URL)
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let status = res.status().as_u16();
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.unwrap_or_default().to_vec();

    if status != 200 {
        let msg = String::from_utf8_lossy(&bytes);
        let preview: String = msg.chars().take(200).collect();
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Visual Paradigm returned {status}: {preview}"),
        );
    }
    if !ct.contains("image") {
        let text = String::from_utf8_lossy(&bytes);
        let preview: String = text.chars().take(200).collect();
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Unexpected response type {ct}: {preview}"),
        );
    }

    bin_response(bytes, "image/jpeg", &[("X-Enhance-Service", "visual-paradigm-v6".to_string())])
}

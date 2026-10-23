// Photoihancer — native conversion of api/imagehd/photoihancer.js
// ihancer.com/api/enhance: download image -> multipart POST -> return enhanced bytes.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn merge_params(query: HashMap<String, String>, body: Option<Json<Value>>) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in query {
        m.insert(k, Value::String(v));
    }
    if let Some(Json(b)) = body {
        if let Value::Object(o) = b {
            for (k, v) in o {
                m.insert(k, v);
            }
        }
    }
    Value::Object(m)
}

fn validate_image(buffer: &[u8]) -> Result<(), String> {
    if buffer.len() < 8 {
        return Err("Gagal download gambar".to_string());
    }
    let sig = &buffer[..8.min(buffer.len())];
    let is_valid = sig.starts_with(&[0xff, 0xd8, 0xff])
        || sig.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        || sig.starts_with(b"GIF8")
        || sig.starts_with(b"RIFF")
        || sig.starts_with(&[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79]);
    if !is_valid {
        return Err("URL bukan gambar valid (jpg/png/gif/webp)".to_string());
    }
    Ok(())
}

async fn enhance(buffer: Vec<u8>, method: i64) -> Result<Vec<u8>, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name("file.jpg")
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("method", method.to_string())
        .text("is_pro_version", "true")
        .text("is_enhancing_more", "false")
        .text("max_image_size", "high")
        .part("file", part);

    let res = cl
        .post("https://ihancer.com/api/enhance")
        .header("User-Agent", UA)
                    .header("Referer", "https://ihancer.com/app/")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    if !status.is_success() {
        return Err(format!("Upstream {} {}", status.as_u16(), status.canonical_reason().unwrap_or("")));
    }
    let out = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    if out.is_empty() {
        return Err("Upstream balas kosong".to_string());
    }
    Ok(out)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let params = merge_params(query, body);
    let url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    let mut method = params
        .get("method")
        .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64()))
        .unwrap_or(1);
    if method < 1 {
        method = 1;
    }

    let cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let dl = match cl.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let src = match dl.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if let Err(e) = validate_image(&src) {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }

    let out = match enhance(src, method).await {
        Ok(o) => o,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    Response::builder()
        .status(StatusCode::OK)
                    .header("Content-Type", "image/jpeg")
                    .header("X-Enhance-Service", "ihancer")
        .header("X-Enhance-Method", method.to_string())
        .header("Content-Length", out.len().to_string())
        .body(axum::body::Body::from(out))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

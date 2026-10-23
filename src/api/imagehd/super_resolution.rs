// AI Super Resolution — native conversion of api/imagehd/super-resolution.js
// Visual Paradigm: download image -> multipart POST -> return enhanced image bytes.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

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

async fn enhance_image(buffer: Vec<u8>) -> Result<Vec<u8>, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name("image.jpg")
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let res = cl
        .post("https://ai-services.visual-paradigm.com/api/super-resolution/file")
                    .header("origin", "https://online.visual-paradigm.com")
                    .header("referer", "https://online.visual-paradigm.com/")
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
        )
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
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

    // 1. Download input image
    let dl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match dl
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let image_buffer = match res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if image_buffer.len() < 100 {
        return jerr(StatusCode::BAD_REQUEST, "Gagal mendownload gambar dari URL yang diberikan");
    }

    // 2. Process super resolution
    let enhanced = match enhance_image(image_buffer).await {
        Ok(b) => b,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    if enhanced.len() < 100 {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Proses super resolution gagal atau hasil kosong");
    }

    Response::builder()
        .status(StatusCode::OK)
                    .header("Content-Type", "image/jpeg")
        .header("Content-Length", enhanced.len().to_string())
                    .header("X-Enhance-Service", "visual-paradigm")
        .body(axum::body::Body::from(enhanced))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

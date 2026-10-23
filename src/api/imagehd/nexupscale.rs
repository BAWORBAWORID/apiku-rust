// NexUpscale — native conversion of api/imagehd/nexupscale.js
// nexupscaleid.vercel.app: prepare base64 -> POST -> download result image.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_URL: &str = "https://nexupscaleid.vercel.app/api/upscale";
const MODES: [&str; 4] = ["hd", "ultrahd", "4x", "4xv2"];
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

fn mime_from_buffer(buf: &[u8]) -> &'static str {
    if buf.len() >= 2 && buf[0] == 0xff && buf[1] == 0xd8 {
        return "image/jpeg";
    }
    if buf.len() >= 2 && buf[0] == 0x89 && buf[1] == 0x50 {
        return "image/png";
    }
    if buf.len() >= 3 && buf[0] == 0x52 && buf[1] == 0x49 && buf[2] == 0x46 {
        return "image/webp";
    }
    if buf.len() >= 2 && buf[0] == 0x42 && buf[1] == 0x4d {
        return "image/bmp";
    }
    "image/jpeg"
}

fn to_data_url(buf: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{};base64,{}",
        mime_from_buffer(buf),
        base64::engine::general_purpose::STANDARD.encode(buf)
    )
}

async fn prepare_image(image_url: &str) -> Result<String, String> {
    if image_url.is_empty() {
        return Err("Parameter 'url' wajib diisi".to_string());
    }
    if image_url.starts_with("data:image") {
        return Ok(image_url.to_string());
    }
    if image_url.starts_with("http://") || image_url.starts_with("https://") {
        let cl = reqwest::Client::builder()
            
            .build()
            .map_err(|e| e.to_string())?;
        let res = cl.get(image_url).send().await.map_err(|e| e.to_string())?;
        let buf = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
        return Ok(to_data_url(&buf));
    }
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(image_url.as_bytes())
        .map_err(|_| "Parameter 'url' harus berupa URL gambar atau base64".to_string())?;
    if decoded.is_empty() {
        return Err("Parameter 'url' harus berupa URL gambar atau base64".to_string());
    }
    Ok(to_data_url(&decoded))
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
    let mode = params
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("4x")
        .to_lowercase();
    if !MODES.contains(&mode.as_str()) {
        return jerr(
            StatusCode::BAD_REQUEST,
            &format!("Mode tidak valid. Pilihan: {}", MODES.join(", ")),
        );
    }

    let image_base64 = match prepare_image(&url).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match cl
        .post(API_URL)
                    .header("content-type", "application/json")
                    .header("origin", "https://nexupscaleid.vercel.app")
                    .header("referer", "https://nexupscaleid.vercel.app/")
        .header("user-agent", UA)
        .json(&json!({ "mode": mode, "imageBase64": image_base64 }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let data: Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if data.get("status").and_then(|s| s.as_bool()).unwrap_or(false) == false
        || data.get("resultUrl").is_none()
    {
        return jerr(StatusCode::BAD_GATEWAY, "NexUpscale gagal memproses gambar");
    }
    let result_url = data
        .get("resultUrl")
        .and_then(|r| r.as_str())
        .unwrap_or_default()
        .to_string();

    // Download result
    let dl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let resp = match dl
        .get(&result_url)
        .header("user-agent", UA)
                    .header("referer", "https://nexupscaleid.vercel.app/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("").to_string())
        .unwrap_or_default();
    let buffer = match resp.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let content_type = if ct.is_empty() {
        mime_from_buffer(&buffer).to_string()
    } else {
        ct
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type)
        .header("Content-Length", buffer.len().to_string())
        .header("X-Upscale-Mode", mode)
        .header("X-Upscale-Source", result_url)
        .body(axum::body::Body::from(buffer))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

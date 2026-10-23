// Optimole Upscaler — native conversion of api/imagehd/optimole.js
// optimole.com WP endpoint: form image_url -> processedUrl -> download WebP result.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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

async fn fetch_image(url: &str, timeout: u64) -> Result<Vec<u8>, String> {
    let cl = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())?;
    let res = cl
        .get(url)
        .header("User-Agent", BROWSER_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

async fn optimole_upscale(image_url: &str) -> Result<String, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("image_url", image_url.to_string());

    let res = cl
        .post("https://optimole.com/wp-json/optimole-image/v1/upscale-image")
                    .header("origin", "https://optimole.com")
                    .header("referer", "https://optimole.com/ai-image-upscaling-tool/")
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let processed = data.pointer("/data/processedUrl").and_then(|p| p.as_str());
    if status != 200 || !success || processed.is_none() {
        return Err(format!("Gagal upscale via optimole ({status}): {data}"));
    }
    Ok(processed.unwrap().to_string())
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

    let processed_url = match optimole_upscale(&url).await {
        Ok(u) => u,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let buffer = match fetch_image(&processed_url, 120).await {
        Ok(b) => b,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    if buffer.len() < 1000 {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Hasil upscale tidak valid (bukan gambar)");
    }

    Response::builder()
        .status(StatusCode::OK)
                    .header("Content-Type", "image/webp")
        .header("Content-Length", buffer.len().to_string())
        .header("Content-Disposition", "inline; filename=\"optimole-upscaled.webp\"")
                    .header("X-Provider", "optimole")
        .body(axum::body::Body::from(buffer))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

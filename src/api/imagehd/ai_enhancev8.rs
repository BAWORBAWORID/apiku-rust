// AI Enhance HD v8 — native conversion of api/imagehd/ai-enhancev8.js
// image-upscaling.net: upload with client_id cookie -> poll status -> download result.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://image-upscaling.net";
const UA: &str = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36";

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

fn random_hex(n_bytes: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n_bytes).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

async fn download_image(url: &str, timeout: u64) -> Result<(Vec<u8>, String), String> {
    let cl = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())?;
    let res = cl
        .get(url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok((bytes, ct))
}

async fn upload_image(
    buffer: Vec<u8>,
    client_id: &str,
    scale: &str,
    model: &str,
) -> Result<String, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let filename = format!("upscale-{}.jpg", now_millis());
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename)
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("scale", scale.to_string())
        .text("model", model.to_string())
        .text("use_webp", "true")
        .text("prompt", "")
        .part("image", part);

    let res = cl
        .post(format!("{BASE_URL}/upscaling_upload"))
        .header("Cookie", format!("client_id={client_id}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    let trimmed = text.trim().trim_matches('"').to_string();
    if trimmed.is_empty() {
        return Err("upload gagal: response kosong".to_string());
    }
    Ok(trimmed)
}

async fn get_status(client_id: &str) -> Result<Value, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let res = cl
        .get(format!("{BASE_URL}/upscaling_get_status_v2"))
        .header("Cookie", format!("client_id={client_id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn poll_result(client_id: &str, original_filename: &str) -> Result<String, String> {
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(120) {
        if let Ok(list) = get_status(client_id).await {
            if let Some(arr) = list.as_array() {
                let item = arr.iter().find(|x| {
                    x.get("original_filename").and_then(|v| v.as_str()) == Some(original_filename)
                        || x.get("filename").and_then(|v| v.as_str()) == Some(original_filename)
                        || arr.len() == 1
                });
                if let Some(item) = item {
                    if item.get("completed").and_then(|c| c.as_bool()).unwrap_or(false) {
                        if let Some(image_url) = item.get("image_url").and_then(|v| v.as_str()) {
                            return Ok(format!("{image_url}?client_id={client_id}&delete_after_download="));
                        }
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    }
    Err("Timeout: image upscale not completed".to_string())
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
    let scale = params
        .get("scale")
        .and_then(|v| v.as_str())
        .unwrap_or("4")
        .to_string();
    let model = params
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("general")
        .to_string();

    let image = match download_image(&url, 30).await {
        Ok(v) => v.0,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let client_id = random_hex(16);
    let original_filename = match upload_image(image, &client_id, &scale, &model).await {
        Ok(f) => f,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let download_url = match poll_result(&client_id, &original_filename).await {
        Ok(u) => u,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let (result, content_type) = match download_image(&download_url, 60).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type)
        .header("Content-Length", result.len().to_string())
                    .header("X-Enhance-Service", "image-upscaling-net-v8")
        .body(axum::body::Body::from(result))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

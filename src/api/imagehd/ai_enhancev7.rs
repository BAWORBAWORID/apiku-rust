// AI Enhance HD v7 — native conversion of api/imagehd/ai-enhancev7.js
// Cloudinary: signature -> upload -> e_upscale transform -> download result image.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const CLOUD_NAME: &str = "dtz0urit6";
const API_KEY: &str = "985946268373735";
const UPLOAD_PRESET: &str = "cloudinary-tools";
const SIGNATURE_URL: &str = "https://cloudinary-tools.netlify.app/.netlify/functions/sign-upload-params";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

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

fn timestamp_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn download(url: &str, timeout: u64) -> Result<(Vec<u8>, String), String> {
    let cl = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())?;
    let res = cl
        .get(url)
        .header("User-Agent", BROWSER_UA)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok((bytes, ct))
}

async fn get_upload_signature(ts: u64) -> Result<String, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let payload = json!({
        "paramsToSign": {
            "timestamp": ts,
            "upload_preset": UPLOAD_PRESET,
            "source": "uw",
        }
    });
    let res = cl
        .post(SIGNATURE_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    data.get("signature")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "signature tidak ditemukan".to_string())
}

async fn upload_to_cloudinary(
    buffer: Vec<u8>,
    filename: &str,
    signature: &str,
    ts: u64,
) -> Result<String, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename.to_string())
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("upload_preset", UPLOAD_PRESET)
        .text("api_key", API_KEY)
        .text("timestamp", ts.to_string())
        .text("signature", signature.to_string())
        .text("source", "uw");

    let upload_url = format!("https://api.cloudinary.com/v1_1/{CLOUD_NAME}/image/upload");
    let res = cl
        .post(&upload_url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if status != 200 {
        return Err(format!("Upload failed ({status}): {data}"));
    }
    if let Some(err) = data.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
        return Err(format!("Upload error: {err}"));
    }
    data.get("public_id")
        .and_then(|p| p.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "public_id tidak ditemukan".to_string())
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

    let (image, _) = match download(&url, 30).await {
        Ok(v) => v,
        Err(_) => return jerr(StatusCode::BAD_GATEWAY, "Gagal download gambar"),
    };

    let ts = timestamp_now();
    let signature = match get_upload_signature(ts).await {
        Ok(s) => s,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let filename = format!("upscale-{}.png", timestamp_now());
    let public_id = match upload_to_cloudinary(image, &filename, &signature, ts).await {
        Ok(p) => p,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let upscaled_url =
        format!("https://res.cloudinary.com/{CLOUD_NAME}/image/upload/e_upscale/{public_id}.png");
    let (result, content_type) = match download(&upscaled_url, 60).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type)
        .header("Content-Length", result.len().to_string())
                    .header("X-Enhance-Service", "cloudinary-v7")
        .header("X-Task-Id", public_id)
        .body(axum::body::Body::from(result))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

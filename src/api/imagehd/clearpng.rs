// ClearPNG Upscaler — native conversion of api/imagehd/clearpng.js
// tools.cleanpng.com: upload.php -> upscale.php -> download result image.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

async fn download_image(url: &str, timeout: u64) -> Result<(Vec<u8>, String), String> {
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
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok((bytes, ct))
}

async fn clearpng_upload(image_url: &str) -> Result<Value, String> {
    let (buffer, _) = download_image(image_url, 60).await?;
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name("image.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("image", part)
        .text("ratio", "2");

    let res = cl
        .post("https://tools.cleanpng.com/image-upscaler/upload.php")
                    .header("Origin", "https://tools.cleanpng.com")
                    .header("Referer", "https://tools.cleanpng.com/image-upscaler/")
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let has_path = data.get("path").is_some();
    if status != 200 || !success || !has_path {
        return Err(format!("Gagal upload gambar ke cleanpng ({status}): {data}"));
    }
    Ok(data)
}

async fn clearpng_upscale(server_path: &str, ratio: &str, format: &str) -> Result<(String, Value, Value), String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("path", server_path.to_string())
        .text("ratio", ratio.to_string())
        .text("format", format.to_string())
        .text("enhance_quality", "1");

    let res = cl
        .post("https://tools.cleanpng.com/image-upscaler/upscale.php")
                    .header("Origin", "https://tools.cleanpng.com")
                    .header("Referer", "https://tools.cleanpng.com/image-upscaler/")
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let has_url = data.get("url").is_some();
    if status != 200 || !success || !has_url {
        return Err(format!("Gagal upscale gambar ({status}): {data}"));
    }
    let url = format!(
        "https://tools.cleanpng.com/image-upscaler/{}",
        data.get("url").and_then(|u| u.as_str()).unwrap_or_default()
    );
    Ok((url, data.get("width").cloned().unwrap_or(Value::Null), data.get("height").cloned().unwrap_or(Value::Null)))
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
    let ratio = params.get("ratio").and_then(|v| v.as_str()).unwrap_or("2").to_string();
    let format = params
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("png")
        .to_lowercase();

    if ratio != "2" && ratio != "4" {
        return jerr(StatusCode::BAD_REQUEST, "Ratio tersedia: 2, 4");
    }
    if format != "png" && format != "jpg" {
        return jerr(StatusCode::BAD_REQUEST, "Format tersedia: png, jpg");
    }

    let uploaded = match clearpng_upload(&url).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let server_path = uploaded.get("path").and_then(|p| p.as_str()).unwrap_or_default().to_string();

    let (result_url, width, height) = match clearpng_upscale(&server_path, &ratio, &format).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let (buffer, content_type) = match download_image(&result_url, 60).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    if content_type.contains("json") || buffer.len() < 1000 {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Hasil upscale tidak valid (bukan gambar)");
    }

    let ext = if format == "jpg" { "jpg" } else { "png" };
    let out_ct = if format == "jpg" { "image/jpeg" } else { "image/png" };
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", out_ct)
        .header("Content-Length", buffer.len().to_string())
        .header(
            "Content-Disposition",
            format!("inline; filename=\"clearpng-{width}x{height}.{ext}\""),
        )
        .header("X-Scale", format!("{ratio}x"))
        .header("X-Width", width.to_string())
        .header("X-Height", height.to_string())
        .body(axum::body::Body::from(buffer))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// AI Enhance HD v2 — native conversion of api/imagehd/ai-enhancev2.js
// upscalepics.com multipart upscale (scale 2/4/6/8) -> return image bytes.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const VALID_SCALES: [i64; 4] = [2, 4, 6, 8];

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

/// Minimal PNG/JPEG/GIF dimension probe (replaces Jimp metadata read).
fn image_dimensions(buf: &[u8]) -> Option<(u32, u32)> {
    // PNG: IHDR at offset 16
    if buf.len() > 24 && &buf[0..8] == b"\x89PNG\r\n\x1a\n" {
        let w = u32::from_be_bytes([buf[16], buf[17], buf[18], buf[19]]);
        let h = u32::from_be_bytes([buf[20], buf[21], buf[22], buf[23]]);
        return Some((w, h));
    }
    // JPEG: scan SOF markers
    if buf.len() > 4 && buf[0] == 0xff && buf[1] == 0xd8 {
        let mut i = 2;
        while i + 9 < buf.len() {
            if buf[i] != 0xff {
                i += 1;
                continue;
            }
            let marker = buf[i + 1];
            if (0xc0..=0xcf).contains(&marker) && marker != 0xc4 && marker != 0xc8 && marker != 0xcc
            {
                let h = u16::from_be_bytes([buf[i + 5], buf[i + 6]]) as u32;
                let w = u16::from_be_bytes([buf[i + 7], buf[i + 8]]) as u32;
                return Some((w, h));
            }
            let len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
            if len == 0 {
                i += 1;
            } else {
                i += 2 + len;
            }
        }
    }
    // GIF
    if buf.len() > 10 && &buf[0..3] == b"GIF" {
        let w = u16::from_le_bytes([buf[6], buf[7]]) as u32;
        let h = u16::from_le_bytes([buf[8], buf[9]]) as u32;
        return Some((w, h));
    }
    None
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    timeout: u64,
) -> Result<(Vec<u8>, String), String> {
    let res = client
        .get(url)
        .header("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(timeout))
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

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| -> Option<String> {
        if let Some(v) = query.get(k) {
            if !v.is_empty() {
                return Some(v.clone());
            }
        }
        if let Some(Json(b)) = &body {
            if let Some(s) = b.get(k).and_then(|v| v.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
            if let Some(n) = b.get(k).and_then(|v| v.as_i64()) {
                return Some(n.to_string());
            }
        }
        None
    };

    let url = match get("url") {
        Some(u) => u,
        None => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };

    let scale_size: i64 = get("size").and_then(|s| s.parse().ok()).unwrap_or(4);
    if !VALID_SCALES.contains(&scale_size) {
        return jerr(
            StatusCode::BAD_REQUEST,
            "Parameter 'size' tidak valid. Harus salah satu dari: 2, 4, 6, 8",
        );
    }

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    // 1. Download image
    let (image_bytes, _) = match download(&client, &url, 30).await {
        Ok(v) => v,
        Err(_) => {
            return jerr(
                StatusCode::BAD_REQUEST,
                "Gagal mendownload gambar dari URL yang diberikan",
            )
        }
    };

    // 2. Compute new dimensions (Jimp replacement)
    let (width, height) = match image_dimensions(&image_bytes) {
        Some((w, h)) => (w, h),
        None => return jerr(StatusCode::BAD_REQUEST, "Gambar tidak valid atau corrupt"),
    };
    let new_width = width * scale_size as u32;
    let new_height = height * scale_size as u32;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let name = format!("upscale-{timestamp}");

    // 3. Upload to upscalepics
    let part = match reqwest::multipart::Part::bytes(image_bytes.clone())
        .file_name(format!("upscale-{timestamp}.png"))
        .mime_str("image/png")
    {
        Ok(p) => p,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let form = reqwest::multipart::Form::new()
        .text("name", name.clone())
        .text("imageName", name.clone())
        .text("desiredHeight", new_height.to_string())
        .text("desiredWidth", new_width.to_string())
        .text("outputFormat", "png")
        .text("compressionLevel", "none")
        .text("anime", "false")
        .part("image_file", part);

    let res = client
        .post("https://api.upscalepics.com/upscale-to-size")
                    .header("Origin", "https://upscalepics.com")
                    .header("Referer", "https://upscalepics.com")
        .header("User-Agent", UA)
                    .header("Accept", "application/json")
        .multipart(form)
        
        .send()
        .await;

    let data: Value = match res {
        Ok(r) => match r.json().await {
            Ok(d) => d,
            Err(e) => {
                return jerr(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Failed to connect to upscaler API: {e}"),
                )
            }
        },
        Err(e) => {
            return jerr(
                StatusCode::SERVICE_UNAVAILABLE,
                &format!("Failed to connect to upscaler API: {e}"),
            )
        }
    };

    if let Some(err) = data.get("error") {
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Error from upscaler API: {err}"),
        );
    }
    let image_url = data
        .get("bgRemoved")
        .and_then(|v| v.as_str())
        .or_else(|| data.get("image").and_then(|v| v.as_str()))
        .unwrap_or("");
    if image_url.is_empty() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "No image URL in response");
    }

    // 4. Download result
    let (enhanced_bytes, ct) = match download(&client, image_url, 60).await {
        Ok(v) => v,
        Err(_) => return jerr(StatusCode::GATEWAY_TIMEOUT, "Timeout saat memproses gambar"),
    };

    let original_kb = image_bytes.len() as f64 / 1024.0;
    let enhanced_kb = enhanced_bytes.len() as f64 / 1024.0;
    let increase = (enhanced_bytes.len() as f64 / image_bytes.len() as f64) * 100.0;

    let content_type = if ct.starts_with("image/") { ct.as_str() } else { "image/png" };

    bin_response(
        enhanced_bytes,
        content_type,
        &[
            ("X-Enhance-Service", "upscalepics-v2".to_string()),
            ("X-Scale-Factor", scale_size.to_string()),
            ("X-Original-Size-KB", format!("{:.2}", original_kb)),
            ("X-Enhanced-Size-KB", format!("{:.2}", enhanced_kb)),
            ("X-Size-Increase-Percent", format!("{:.2}", increase)),
            ("X-Original-Dimensions", format!("{}x{}", width, height)),
            ("X-Enhanced-Dimensions", format!("{}x{}", new_width, new_height)),
        ],
    )
}

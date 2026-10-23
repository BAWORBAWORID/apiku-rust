// Ghibli Style Generator — native conversion of api/image/gibli.js
// Full native flow: download image → base64 data URL → ghibli-proxy netlify
// function (gpt-image-1) → decode b64_json or fetch result URL → PNG bytes.
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

fn merged(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Value {
    let mut m = json!({});
    if let Some(Json(b)) = body {
        if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } }
    }
    for (k, v) in query { m[k] = json!(v); }
    m
}

fn str_param(m: &Value, key: &str) -> Option<String> {
    match m.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap_or_default()
}

fn dl_client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap_or_default()
}

fn detect_mime(buf: &[u8]) -> &'static str {
    if buf.len() >= 3 && buf[0] == 0xff && buf[1] == 0xd8 { "image/jpeg" }
    else if buf.len() >= 2 && buf[0] == 0x89 && buf[1] == 0x50 { "image/png" }
    else if buf.len() >= 4 && &buf[0..4] == b"RIFF" { "image/webp" }
    else if buf.len() >= 3 && &buf[0..3] == b"GIF" { "image/gif" }
    else { "image/jpeg" }
}

fn ext_from(mime: &str) -> &'static str {
    match mime { "image/png" => "png", "image/webp" => "webp", _ => "jpg" }
}

fn mime_of(ext: &str) -> &'static str {
    match ext { "png" => "image/png", "webp" => "image/webp", _ => "image/jpeg" }
}

fn is_img_response(r: &Result<reqwest::Response, reqwest::Error>) -> bool {
    match r {
        Ok(resp) => resp.status().is_success() && resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|c| c.starts_with("image/")).unwrap_or(false),
        Err(_) => false,
    }
}

fn img_response(content_type: &str, buf: &[u8], extra: &[(&str, String)]) -> Response {
    let mut hh = HeaderMap::new();
    if let (Ok(k), Ok(v)) = (
        reqwest::header::HeaderName::from_bytes(b"Content-Type"),
        reqwest::header::HeaderValue::from_str(content_type),
    ) { hh.insert(k, v); }
    for (k, v) in extra {
        if let (Ok(kn), Ok(vv)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(v),
        ) { hh.insert(kn, vv); }
    }
    (StatusCode::OK, hh, buf.to_vec()).into_response()
}

fn err_json(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

// RemoveBG BGv2 — native conversion of api/image/removebgbgv2.js
// api4.backgroundremove.ai: POST /api/v1/process (multipart, X-Api-Key) → PNG
// bytes direct (streaming). Polling-free.
const BG2_API_KEY: &str = "d4efd2ad-8e0c-4790-ae07-252bc012d748";
const BG2_BASE: &str = "https://api4.backgroundremove.ai";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(image_url) = str_param(&m, "url").or_else(|| str_param(&m, "image")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' atau 'image' wajib diisi"}))).into_response();
    };
    let size = str_param(&m, "size").unwrap_or_else(|| "auto".into());
    let valid_sizes = ["auto", "small", "medium", "large"];
    if !valid_sizes.contains(&size.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Ukuran tidak valid. Pilihan: auto, small, medium, large"}))).into_response();
    }
    let type_param = str_param(&m, "type").unwrap_or_else(|| "auto".into());
    let valid_types = ["auto", "product", "person", "car"];
    if !valid_types.contains(&type_param.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Tipe tidak valid. Pilihan: auto, product, person, car"}))).into_response();
    }
    let format_param = str_param(&m, "format").unwrap_or_else(|| "png".into());
    let valid_formats = ["png", "jpeg", "zip"];
    if !valid_formats.contains(&format_param.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Format tidak valid. Pilihan: png, jpeg, zip"}))).into_response();
    }
    let img = dl_client().get(&image_url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Failed to download image from URL"),
    };
    let mime = img.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    if !mime.starts_with("image/") {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(json!({"status": false, "message": "Unsupported image format", "code": "UNSUPPORTED_FORMAT", "supported_formats": ["image/jpeg", "image/png", "image/webp"]}))).into_response();
    }
    let ext = ext_from(&mime);
    let part = reqwest::multipart::Part::bytes(buf).file_name(format!("image.{}", ext)).mime_str(&mime).unwrap();
    let form = reqwest::multipart::Form::new()
        .part("image_file", part)
        .text("size", size.clone())
        .text("type", type_param.clone())
        .text("format", format_param.clone())
        .text("strict", "false")
        .text("shadow", "false");
    let res = client()
        .post(format!("{}/v1/process", BG2_BASE))
        .header("X-Api-Key", BG2_API_KEY)
        .multipart(form)
        .send().await;
    let res = match res {
        Ok(r) if r.status().is_success() => r,
        Ok(r) if r.status() == StatusCode::PAYMENT_REQUIRED => {
            return (StatusCode::PAYMENT_REQUIRED, Json(json!({"status": false, "message": "API limit exceeded", "code": "API_LIMIT", "http_status": 402}))).into_response();
        }
        Ok(r) => {
            let s = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": format!("API request failed: {}", body.chars().take(200).collect::<String>()), "code": "API_ERROR", "http_status": s}))).into_response();
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "NETWORK_ERROR"}))).into_response(),
    };
    let content_type = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/png").to_string();
    let out_mime = if format_param == "jpeg" { "image/jpeg" } else if format_param == "zip" { "application/zip" } else { "image/png" };
    let _ = content_type;
    let bytes = res.bytes().await.unwrap_or_default();
    if bytes.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Empty response from API", "code": "EMPTY_RESPONSE"}))).into_response();
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) && !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) && !bytes.starts_with(&[0x50, 0x4B]) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Invalid response from background removal API", "code": "INVALID_RESPONSE"}))).into_response();
    }
    img_response(out_mime, &bytes, &[
        ("X-Processor", "removebgbgv2".into()),
        ("X-Source-Size", size),
        ("X-Source-Type", type_param),
    ])
}

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
use base64::Engine as _;

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

// NSFW Check — native conversion of api/image/nsfw-check.js
// Nyckel pretrained NSFW classifier invoked with multipart file upload.
const INVOKE_URL: &str = "https://www.nyckel.com/v1/functions/o2f0jzcdyut2qxhu/invoke";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(source) = str_param(&m, "url") else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Parameter 'url' wajib diisi");
    };
    let (buf, mime, filename): (Vec<u8>, String, String) = if source.starts_with("data:image") {
        let Some((meta, data)) = source.split_once(";base64,") else {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Parameter 'url' harus berupa URL gambar atau base64");
        };
        let mime = meta.trim_start_matches("data:").to_string();
        match base64::engine::general_purpose::STANDARD.decode(data) {
            Ok(b) => (b, mime.clone(), format!("image.{}", mime.split('/').nth(1).unwrap_or("jpg"))),
            Err(_) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Base64 tidak valid"),
        }
    } else if source.starts_with("http://") || source.starts_with("https://") {
        match dl_client().get(&source).send().await {
            Ok(r) => match r.bytes().await {
                Ok(b) => { let b = b.to_vec(); let mime = detect_mime(&b).to_string(); (b, mime.clone(), format!("image.{}", ext_from(&mime))) }
                Err(_) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mengunduh gambar"),
            },
            Err(_) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mengunduh gambar"),
        }
    } else {
        match base64::engine::general_purpose::STANDARD.decode(&source) {
            Ok(b) if !b.is_empty() => { let mime = detect_mime(&b).to_string(); (b, mime.clone(), format!("image.{}", ext_from(&mime))) }
            _ => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Parameter 'url' harus berupa URL gambar atau base64"),
        }
    };
    let part = reqwest::multipart::Part::bytes(buf)
        .file_name(filename)
        .mime_str(&mime).unwrap_or_else(|_| reqwest::multipart::Part::bytes(Vec::new()).file_name("image.jpg"));
    let form = reqwest::multipart::Form::new().part("file", part);
    let res = client().post(INVOKE_URL)
                    .header("Referer", "https://www.nyckel.com/pretrained-classifiers/nsfw-identifier/")
        .multipart(form)
        .send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return err_json(StatusCode::BAD_GATEWAY, &format!("Nyckel gagal: {}", e)),
    };
    if !res.status().is_success() {
        return err_json(StatusCode::BAD_GATEWAY, &format!("Nyckel gagal: HTTP {}", res.status()));
    }
    let data: Value = res.json().await.unwrap_or(Value::Null);
    let label = data.get("labelName").and_then(|v| v.as_str()).map(|s| s.to_string());
    let confidence = data.get("confidence").and_then(|v| v.as_f64());
    let (Some(label), Some(confidence)) = (label, confidence) else {
        return err_json(StatusCode::BAD_GATEWAY, "Response Nyckel tidak valid");
    };
    let label_id = data.get("labelId").cloned().unwrap_or(Value::Null);
    let is_nsfw = label.to_lowercase().starts_with("nsfw")
        || (label.to_lowercase().contains("porn") && !label.to_lowercase().starts_with("not"));
    Json(json!({
        "status": true,
        "result": { "label": label, "labelId": label_id, "confidence": confidence, "safe": !is_nsfw, "nsfw": is_nsfw }
    })).into_response()
}

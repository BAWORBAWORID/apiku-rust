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

// NanoBanana Lite — native conversion of api/image/nanobanana-lite.js
// ibbo.ai /api/nano-banana-lite-image-to-image (multipart image + prompt).
// Node tried rotating SOCKS5 proxies (proxyscrape) before direct; no proxy
// engine in this build → direct only.
const LITE_HEADERS: &[(&str, &str)] = &[
    ("Accept", "*/*"),
    ("Origin", "https://banana-nano.ai"),
    ("Referer", "https://banana-nano.ai/ai-image-editor"),
    ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"),
];

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let image_url = str_param(&m, "url").or_else(|| str_param(&m, "image"));
    let Some(image_url) = image_url else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    let prompt = str_param(&m, "prompt").unwrap_or_else(|| "add stylish glasses".into());
    let img = dl_client().get(&image_url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal download gambar", "code": "NANOBANANA_ERROR"}))).into_response(),
    };
    let img_buf = img.bytes().await.unwrap_or_default().to_vec();
    let part = reqwest::multipart::Part::bytes(img_buf).file_name("image.jpg").mime_str("image/jpeg").unwrap();
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("prompt", prompt.clone())
        .text("output_format", "jpg")
        .text("generator_slug", "ai-image-editor");
    let mut req = client().post("https://ibbo.ai/api/nano-banana-lite-image-to-image");
    for (k, v) in LITE_HEADERS { req = req.header(*k, *v); }
    let res = req.multipart(form).send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "NANOBANANA_ERROR"}))).into_response(),
    };
    let j: Value = res.json().await.unwrap_or(Value::Null);
    if j.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = j.get("msg").and_then(|v| v.as_str()).unwrap_or("Gagal proses nano-banana");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg, "code": "NANOBANANA_ERROR"}))).into_response();
    }
    let Some(out_url) = j.pointer("/data/image_url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal proses nano-banana", "code": "NANOBANANA_ERROR"}))).into_response();
    };
    let model = j.pointer("/data/model").and_then(|v| v.as_str()).unwrap_or("nano-banana-lite").to_string();
    match dl_client().get(&out_url).send().await {
        Ok(r) if r.status().is_success() => {
            let b = r.bytes().await.unwrap_or_default();
            img_response("image/jpeg", &b, &[("X-Image-URL", out_url), ("X-Model", model)])
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mengunduh hasil", "code": "NANOBANANA_ERROR"}))).into_response(),
    }
}

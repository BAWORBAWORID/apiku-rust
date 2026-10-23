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

const API_URL: &str = "https://ghibli-proxy.netlify.app/.netlify/functions/ghibli-proxy";
const DEFAULT_PROMPT: &str = "Transform this image into beautiful Studio Ghibli anime art style with soft colors, dreamy atmosphere, and hand-painted aesthetic";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url") else {
        return err_json(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi (URL gambar)");
    };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return err_json(StatusCode::BAD_REQUEST, "URL tidak valid");
    }
    let img_res = dl_client().get(url.trim()).send().await;
    if !is_img_response(&img_res) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Ghibli transformation failed: gagal mengunduh gambar");
    }
    let resp = img_res.unwrap();
    let ct = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    let bytes = resp.bytes().await.unwrap_or_default();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let payload = json!({
        "image": format!("data:{};base64,{}", ct, b64),
        "prompt": DEFAULT_PROMPT,
        "model": "gpt-image-1",
        "n": 1,
        "size": "1024x1024",
        "quality": "low"
    });
    let res = client().post(API_URL)
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                    .header("Origin", "https://overchat.ai")
                    .header("Referer", "https://overchat.ai/image/ghibli")
        .json(&payload)
        .send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &format!("Ghibli transformation failed: {}", e)),
    };
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if data.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Ghibli API responded with failure.");
    }
    let first = data.pointer("/data/0").cloned().unwrap_or(json!({}));
    let buf: Option<Vec<u8>> = if let Some(b) = first.get("b64_json").and_then(|v| v.as_str()) {
        base64::engine::general_purpose::STANDARD.decode(b).ok()
    } else if let Some(u) = first.get("url").and_then(|v| v.as_str()) {
        match dl_client().get(u).send().await {
            Ok(r) => r.bytes().await.ok().map(|b| b.to_vec()),
            Err(_) => None,
        }
    } else { None };
    let Some(buf) = buf else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "API success but no image data returned.");
    };
    img_response("image/png", &buf, &[])
}

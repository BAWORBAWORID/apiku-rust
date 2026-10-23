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

// ToAnime V2 — native conversion of api/image/toanimev2.js
// toanime.ak.io.vn: POST /api/removebg/upload (multipart) → POST /api/process
// (strength, style) → poll /api/removebg/result/{taskId} → result_image URL
// → bytes. Direct only.
const TA_BASE: &str = "https://toanime.ak.io.vn";
const TA_HEADERS: &[(&str, &str)] = &[
    ("origin", TA_BASE),
    ("referer", "https://toanime.ak.io.vn/"),
    ("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
];

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").or_else(|| str_param(&m, "imageUrl")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' atau 'imageUrl' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    let prompt = str_param(&m, "prompt").unwrap_or_default();
    let strength = match str_param(&m, "strength") {
        None => 5.0,
        Some(s) => match s.parse::<f64>() {
            Ok(n) if (1.0..=10.0).contains(&n) => n,
            _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'strength' harus angka antara 1-10", "code": "INVALID_STRENGTH"}))).into_response(),
        },
    };
    let fn_name = str_param(&m, "fn_name").unwrap_or_default();
    let style = if prompt.is_empty() && fn_name == "image2anime" { "animev2".to_string() } else { fn_name };
    let img = dl_client().get(&url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Gagal mengunduh gambar", "code": "DOWNLOAD_FAILED"}))).into_response(),
    };
    let mime = img.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    if !mime.starts_with("image/") {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(json!({"status": false, "message": "Unsupported image format", "code": "UNSUPPORTED_FORMAT"}))).into_response();
    }
    let ext = ext_from(&mime);
    // 1. upload
    let part = reqwest::multipart::Part::bytes(buf).file_name(format!("upload.{}", ext)).mime_str(&mime).unwrap();
    let mut req = client().post(format!("{}/api/removebg/upload", TA_BASE));
    for (k, v) in TA_HEADERS { req = req.header(*k, *v); }
    let up = req.multipart(reqwest::multipart::Form::new().part("image", part)).send().await;
    let up = match up {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let s = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": format!("Upload gagal: {}", body.chars().take(200).collect::<String>()), "code": "UPLOAD_FAILED", "http_status": s}))).into_response();
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "NETWORK_ERROR"}))).into_response(),
    };
    let upj: Value = up.json().await.unwrap_or(Value::Null);
    let Some(image_id) = upj.pointer("/data/imageId").and_then(|v| v.as_str())
        .or_else(|| upj.pointer("/imageId").and_then(|v| v.as_str()))
        .or_else(|| upj.pointer("/data/id").and_then(|v| v.as_str()))
        .map(|s| s.to_string()) else {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Gagal upload gambar (imageId tidak ditemukan)", "code": "NO_IMAGE_ID"}))).into_response();
    };
    // 2. process
    let payload = json!({"imageId": image_id, "strength": strength, "style": style, "prompt": prompt});
    let mut req = client().post(format!("{}/api/process", TA_BASE));
    for (k, v) in TA_HEADERS { req = req.header(*k, *v); }
    let proc = req.json(&payload).send().await;
    let proc = match proc {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let s = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": format!("Gagal memproses: {}", body.chars().take(200).collect::<String>()), "code": "PROCESS_FAILED", "http_status": s}))).into_response();
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "NETWORK_ERROR"}))).into_response(),
    };
    let pj: Value = proc.json().await.unwrap_or(Value::Null);
    let Some(task_id) = pj.pointer("/data/taskId").and_then(|v| v.as_str())
        .or_else(|| pj.pointer("/taskId").and_then(|v| v.as_str()))
        .map(|s| s.to_string()) else {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Gagal memulai proses (taskId tidak ditemukan)", "code": "NO_TASK_ID"}))).into_response();
    };
    // 3. poll up to 30 x 3s
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let mut req = client().get(format!("{}/api/removebg/result/{}", TA_BASE, task_id));
        for (k, v) in TA_HEADERS { req = req.header(*k, *v); }
        let res = req.send().await;
        let Ok(r) = res else { continue };
        let Ok(j) = r.json::<Value>().await else { continue };
        let status = j.pointer("/data/status").and_then(|v| v.as_str())
            .or_else(|| j.get("status").and_then(|v| v.as_str()))
            .unwrap_or("").to_string();
        if status == "success" || status == "completed" {
            let Some(result_url) = j.pointer("/data/result_image").and_then(|v| v.as_str())
                .or_else(|| j.pointer("/data/resultUrl").and_then(|v| v.as_str()))
                .map(|s| s.to_string()) else {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Hasil tidak ditemukan", "code": "NO_RESULT_URL"}))).into_response();
            };
            let dl = dl_client().get(&result_url).send().await;
            let bytes = match dl {
                Ok(r) if r.status().is_success() => r.bytes().await.unwrap_or_default().to_vec(),
                _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mengunduh hasil", "code": "DOWNLOAD_FAILED"}))).into_response(),
            };
            return img_response("image/png", &bytes, &[("X-Task-ID", task_id.clone()), ("X-Processor", "toanimev2".to_string())]);
        }
        if status == "failed" || status == "error" {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Proses toanime gagal di upstream", "code": "TASK_FAILED"}))).into_response();
        }
    }
    (StatusCode::GATEWAY_TIMEOUT, Json(json!({"status": false, "message": "Toanime timeout setelah ~90 detik", "code": "TIMEOUT"}))).into_response()
}

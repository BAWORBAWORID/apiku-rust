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

// Unwatermark — native conversion of api/image/unwatermark.js
// api.unwatermark.ai: create-job (multipart) with Product-Serial/Code → poll
// get-job (code 100000 done, 300006 processing) → download output → image bytes.
const UW_CREATE: &str = "https://api.unwatermark.ai/api/web/v1/image-watermark-auto-remove-upgrade/create-job";
const UW_GET: &str = "https://api.unwatermark.ai/api/web/v1/image-watermark-auto-remove-upgrade/get-job";

fn uw_headers(serial: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Product-Serial", serial.to_string()),
        ("Product-Code", "067003".into()),
        ("origin", "https://unwatermark.ai".into()),
        ("referer", "https://unwatermark.ai/".into()),
    ]
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    let Some(url) = query.get("url").filter(|s| !s.is_empty()).cloned() else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Format URL tidak valid", "code": "INVALID_URL"}))).into_response();
    }
    let img = dl_client().get(&url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Gagal mengunduh gambar", "code": "DOWNLOAD_FAILED"}))).into_response(),
    };
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    let mime = detect_mime(&buf);
    let ext = ext_from(mime);
    let serial: String = {
        let mut r = rand::thread_rng();
        use rand::Rng;
        let b0: u8 = r.gen();
        format!("{:02x}-{:02x}-{:02x}", b0, 0u8, 0u8)
    };
    // simpler: uuid-style via rand
    let serial = uuid_like();
    let part = reqwest::multipart::Part::bytes(buf).file_name(format!("upload.{}", ext)).mime_str(mime).unwrap();
    let form = reqwest::multipart::Form::new()
        .part("original_image_file", part)
        .text("output_format", "jpg")
        .text("is_remove_text", "true")
        .text("is_remove_logo", "true")
        .text("is_enhancer", "true");
    let mut req = client().post(UW_CREATE);
    for (k, v) in uw_headers(&serial) { req = req.header(k, &v); }
    let create = req.multipart(form).send().await;
    let create = match create {
        Ok(r) if r.status().is_success() => r,
        Ok(_) => return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Gagal membuat job unwatermark", "code": "API_ERROR"}))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "INTERNAL_ERROR"}))).into_response(),
    };
    let cj: Value = create.json().await.unwrap_or(Value::Null);
    let Some(job_id) = cj.pointer("/result/job_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))) else {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Gagal membuat job unwatermark", "code": "API_ERROR"}))).into_response();
    };
    let mut output_url: Option<String> = None;
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
        let mut req = client().get(format!("{}/{}", UW_GET, job_id));
        for (k, v) in uw_headers(&serial) { req = req.header(k, &v); }
        let get = req.send().await;
        let get = match get {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };
        let j: Value = get.json().await.unwrap_or(Value::Null);
        let code = j.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
        if code == 100000 {
            let out = j.pointer("/result/output_url").cloned().unwrap_or(Value::Null);
            output_url = match &out {
                Value::String(s) => Some(s.clone()),
                Value::Array(a) => a.first().and_then(|v| v.as_str()).map(|s| s.to_string()),
                _ => None,
            };
            break;
        }
        if code != 100000 && code != 300006 {
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": format!("Job failed with code {}: {}", code, j.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error")), "code": "JOB_FAILED"}))).into_response();
        }
    }
    let Some(output_url) = output_url else {
        return (StatusCode::GATEWAY_TIMEOUT, Json(json!({"status": false, "message": "Unwatermark timeout after 120 seconds", "code": "TIMEOUT"}))).into_response();
    };
    match dl_client().get(&output_url).send().await {
        Ok(r) if r.status().is_success() => {
            let b = r.bytes().await.unwrap_or_default();
            img_response("image/png", &b, &[
                ("Cache-Control", "public, max-age=86400".into()),
                ("X-AI-Processor", "unwatermark.ai".into()),
                ("X-Transformer", "unwatermark".into()),
                ("X-Job-ID", job_id),
            ])
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mengunduh gambar hasil", "code": "DOWNLOAD_FAILED"}))).into_response(),
    }
}

fn uuid_like() -> String {
    use rand::Rng;
    let mut r = rand::thread_rng();
    let b: [u8; 16] = r.gen();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-8{:01x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] & 0x0f, b[7],
        b[8] & 0x0f, b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

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

// RemoveWM — native conversion of api/image/removewm.js
// potrace flow (min 300x300): POST /v1/jobs (multipart, X-Api-Key,
// X-Request-Id) → poll /v1/jobs/{id} → watermark/result_url → download.
const RMWM_API_KEY: &str = "f5a565b7beabaa7f7f6ee35f9d578d23";
const RMWM_BASE: &str = "https://service.aibooru.online";
const RMWM_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const RMWM_ORIGIN: &str = "https://www.watermarkremover.io";

fn rmwm_headers() -> Vec<(&'static str, &'static str)> {
    vec![("X-Api-Key", RMWM_API_KEY), ("User-Agent", RMWM_UA), ("Origin", RMWM_ORIGIN), ("Referer", "https://www.watermarkremover.io/")]
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").or_else(|| str_param(&m, "image_url")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    let img = dl_client().get(&url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Gagal mengunduh gambar", "code": "DOWNLOAD_FAILED"}))).into_response(),
    };
    let mime = img.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/png").split(';').next().unwrap_or("image/png").to_string();
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    if !mime.starts_with("image/") {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(json!({"status": false, "message": "Unsupported image format", "code": "UNSUPPORTED_FORMAT", "supported_formats": ["image/jpeg", "image/png", "image/webp"]}))).into_response();
    }
    if (dims_of(&buf)).map(|(w, h)| w < 300 || h < 300).unwrap_or(false) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Image dimensions must be at least 300x300 pixels.", "code": "IMAGE_TOO_SMALL", "min_dimensions": {"width": 300, "height": 300}}))).into_response();
    }
    let ext = ext_from(&mime);
    let request_id = uuid_like_v4();
    let part = reqwest::multipart::Part::bytes(buf).file_name(format!("image.{}", ext)).mime_str(&mime).unwrap();
    let form = reqwest::multipart::Form::new().part("image_file", part);
    let mut req = client().post(format!("{}/v1/jobs", RMWM_BASE));
    for (k, v) in rmwm_headers() { req = req.header(k, v); }
    let create = req.header("X-Request-Id", &request_id).multipart(form).send().await;
    let create = match create {
        Ok(r) if r.status().is_success() => r,
        Ok(r) if r.status().as_u16() == 401 || r.status().as_u16() == 403 => {
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "API limit exceeded", "code": "API_LIMIT", "http_status": r.status().as_u16()}))).into_response();
        }
        Ok(r) => {
            let s = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": format!("API request failed: {}", body.chars().take(200).collect::<String>()), "code": "API_ERROR", "http_status": s}))).into_response();
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "NETWORK_ERROR"}))).into_response(),
    };
    let cj: Value = create.json().await.unwrap_or(Value::Null);
    let Some(job_id) = cj.get("job_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))) else {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Failed to create job", "code": "NO_JOB_ID"}))).into_response();
    };
    // poll up to 30 tries x 2s
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let mut req = client().get(format!("{}/v1/jobs/{}", RMWM_BASE, job_id));
        for (k, v) in rmwm_headers() { req = req.header(k, v); }
        let get = req.send().await;
        let get = match get { Ok(r) if r.status().is_success() => r, _ => continue };
        let j: Value = get.json().await.unwrap_or(Value::Null);
        let st = j.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if st == "error" {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": j.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error"), "code": "JOB_ERROR"}))).into_response();
        }
        if st == "success" {
            let result = j.get("result").cloned().unwrap_or(json!({}));
            let watermark = result.get("watermark_url").and_then(|v| v.as_str()).unwrap_or("");
            let Some(res_url) = result.get("result_url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Result URL not found in response", "code": "NO_RESULT_URL"}))).into_response();
            };
            let dl = dl_client().get(&res_url).send().await;
            let bytes = match dl {
                Ok(r) if r.status().is_success() => r.bytes().await.unwrap_or_default().to_vec(),
                _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Failed to download result image", "code": "DOWNLOAD_FAILED"}))).into_response(),
            };
            return img_response("image/png", &bytes, &[
                ("X-Processor", "removewm".into()),
                ("X-Job-ID", job_id),
                ("X-Source-Type", if watermark.is_empty() { "text".to_string() } else { "logo".to_string() }),
            ]);
        }
    }
    (StatusCode::GATEWAY_TIMEOUT, Json(json!({"status": false, "message": "Timeout while processing image", "code": "TIMEOUT"}))).into_response()
}

fn dims_of(b: &[u8]) -> Option<(u32, u32)> {
    image::io::Reader::new(std::io::Cursor::new(b)).with_guessed_format().ok()?.into_dimensions().ok()
}

fn uuid_like_v4() -> String {
    use rand::Rng;
    let mut r = rand::thread_rng();
    let b: [u8; 16] = r.gen();
    format!("{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-8{:01x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] & 0x0f, b[7], b[8] & 0x0f, b[9], b[10], b[11], b[12], b[13], b[14], b[15])
}

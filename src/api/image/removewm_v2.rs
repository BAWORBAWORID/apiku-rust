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

// RemoveWM V2 — native conversion of api/image/removewm-v2.js
// engine.indexish.co (potrace backend): POST /v1/jobs with request-id +
// session cookies → poll until status 200 → download processed.1.png.
const WM2_BASE: &str = "https://engine.indexish.co";
const WM2_API_KEY: &str = "e4b2f3edba0c9db5633d1c25d5568e4c";
const WM2_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const WM2_ORIGIN: &str = "https://www.watermarkremover.io";

fn wm2_headers(session_id: &str, req_id: &str) -> Vec<(String, String)> {
    vec![
        ("X-Api-Key".into(), WM2_API_KEY.into()),
        ("User-Agent".into(), WM2_UA.into()),
        ("Origin".into(), WM2_ORIGIN.into()),
        ("Referer".into(), format!("{}/", WM2_ORIGIN)),
        ("request-id".into(), req_id.to_string()),
        ("Cookie".into(), format!("session_id={}", session_id)),
    ]
}

fn hex32() -> String {
    (0..32).map(|_| format!("{:02x}", rand::Rng::gen::<u8>(&mut rand::thread_rng()))).collect()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").or_else(|| str_param(&m, "imageUrl")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' atau 'imageUrl' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Invalid URL format", "code": "INVALID_URL"}))).into_response();
    }
    let img = dl_client().get(&url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Failed to download image", "code": "DOWNLOAD_FAILED"}))).into_response(),
    };
    let mime = img.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/png").split(';').next().unwrap_or("image/png").to_string();
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    if !mime.starts_with("image/") {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(json!({"status": false, "message": "Unsupported image format", "code": "UNSUPPORTED_FORMAT", "supported_formats": ["image/jpeg", "image/png", "image/webp"]}))).into_response();
    }
    if (dims_of(&buf)).map(|(w, h)| w < 300 || h < 300).unwrap_or(false) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Image dimensions must be at least 300x300 pixels.", "code": "IMAGE_TOO_SMALL"}))).into_response();
    }
    let ext = ext_from(&mime);
    let session_id = hex32();
    let request_id = uuid_like_v4();
    let part = reqwest::multipart::Part::bytes(buf).file_name(format!("image.{}", ext)).mime_str(&mime).unwrap();
    let form = reqwest::multipart::Form::new().part("image_file", part);
    let mut req = client().post(format!("{}/v1/jobs", WM2_BASE));
    for (k, v) in wm2_headers(&session_id, &request_id) { req = req.header(k, v); }
    let create = req.multipart(form).send().await;
    let create = match create {
        Ok(r) if r.status().is_success() => r,
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
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let mut req = client().get(format!("{}/v1/jobs/{}", WM2_BASE, job_id));
        for (k, v) in wm2_headers(&session_id, &request_id) { req = req.header(k, v); }
        let get = req.send().await;
        let get = match get { Ok(r) if r.status() == StatusCode::OK => r, _ => continue };
        let j: Value = get.json().await.unwrap_or(Value::Null);
        let st = j.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if st == "error" {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": j.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error"), "code": "JOB_ERROR"}))).into_response();
        }
        if st == "success" {
            let result = j.get("result").cloned().unwrap_or(json!({}));
            let Some(res_url) = result.get("processed.1.png").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Result URL not found in response", "code": "NO_RESULT_URL"}))).into_response();
            };
            let dl = dl_client().get(&res_url).send().await;
            let bytes = match dl {
                Ok(r) if r.status().is_success() => r.bytes().await.unwrap_or_default().to_vec(),
                _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Failed to download result image", "code": "DOWNLOAD_FAILED"}))).into_response(),
            };
            return img_response("image/png", &bytes, &[
                ("X-Processor", "removewm-v2".into()),
                ("X-Job-ID", job_id),
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

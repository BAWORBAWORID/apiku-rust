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

// Unblur V2 — native conversion of api/image/unblurv2.js
// imgupscaler.ai "magic eraser"-style flow: upload slot → OSS PUT → signed URL
// → free-credits-config → create-job (model magiceraser) → poll get-job →
// result image bytes. Direct only (Node used rotating proxies for retries).
const U2_HEADERS: &[(&str, &str)] = &[
    ("origin", "https://imgupscaler.ai"),
    ("referer", "https://imgupscaler.ai/"),
    ("user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"),
];

fn ihdr_apply(mut b: reqwest::RequestBuilder, serial: Option<&str>) -> reqwest::RequestBuilder {
    for (k, v) in U2_HEADERS { b = b.header(*k, *v); }
    if let Some(s) = serial { b = b.header("product-serial", s); }
    b
}
macro_rules! ihdr {
    ($serial:expr, $client:expr, post, $url:expr) => { ihdr_apply($client.post($url), $serial) };
    ($serial:expr, $client:expr, get, $url:expr) => { ihdr_apply($client.get($url), $serial) };
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").filter(|s| !s.is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    let img = dl_client().get(&url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mengunduh gambar dari URL", "code": "DOWNLOAD_FAILED"}))).into_response(),
    };
    let mime = img.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    if !mime.starts_with("image/") {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(json!({"status": false, "message": "Unsupported image format", "code": "UNSUPPORTED_FORMAT"}))).into_response();
    }
    let filename = format!("unblur_{}.{}", chrono::Utc::now().timestamp_millis(), ext_from(&mime));
    // 1. upload slot
    let form_up = reqwest::multipart::Form::new().text("file_name", filename.clone());
    let up = ihdr!(None, client(), post, "https://api-v2.imgupscaler.ai/api/common/upload/upload-image").multipart(form_up).send().await;
    let upj: Value = match up { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "UPLOAD_FAILED"}))).into_response() };
    let Some(upload_url) = upj.pointer("/result/url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mendapatkan URL upload", "code": "NO_UPLOAD_URL"}))).into_response();
    };
    let Some(object_name) = upj.pointer("/result/object_name").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mendapatkan object name", "code": "NO_OBJECT_NAME"}))).into_response();
    };
    // 2. OSS PUT + 3. signed URL
    let _ = dl_client().put(&upload_url).header("Content-Type", &mime).body(buf).send().await;
    let form_sign = reqwest::multipart::Form::new()
        .text("object_name", object_name)
        .text("params", json!({"x-oss-process": "image/resize,m_fill,w_128,h_128/quality,q_80/format,webp"}).to_string());
    let sign = ihdr!(None, client(), post, "https://api-v2.imgupscaler.ai/api/common/upload/sign-object").multipart(form_sign).send().await;
    let signj: Value = match sign { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "SIGN_FAILED"}))).into_response() };
    let Some(signed_url) = signj.pointer("/result/url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mendapatkan signed URL", "code": "NO_SIGNED_URL"}))).into_response();
    };
    // 4. credits + create job
    let serial: String = (0..32).map(|_| format!("{:x}", rand::Rng::gen_range(&mut rand::thread_rng(), 0..16))).collect();
    let _ = ihdr!(Some(&serial), client(), post, "https://api-v2.imgupscaler.ai/api/pai/common/free-credits-config").json(&json!({})).send().await;
    let form_job = reqwest::multipart::Form::new()
        .text("model_name", "magiceraser")
        .text("original_image_url", signed_url)
        .text("prompt", "unblur")
        .text("ratio", "match_input_image")
        .text("output_format", "jpg");
    let job = ihdr_apply(client()
                    .post("https://api-v2.imgupscaler.ai/api/runtime/jobs/create-job")
                    .header("product-code", "magiceraser")
                    .header("router-key", "photo_editor_magiceraser_v1")
                    .header("timezone", "Asia/Jakarta"), Some(&serial))
        .multipart(form_job)
        .send().await;
    let jobj: Value = match job { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "CREATE_FAILED"}))).into_response() };
    let Some(job_id) = jobj.pointer("/result/job_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal membuat job unblur", "code": "NO_JOB_ID"}))).into_response();
    };
    // 5. poll up to 35 x 3.5s
    for _ in 0..35 {
        tokio::time::sleep(std::time::Duration::from_millis(3500)).await;
        let gj = ihdr!(Some(&serial), client(), get, format!("https://api-v2.imgupscaler.ai/api/runtime/jobs/get-job/{}", job_id)).send().await;
        let Ok(r) = gj else { continue };
        let Ok(j) = r.json::<Value>().await else { continue };
        let code = j.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
        if code == 300006 { continue; } // processing
        if code == 100000 {
            let Some(output_url) = j.pointer("/result/output_url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Tidak ada output URL", "code": "NO_OUTPUT_URL"}))).into_response();
            };
            let dl = dl_client().get(&output_url).send().await;
            let bytes = match dl {
                Ok(r) if r.status().is_success() => r.bytes().await.unwrap_or_default().to_vec(),
                _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mengunduh hasil", "code": "DOWNLOAD_FAILED"}))).into_response(),
            };
            return img_response("image/jpeg", &bytes, &[
                ("X-Job-ID", job_id),
                ("X-Response-Time", format!("{}ms", start.elapsed().as_millis())),
            ]);
        }
        // failure code
        let msg = j.get("message").and_then(|v| v.as_str()).unwrap_or("Proses unblur gagal di upstream");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg, "code": "JOB_ERROR", "upstream_code": code}))).into_response();
    }
    (StatusCode::GATEWAY_TIMEOUT, Json(json!({"status": false, "message": "Unblur timeout setelah ~120 detik", "code": "TIMEOUT"}))).into_response()
}

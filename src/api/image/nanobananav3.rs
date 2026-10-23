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

// Nano Banana V3 — native conversion of api/image/nanobananav3.js
// imgupscaler.ai flow: upload slot → OSS PUT → signed URL → free-credits-config
// → create-job (nano_banana) → poll get-job → download result. Direct only.
const IUA: &str = "Mozilla/5.0";
const IHEADERS: &[(&str, &str)] = &[
    ("origin", "https://imgupscaler.ai"),
    ("referer", "https://imgupscaler.ai/"),
    ("user-agent", IUA),
];

fn genserial() -> String {
    use rand::Rng;
    let mut r = rand::thread_rng();
    (0..32).map(|_| format!("{:x}", r.gen_range(0..16))).collect()
}

async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    dl_client().get(url).send().await.map_err(|e| e.to_string())?.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

fn ihdr_apply(mut b: reqwest::RequestBuilder, serial: Option<&str>) -> reqwest::RequestBuilder {
    for (k, v) in IHEADERS { b = b.header(*k, *v); }
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
    let m = merged(&query, &body);
    let url = str_param(&m, "url").unwrap_or_else(|| "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg".into());
    let prompt = str_param(&m, "prompt").unwrap_or_else(|| "ubah agar dia tersenyum".into());
    let image = match download_image(&url).await {
        Ok(b) => b,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let filename = format!("nano_{}.jpg", chrono::Utc::now().timestamp_millis());
    // 1. upload slot
    let form_up = reqwest::multipart::Form::new().text("file_name", filename.clone());
    let up = ihdr!(None, client(), post, "https://api-v2.imgupscaler.ai/api/common/upload/upload-image").multipart(form_up).send().await;
    let upj: Value = match up { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) };
    let Some(upload_url) = upj.pointer("/result/url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mendapatkan slot upload dari upstream");
    };
    let Some(object_name) = upj.pointer("/result/object_name").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mendapatkan slot upload dari upstream");
    };
    // 2. OSS PUT
    let _ = dl_client().put(&upload_url)
                    .header("Content-Type", "image/jpeg")
        .body(image)
        .send().await;
    // 3. signed URL
    let form_sign = reqwest::multipart::Form::new()
        .text("object_name", object_name)
        .text("params", json!({"x-oss-process": "image/resize,m_fill,w_128,h_128/quality,q_80/format,webp"}).to_string());
    let sign = ihdr!(None, client(), post, "https://api-v2.imgupscaler.ai/api/common/upload/sign-object").multipart(form_sign).send().await;
    let signj: Value = match sign { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) };
    let Some(signed_url) = signj.pointer("/result/url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mendapatkan signed URL");
    };
    // 4. credits config + create job
    let serial = genserial();
    let _ = ihdr!(Some(&serial), client(), post, "https://api-v2.imgupscaler.ai/api/pai/common/free-credits-config").json(&json!({})).send().await;
    let form_job = reqwest::multipart::Form::new()
        .text("model_name", "nano_banana")
        .text("original_image_url", signed_url)
        .text("prompt", prompt.clone())
        .text("ratio", "match_input_image")
        .text("output_format", "jpg");
    let job = ihdr_apply(client()
                    .post("https://api-v2.imgupscaler.ai/api/runtime/jobs/create-job")
                    .header("product-code", "magiceraser")
                    .header("router-key", "photo_editor_nano_banana_v1")
                    .header("timezone", "Asia/Jakarta"), Some(&serial))
        .multipart(form_job)
        .send().await;
    let jobj: Value = match job { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) };
    let Some(job_id) = jobj.pointer("/result/job_id").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal membuat job editing di upstream");
    };
    // 5. poll
    let mut result: Value = Value::Null;
    let mut attempts = 0;
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(3500)).await;
        let gj = ihdr!(Some(&serial), client(), get, format!("https://api-v2.imgupscaler.ai/api/runtime/jobs/get-job/{}", job_id))
            .send().await;
        if let Ok(r) = gj {
            if let Ok(j) = r.json::<Value>().await {
                let code = j.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
                result = j.clone();
                if code != 300006 { break; }
            } else { break; }
        } else { break; }
        attempts += 1;
        if attempts >= 35 { break; }
    }
    if result.get("code").and_then(|v| v.as_i64()) != Some(100000) || result.pointer("/result/output_url").and_then(|v| v.as_str()).is_none() {
        let msg = result.get("message").and_then(|v| v.as_str()).unwrap_or("Proses editing gagal atau waktu habis");
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, msg);
    }
    let output_url = result.pointer("/result/output_url").and_then(|v| v.as_str()).unwrap_or("");
    match download_image(output_url).await {
        Ok(buf) => img_response("image/jpeg", &buf, &[("X-Prompt", prompt)]),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

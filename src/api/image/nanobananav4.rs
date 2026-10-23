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

// Nano Banana V4 — native conversion of api/image/nanobananav4.js
// photoeditorai.io: create-job (multipart, optional target_images) → poll
// get-job (status 2 done, 3 failed) → extract output URLs. Node rotated SOCKS5
// proxies from proxyscrape to bypass limits; this build has no proxy engine, so
// it runs direct-only (proxy rotation skipped, behaviour documented honestly).
const BASE: &str = "https://api.photoeditorai.io";
const NUA4: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";

const MODELS: &[(&str, &str)] = &[
    ("photoeditor3", "photoeditor_3.0"),
    ("photoeditor3pro", "photoeditor_3.0_pro"),
    ("photoeditor4", "photoeditor_4.0"),
    ("photoeditor4pro", "photoeditor_4.0_pro"),
    ("gpt", "gpt_image_2"),
    ("nanobanana", "nano_banana"),
    ("nanobanana2", "nano_banana_2"),
    ("nanobanana2lite", "nano_banana_2_lite"),
    ("nanobananapro", "nano_banana_pro"),
    ("qwen", "qwen"),
    ("seedream", "seedream"),
    ("seedream45", "seedream_45"),
    ("seedream5", "seedream_5"),
    ("fluxkontext", "flux_kontext"),
];
const DEFAULT_MODEL: &str = "photoeditor_3.0";
const NO_RESOLUTION_MODELS: &[&str] = &["photoeditor_3.0", "photoeditor_3.0_pro", "gpt_image_2", "nano_banana_2_lite"];

fn hex_serial() -> String {
    (0..32).map(|_| format!("{:02x}", rand::Rng::gen::<u8>(&mut rand::thread_rng()))).collect()
}

fn extract_urls(result: &Value) -> Vec<String> {
    for key in ["output", "output_images", "images", "result_images", "url", "image_url"] {
        if let Some(c) = result.get(key) {
            if let Some(s) = c.as_str() {
                if s.starts_with("http") { return vec![s.to_string()]; }
            }
            if let Some(arr) = c.as_array() {
                let urls: Vec<String> = arr.iter().filter_map(|u| u.as_str()).filter(|u| u.starts_with("http")).map(|s| s.to_string()).collect();
                if !urls.is_empty() { return urls; }
            }
        }
    }
    Vec::new()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
    let m = merged(&query, &body);
    let Some(prompt) = str_param(&m, "prompt") else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'prompt' wajib diisi",
            "example": {
                "text2image": "/api/image/nanobananav4?prompt=a futuristic city",
                "image2image": "/api/image/nanobananav4?url=https://example.com/photo.jpg&prompt=make it cyber"
            }
        }))).into_response();
    };
    let model_input = str_param(&m, "model");
    let model = match &model_input {
        Some(mi) => MODELS.iter().find(|(k, _)| k == &mi.as_str()).map(|(_, v)| v.to_string())
            .or_else(|| MODELS.iter().find(|(_, v)| v == mi).map(|(_, v)| v.to_string()))
            .unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        None => DEFAULT_MODEL.to_string(),
    };
    let image_url = str_param(&m, "url");
    let final_ratio = str_param(&m, "ratio").unwrap_or_else(|| if image_url.is_some() { "match_input_image".into() } else { "1:1".into() });
    let image: Option<Vec<u8>> = match &image_url {
        Some(u) => match dl_client().get(u).send().await {
            Ok(r) if r.status().is_success() => r.bytes().await.ok().map(|b| b.to_vec()),
            _ => return err_json(StatusCode::BAD_REQUEST, "Gagal download image: request gagal"),
        },
        None => None,
    };
    let image_ext = image.as_ref().map(|b| ext_from(detect_mime(b))).unwrap_or("jpg");
    // create job (direct)
    let mut form = reqwest::multipart::Form::new()
        .text("model_name", model.clone())
        .text("feature", "photo_editor")
        .text("prompt", prompt.clone())
        .text("ratio", final_ratio.clone());
    if !NO_RESOLUTION_MODELS.contains(&model.as_str()) {
        form = form.text("image_resolution", "1K");
    }
    if let Some(b) = &image {
        let part = reqwest::multipart::Part::bytes(b.clone())
            .file_name(format!("input.{}", image_ext))
            .mime_str(mime_of(image_ext)).unwrap();
        form = form.part("target_images", part);
    }
    let create = client().post(format!("{}/pe/photo-editor/create-job", BASE))
        .header("User-Agent", NUA4)
        .header("Product-Serial", hex_serial())
                    .header("Referer", "https://photoeditorai.io/")
                    .header("Origin", "https://photoeditorai.io")
        .multipart(form)
        .send().await;
    let create = match create {
        Ok(r) => r,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let cj: Value = create.json().await.unwrap_or(Value::Null);
    if cj.get("code").and_then(|v| v.as_i64()) == Some(400005) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Insufficient credits — seluruh kuota proxy habis");
    }
    if cj.get("code").and_then(|v| v.as_i64()) == Some(400006) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Daily limit reached");
    }
    let Some(job_id) = cj.pointer("/result/job_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))) else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal membuat job");
    };
    // poll up to 90s
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    let mut result: Option<Value> = None;
    let mut last_err = String::new();
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
        let poll = client().get(format!("{}/pe/photo-editor/get-job/{}?feature=photo_editor", BASE, job_id))
            .header("User-Agent", NUA4)
            .header("Product-Serial", hex_serial())
                        .header("Referer", "https://photoeditorai.io/")
            .send().await;
        if let Ok(r) = poll {
            if let Ok(j) = r.json::<Value>().await {
                let status = j.pointer("/result/status").and_then(|v| v.as_i64()).unwrap_or(0);
                if status == 2 { result = Some(j.get("result").cloned().unwrap_or(json!({}))); break; }
                if status == 3 {
                    last_err = format!("Job failed: {}", j.pointer("/result/error").and_then(|v| v.as_str()).unwrap_or("unknown"));
                    break;
                }
            }
        }
    }
    let Some(result) = result else {
        let msg = if last_err.is_empty() { "Timeout 90s" } else { &last_err };
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, msg);
    };
    let images = extract_urls(&result);
    if images.is_empty() {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Tidak ada URL gambar pada hasil pemrosesan");
    }
    Json(json!({
        "status": true,
        "result": {
            "prompt": prompt,
            "model": model,
            "ratio": final_ratio,
            "images": images,
            "responseTime": format!("{}ms", start.elapsed().as_millis())
        }
    })).into_response()
}

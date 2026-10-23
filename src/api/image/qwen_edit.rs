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

// Qwen Image Edit — native conversion of api/image/qwen-edit.js
// Gradio SSE flow: POST /gradio_api/call/edit_image (data: [json([dataURL]),
// prompt, model, 0, true, 1.0, 8]) → event_id → GET event stream → parse
// "complete" event → result URL/data-url → upload to host (qu.ax → tmpfiles →
// uguu). Node used authenticated HTTP proxies on quota errors; direct-only here.
const BASE: &str = "https://prithivmlmods-qwen-image-edit-object-manipulator.hf.space";
const QUA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

const AVAILABLE_MODELS: &[&str] = &[
    "Qwen-Image-Edit-2511-Object-Adder",
    "Qwen-Image-Edit-2511-Object-Remover",
    "QIE-2511-Object-Remover-v2",
    "Zoom-Master",
    "Extract-Outfit",
    "Outfit-Design-Layout",
];

fn resolve_model(input: Option<&str>) -> String {
    match input {
        None => "Qwen-Image-Edit-2511-Object-Adder".into(),
        Some(m) => {
            let t = m.trim();
            if AVAILABLE_MODELS.contains(&t) { t.to_string() }
            else {
                match t.to_lowercase().as_str() {
                    "adder" => "Qwen-Image-Edit-2511-Object-Adder".into(),
                    "remover" => "Qwen-Image-Edit-2511-Object-Remover".into(),
                    "remover-v2" | "remover2" => "QIE-2511-Object-Remover-v2".into(),
                    "zoom" => "Zoom-Master".into(),
                    "extract" | "extract-outfit" => "Extract-Outfit".into(),
                    "outfit" | "outfit-layout" => "Outfit-Design-Layout".into(),
                    _ => "Qwen-Image-Edit-2511-Object-Adder".into(),
                }
            }
        }
    }
}

async fn call_edit(b64: &str, prompt: &str, model: &str) -> Result<String, String> {
    let payload = json!({
        "data": [json!(format!("[\"{}\"]", b64.replace("\\", "\\\\").replace("\"", "\\\""))), prompt, model, 0, true, 1.0, 8]
    });
    let res = client().post(format!("{}/gradio_api/call/edit_image", BASE))
        .header("User-Agent", QUA)
                    .header("Content-Type", "application/json")
        .header("Origin", BASE)
        .header("Referer", format!("{}/", BASE))
        .json(&payload)
        
        .send().await.map_err(|e| e.to_string())?;
    let j: Value = res.json().await.unwrap_or(Value::Null);
    let event_id = j.get("event_id").and_then(|v| v.as_str()).map(|s| s.to_string())
        .or_else(|| j.as_str().map(|s| s.to_string()));
    event_id.ok_or_else(|| format!("event_id invalid: {}", &j.to_string()[..j.to_string().len().min(200)]))
}

async fn poll_result(event_id: &str) -> Result<String, String> {
    let full = format!("{}/gradio_api/call/edit_image/{}", BASE, urlencode(event_id));
    let res = client().get(&full)
        .header("User-Agent", QUA)
                    .header("Accept", "text/event-stream")
        .header("Origin", BASE)
        .header("Referer", format!("{}/", BASE))
        .send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    let mut last_event = String::new();
    for line in text.lines() {
        if let Some(e) = line.strip_prefix("event: ") {
            last_event = e.trim().to_string();
            continue;
        }
        let Some(raw) = line.strip_prefix("data: ") else { continue };
        let raw = raw.trim();
        if raw.is_empty() { continue; }
        let Ok(j) = serde_json::from_str::<Value>(raw) else { continue };
        let err_msg = j.get("error").or_else(|| j.get("message")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !err_msg.is_empty() {
            if err_msg.to_lowercase().contains("quota") {
                return Err(format!("QUOTA:{}", err_msg));
            }
            return Err(err_msg);
        }
        if last_event == "complete" || last_event == "process_completed" {
            let out = if j.is_array() { j.get(0).cloned() } else { j.pointer("/data/0").cloned() };
            if let Some(out) = out {
                if let Some(img) = out.get("image").and_then(|v| v.as_str()) { return Ok(img.to_string()); }
                if let Some(u) = out.get("url").and_then(|v| v.as_str()) { return Ok(u.to_string()); }
                if let Some(s) = out.as_str() {
                    if s.len() > 100 { return Ok(s.to_string()); }
                }
            }
        }
        if j.is_array() {
            if let Some(out) = j.get(0) {
                if let Some(img) = out.get("image").and_then(|v| v.as_str()) { return Ok(img.to_string()); }
            }
        }
    }
    Err("Tidak ada hasil dari gradio stream".into())
}

async fn upload_image(buf: Vec<u8>, filename: &str) -> Result<String, String> {
    // 1. qu.ax
    {
        let part = reqwest::multipart::Part::bytes(buf.clone()).file_name(filename.to_string());
        let form = reqwest::multipart::Form::new().part("files[]", part);
        if let Ok(r) = dl_client().post("https://qu.ax/upload.php").header("User-Agent", QUA).multipart(form).send().await {
            if let Ok(j) = r.json::<Value>().await {
                if let Some(u) = j.pointer("/files/0/url").and_then(|v| v.as_str()) { return Ok(u.to_string()); }
            }
        }
    }
    // 2. tmpfiles.org
    {
        let part = reqwest::multipart::Part::bytes(buf.clone()).file_name(filename.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);
        if let Ok(r) = dl_client().post("https://tmpfiles.org/api/v1/upload").header("User-Agent", QUA).multipart(form).send().await {
            if let Ok(j) = r.json::<Value>().await {
                if let Some(u) = j.pointer("/data/url").and_then(|v| v.as_str()) {
                    return Ok(u.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/"));
                }
            }
        }
    }
    // 3. uguu
    let part = reqwest::multipart::Part::bytes(buf).file_name(filename.to_string());
    let form = reqwest::multipart::Form::new().part("files[]", part);
    let r = dl_client().post("https://uguu.se/upload.php").header("User-Agent", QUA).multipart(form).send().await.map_err(|e| e.to_string())?;
    let j: Value = r.json().await.unwrap_or(Value::Null);
    j.pointer("/files/0/url").and_then(|v| v.as_str()).map(|s| s.to_string()).ok_or_else(|| "Gagal upload ke Uguu".into())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").filter(|s| !s.trim().is_empty()) else {
        return err_json(StatusCode::BAD_REQUEST, "Parameter 'url' atau file gambar wajib diisi");
    };
    let Some(prompt) = str_param(&m, "prompt").filter(|s| !s.trim().is_empty()) else {
        return err_json(StatusCode::BAD_REQUEST, "Parameter 'prompt' wajib diisi");
    };
    let selected_model = resolve_model(str_param(&m, "model").as_deref());
    // Resolve input: URL / data-url / base64
    let buf: Vec<u8> = if url.starts_with("http://") || url.starts_with("https://") {
        match dl_client().get(&url).send().await {
            Ok(r) if r.status().is_success() => match r.bytes().await { Ok(b) => b.to_vec(), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) },
            _ => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "File atau URL gambar tidak valid"),
        }
    } else if url.starts_with("data:") {
        match url.split_once(";base64,") {
            Some((_, d)) => match base64::engine::general_purpose::STANDARD.decode(d) {
                Ok(b) => b,
                Err(_) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "File atau URL gambar tidak valid"),
            },
            None => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "File atau URL gambar tidak valid"),
        }
    } else {
        match base64::engine::general_purpose::STANDARD.decode(&url) {
            Ok(b) if !b.is_empty() => b,
            _ => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "File atau URL gambar tidak valid"),
        }
    };
    let mime = detect_mime(&buf);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    let data_url = format!("data:{};base64,{}", mime, b64);
    let mut last_err = String::new();
    let mut result: Option<String> = None;
    for attempt in 1..=8 {
        match call_edit(&data_url, &prompt, &selected_model).await {
            Ok(eid) => match poll_result(&eid).await {
                Ok(r) => { result = Some(r); break; }
                Err(e) => {
                    if e.starts_with("QUOTA:") {
                        // Direct-only: no proxy fallback available; keep retrying direct.
                        last_err = e.trim_start_matches("QUOTA:").to_string();
                        continue;
                    }
                    last_err = e;
                    if attempt >= 8 { break; }
                }
            },
            Err(e) => { last_err = e; if attempt >= 8 { break; } }
        }
    }
    let Some(result) = result else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, &if last_err.is_empty() { "Gagal memproses Qwen Image Edit".into() } else { last_err });
    };
    let (result_buf, filename): (Vec<u8>, String) = if result.starts_with("http://") || result.starts_with("https://") {
        match dl_client().get(&result).send().await {
            Ok(r) if r.status().is_success() => match r.bytes().await {
                Ok(b) => { let b = b.to_vec(); let f = format!("qwen_{}.{}", chrono::Utc::now().timestamp_millis(), ext_from(detect_mime(&b))); (b, f) }
                Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            },
            _ => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mengunduh hasil"),
        }
    } else if result.starts_with("data:") {
        match result.split_once(";base64,") {
            Some((meta, d)) => match base64::engine::general_purpose::STANDARD.decode(d) {
                Ok(b) => { let mime = meta.trim_start_matches("data:"); (b, format!("qwen_{}.{}", chrono::Utc::now().timestamp_millis(), ext_from(mime))) }
                Err(_) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Format output tidak dikenali"),
            },
            None => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Format output tidak dikenali"),
        }
    } else {
        match base64::engine::general_purpose::STANDARD.decode(&result) {
            Ok(b) => { let mime = detect_mime(&b); (b, format!("qwen_{}.{}", chrono::Utc::now().timestamp_millis(), ext_from(mime))) }
            Err(_) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Format output tidak dikenali"),
        }
    };
    let out_mime = detect_mime(&result_buf);
    let link = match upload_image(result_buf.clone(), &filename).await {
        Ok(u) => u,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let format_param = str_param(&m, "format");
    let raw_param = str_param(&m, "raw");
    if format_param.as_deref() == Some("image") || raw_param.as_deref() == Some("true") {
        return img_response(out_mime, &result_buf, &[]);
    }
    Json(json!({
        "status": true,
        "result": {
            "prompt": prompt,
            "model": selected_model,
            "url": link,
            "responseTime": format!("{}ms", start.elapsed().as_millis())
        }
    })).into_response()
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{:02X}", b),
    }).collect()
}

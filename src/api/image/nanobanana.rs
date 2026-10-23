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

const API_UPLOAD: &str = "https://api.pixnova.ai/aitools/upload-img";
const API_CREATE: &str = "https://api.pixnova.ai/aitools/of/create";
const API_STATUS: &str = "https://api.pixnova.ai/aitools/of/check-status";

const FP: &str = "c74f54010942b009eaa50cd58a1f4419";
const FP1: &str = "3LXezMA2LSO2kESzl2EYNEQBUWOCDQ/oQMQaeP5kWWHbtCWoiTptGi2EUCOLjkdD";
const THEME_VERSION: &str = "83EmcUoQTUv50LhNx0VrdcK8rcGexcP35FcZDcpgWsAXEyO4xqL5shCY6sFIWB2Q";
const X_CODE: &str = "1752930995556";
const X_GUIDE: &str = "SjwMWX+LcTqkoPt48PIOgZzt3eQ93zxCGvzs1VpdikRR9b9+HvKM0Qiceq6Zusjrv8bUEtDGZdVqjQf/bdOXBb0vEaUUDRZ29EXYW0kt047grMMceXzd3zppZoHZj9DeXZOTGaG50PpTHxTjX3gb0D1wmfjol2oh7d5jJFSIsY0=";
const ORIGIN_FROM: &str = "111977c0d5def647";
const FN_NAME: &str = "demo-photo2anime";

fn pixnova_headers() -> Vec<(&'static str, String)> {
    let ua = pick_ua();
    let ip = pick_ip();
    vec![
        ("fp", FP.into()), ("fp1", FP1.into()),
        ("origin", "https://pixnova.ai".into()), ("referer", "https://pixnova.ai/".into()),
        ("theme-version", THEME_VERSION.into()), ("x-code", X_CODE.into()), ("x-guide", X_GUIDE.into()),
        ("accept-language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".into()),
        ("accept", "application/json, text/plain, */*".into()),
        ("user-agent", ua), ("X-Forwarded-For", ip.clone()), ("Client-IP", ip),
    ]
}

fn pick_ua() -> String {
    const UAS: &[&str] = &[
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Android 12; Mobile; rv:102.0) Gecko/102.0 Firefox/102.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15",
    ];
    UAS[rand::Rng::gen_range(&mut rand::thread_rng(), 0..UAS.len())].to_string()
}

fn pick_ip() -> String {
    use rand::Rng;
    let mut r = rand::thread_rng();
    format!("{}.{}.{}.{}", r.gen_range(0..256), r.gen_range(0..256), r.gen_range(0..256), r.gen_range(0..256))
}

async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    dl_client().get(url).send().await.map_err(|e| e.to_string())?.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

/// PixNova pipeline shared by nanobanana (custom prompt) and toanimev2 (fixed prompt).
/// Returns result image URL.
pub async fn pixnova_edit(image: Vec<u8>, prompt: &str) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(image).file_name("image.jpg").mime_str("image/jpeg").unwrap();
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("fn_name", FN_NAME)
        .text("request_from", "2")
        .text("origin_from", ORIGIN_FROM);
    let mut req = client().post(API_UPLOAD);
    for (k, v) in pixnova_headers() { req = req.header(k, &v); }
    let up = req.multipart(form).send().await.map_err(|e| e.to_string())?;
    let upj: Value = up.json().await.unwrap_or(Value::Null);
    let Some(source_path) = upj.pointer("/data/path").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return Err("Gagal upload gambar ke PixNova".into());
    };
    let task_payload = json!({
        "fn_name": FN_NAME,
        "call_type": 3,
        "input": {
            "source_image": source_path,
            "strength": 0.6,
            "prompt": format!("{}, high quality, hd, detailed", prompt),
            "negative_prompt": "(worst quality, low quality:1.4), (greyscale, monochrome:1.1), cropped, lowres, blurry, watermark, text",
            "request_from": 2
        },
        "request_from": 2,
        "origin_from": ORIGIN_FROM
    });
    let mut req = client().post(API_CREATE);
    for (k, v) in pixnova_headers() { req = req.header(k, &v); }
    let task = req.json(&task_payload).send().await.map_err(|e| e.to_string())?;
    let tj: Value = task.json().await.unwrap_or(Value::Null);
    let Some(task_id) = tj.pointer("/data/task_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))) else {
        return Err("Gagal membuat task editing".into());
    };
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        let mut req = client().post(API_STATUS);
        for (k, v) in pixnova_headers() { req = req.header(k, &v); }
        let st = req.json(&json!({
            "task_id": task_id, "fn_name": FN_NAME, "call_type": 3, "request_from": 2, "origin_from": ORIGIN_FROM
        })).send().await.map_err(|e| e.to_string())?;
        let sj: Value = st.json().await.unwrap_or(Value::Null);
        let d = sj.get("data").cloned().unwrap_or(json!({}));
        if d.get("status").and_then(|v| v.as_i64()) == Some(2) {
            if let Some(ri) = d.get("result_image").and_then(|v| v.as_str()) {
                return Ok(if ri.starts_with("http") { ri.to_string() } else { format!("https://oss-global.pixnova.ai/{}", ri) });
            }
        }
    }
    Err("Waktu habis, proses editing gagal".into())
}

// Nano Banana — native conversion of api/image/nanobanana.js
// PixNova flow natively; prompt is customizable. Sends PNG image bytes.
pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let url = str_param(&m, "url").unwrap_or_else(|| "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg".into());
    let prompt = str_param(&m, "prompt").unwrap_or_else(|| "ubah kulitnya jadi agak lebih putih".into());
    let image = match download_image(&url).await {
        Ok(b) => b,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    match pixnova_edit(image, &prompt).await {
        Ok(result_url) => match download_image(&result_url).await {
            Ok(buf) => img_response("image/png", &buf, &[("X-Prompt", prompt)]),
            Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
        },
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

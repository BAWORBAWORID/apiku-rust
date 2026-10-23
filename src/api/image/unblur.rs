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

// Image Unblur (Sharpen) — native conversion of api/image/unblur.js
// Node used Jimp.convolute with an unsharp kernel: center 1+amount, sides
// -amount/9. Replicated with the `image` crate's manual convolution; JPEG out.
pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").filter(|s| !s.trim().is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' wajib diisi", "code": "MISSING_URL"}))).into_response();
    };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Format URL tidak valid", "code": "INVALID_URL"}))).into_response();
    }
    let level = match str_param(&m, "level") {
        None => 3,
        Some(l) => match l.parse::<i64>() {
            Ok(n) if (1..=5).contains(&n) => n,
            Ok(_) => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'level' harus salah satu dari: 1, 2, 3, 4, 5", "code": "INVALID_LEVEL_RANGE", "valid_levels": [1,2,3,4,5]}))).into_response(),
            Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'level' harus berupa angka yang valid", "code": "INVALID_LEVEL_NAN", "valid_levels": [1,2,3,4,5]}))).into_response(),
        },
    };
    let sharpen_amount = level as f32 * 0.5;
    let res = dl_client().get(&url).send().await;
    let res = match res {
        Ok(r) if r.status().is_success() => r,
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Timeout saat download gambar", "code": "TIMEOUT"}))).into_response(),
    };
    if !res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|c| c.starts_with("image/")).unwrap_or(false) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "URL harus mengarah ke file gambar", "code": "INVALID_CONTENT_TYPE"}))).into_response();
    }
    let bytes = res.bytes().await.unwrap_or_default();
    let Some(out) = process_sharpen(&bytes, sharpen_amount) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal memproses gambar", "code": "PROCESS_FAILED"}))).into_response();
    };
    img_response("image/jpeg", &out, &[
        ("X-Sharpen-Level", level.to_string()),
        ("X-Sharpen-Amount", format!("{:.1}", sharpen_amount)),
    ])
}

fn process_sharpen(bytes: &[u8], amount: f32) -> Option<Vec<u8>> {
    use image::DynamicImage;
    let img = image::load_from_memory(bytes).ok()?.to_rgb8();
    let (w, h) = img.dimensions();
    let side = -amount / 9.0;
    let k = [[side, side, side], [side, 1.0 + amount, side], [side, side, side]];
    let mut out = image::RgbImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0f32; 3];
            for dy in 0..3i64 {
                for dx in 0..3i64 {
                    let sx = (x as i64 + dx - 1).clamp(0, w as i64 - 1) as u32;
                    let sy = (y as i64 + dy - 1).clamp(0, h as i64 - 1) as u32;
                    let p = img.get_pixel(sx, sy);
                    let wgt = k[dy as usize][dx as usize];
                    for c in 0..3 { acc[c] += p[c] as f32 * wgt; }
                }
            }
            let mut px = [0u8; 3];
            for c in 0..3 { px[c] = acc[c].round().clamp(0.0, 255.0) as u8; }
            out.put_pixel(x, y, image::Rgb(px));
        }
    }
    let mut jpeg = std::io::Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(out).write_to(&mut jpeg, image::ImageFormat::Jpeg).ok()?;
    Some(jpeg.into_inner())
}

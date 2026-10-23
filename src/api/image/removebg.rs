// Ghibli Style Generator — native conversion of api/image/gibli.js
// Full native flow: download image → base64 data URL → ghibli-proxy netlify
// function (gpt-image-1) → decode b64_json or fetch result URL → PNG bytes.
const UA_FIREFOX: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
const API_KEY: &str = "AIzaSy...CEq0";

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

// RemoveBG — native conversion of api/image/removebg.js
// images.weserv.nl (unsigned) with primary fallback to signed URLs via the
// refresh-token cache; then pngimg.com/lunapic for JPEGs with alpha failure.
const WESERV: &str = "https://images.weserv.nl/?&url={}&output=png&af=&rop%%5B%%5D=trimfuzzy";
const TOKEN_CACHE: &str = "/tmp/rbg_tokens.json";
const STATIC_TOKEN_URL: &str = "https://editor.pixlr.com/assets/desktop-vendor.c6c8f39d.js";

async fn fetch_refresh_token(dl: bool) -> Option<String> {
    let rt = reqwest::Client::builder().danger_accept_invalid_certs(false).build().ok()?;
    let resp = rt.get(STATIC_TOKEN_URL).header("User-Agent", UA_FIREFOX).send().await.ok()?;
    let body = resp.text().await.ok()?;
    let re = regex::Regex::new("[A-Za-z0-9+/]{150,}={0,2}").ok()?;
    let mut cands: Vec<&str> = re.find_iter(&body).map(|m| m.as_str()).collect();
    if dl { cands.reverse(); }
    for c in cands {
        if let Ok(b) = base64::engine::general_purpose::STANDARD.decode(c) {
            if b.starts_with(b"{") {
                if let Ok(j) = serde_json::from_str::<Value>(std::str::from_utf8(&b).unwrap_or("")) {
                    if let Some(t) = j.get("refresh_token").and_then(|v| v.as_str()) {
                        return Some(t.to_string());
                    }
                }
            }
        }
    }
    None
}

async fn refresh_id_token(refresh_token: &str) -> Option<String> {
    let rt = reqwest::Client::new();
    let res = rt.post(format!("https://securetoken.googleapis.com/v1/token?key={}", API_KEY))
        .json(&json!({"grant_type": "refresh_token", "refresh_token": refresh_token}))
        .send().await.ok()?;
    let j: Value = res.json().await.ok()?;
    j.get("id_token").and_then(|v| v.as_str()).map(|s| s.to_string())
}

async fn get_token(dl: bool) -> Option<String> {
    if let Ok(txt) = std::fs::read_to_string(TOKEN_CACHE) {
        if let Ok(j) = serde_json::from_str::<Value>(&txt) {
            if let Some(t) = j.get("id_token").and_then(|v| v.as_str()) {
                if dl == t.split('.').nth(2).map(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).map(|b| serde_json::from_str::<Value>(std::str::from_utf8(&b).unwrap_or("")).ok().and_then(|c| c.get("dl").map(|d| d == "dl")).unwrap_or(false)).unwrap_or(false)).unwrap_or(false) {
                    return Some(t.to_string());
                }
            }
        }
    }
    let rt = fetch_refresh_token(dl).await?;
    let idt = refresh_id_token(&rt).await?;
    let _ = std::fs::write(TOKEN_CACHE, json!({"id_token": idt}).to_string());
    Some(idt)
}

async fn upload_image_url(buf: Vec<u8>, mime: &str) -> Result<String, String> {
    let Some(idt) = get_token(false).await else { return Err("Gagal mendapatkan token Pixlr".into()) };
    let rt = reqwest::Client::new();
    let res = rt.post("https://pixlr.com/api/v2/image/upload")
        .header("Authorization", format!("Bearer {}", idt))
        .json(&json!({"FileName": format!("image.{}", ext_from(mime)), "FileSize": buf.len(), "ImageData": format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(&buf)), "FileType": mime}))
        .send().await.map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    j.get("url").and_then(|v| v.as_str()).map(|s| s.to_string()).ok_or_else(|| "URL upload tidak ditemukan di respons Pixlr".into())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(url) = str_param(&m, "url").or_else(|| str_param(&m, "image")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'url' wajib diisi"}))).into_response();
    };
    let type_param = str_param(&m, "type").unwrap_or_default();
    let dl = type_param == "image";
    let img = dl_client().get(&url).send().await;
    let img = match img {
        Ok(r) if r.status().is_success() => r,
        _ => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mengunduh gambar"),
    };
    let mime = img.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    let buf = img.bytes().await.unwrap_or_default().to_vec();
    // Primary: weserv unsigned
    let target = urlencode(url.trim_start_matches("https://").trim_start_matches("http://"));
    let weserv_url = format!("{}output=png&af=&rop%5B%5D=trimfuzzy", WESERV.replace("https://images.weserv.nl/?&url={}", "https://images.weserv.nl/?url="));
    let _ = &target;
    let mut candidate_urls: Vec<String> = Vec::new();
    // signed pixlr requires upload first
    if let Ok(u) = upload_image_url(buf.clone(), &mime).await {
        let encoded = urlencode(u.trim_start_matches("https://").trim_start_matches("http://"));
        candidate_urls.push(format!("https://images.weserv.nl/?url={}&output=png&af=&rop%5B%5D=trimfuzzy", encoded));
    }
    candidate_urls.push(format!("https://images.weserv.nl/?url={}&output=png&af=&rop%5B%5D=trimfuzzy", target));
    let mut png: Option<Vec<u8>> = None;
    for u in &candidate_urls {
        if let Ok(r) = dl_client().get(u).send().await {
            if r.status().is_success() {
                if let Ok(b) = r.bytes().await {
                    let b = b.to_vec();
                    if detect_mime(&b) == "image/png" { png = Some(b); break; }
                }
            }
        }
    }
    let Some(png) = png else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal menghapus background");
    };
    if dl {
        return img_response("image/png", &png, &[("X-Processor", "removebg".to_string())]);
    }
    let data_url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png));
    Json(json!({"status": true, "result": {"url": data_url}})).into_response()
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{:02X}", b),
    }).collect()
}

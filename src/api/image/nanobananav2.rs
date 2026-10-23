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

// Nano Banana V2 — native conversion of api/image/nanobananav2.js
// nanobanana.im flow: tempmail.ing address → magic-link sign-in → poll inbox
// for verify link → session cookies → presigned URL upload → create task →
// poll taskResult → fetch result image.
const NUA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

type Cookies = Vec<String>;

fn cookie_header(c: &Cookies) -> String {
    c.iter().map(|x| x.split(';').next().unwrap_or("")).collect::<Vec<_>>().join("; ")
}

fn nheaders() -> Vec<(&'static str, &'static str)> {
    vec![
        ("user-agent", NUA),
        ("accept", "application/json, text/plain, */*"),
        ("accept-language", "id,en;q=0.9"),
        ("origin", "https://nanobanana.im"),
    ]
}

fn req_post(headers: Vec<(&'static str, &'static str)>, cookies: Option<&Cookies>, url: impl Into<String>) -> reqwest::RequestBuilder {
    let mut r = client().post(url.into());
    for (k, v) in headers { r = r.header(k, v); }
    if let Some(c) = cookies { r = r.header("Cookie", cookie_header(c)); }
    r
}
fn req_get(headers: Vec<(&'static str, &'static str)>, cookies: Option<&Cookies>, url: impl Into<String>) -> reqwest::RequestBuilder {
    let mut r = client().get(url.into());
    for (k, v) in headers { r = r.header(k, v); }
    if let Some(c) = cookies { r = r.header("Cookie", cookie_header(c)); }
    r
}
fn req_with(headers: Vec<(&'static str, &'static str)>, cookies: Option<&Cookies>) -> reqwest::Client {
    client()
}

async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    dl_client().get(url).send().await.map_err(|e| e.to_string())?.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let url = str_param(&m, "url").unwrap_or_else(|| "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg".into());
    let prompt = str_param(&m, "prompt").unwrap_or_else(|| "ubah rambutnya jadi warna merah".into());
    let image = match download_image(&url).await {
        Ok(b) => b,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let mut cookies: Cookies = Vec::new();
    // 1. temp mail
    let mail = req_post(nheaders(), None, "https://api.tempmail.ing/api/generate").json(&json!({})).send().await;
    let mailj: Value = match mail { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) };
    if mailj.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal generate temp mail");
    }
    let email = mailj.pointer("/email/address").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // 2. init cookies
    if let Ok(r) = req_get(nheaders(), None, "https://nanobanana.im/").send().await {
        for sc in r.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = sc.to_str() { cookies.push(s.to_string()); }
        }
    }
    // 3. magic link request
    let _ = req_post(nheaders(), Some(&cookies), "https://nanobanana.im/api/auth/sign-in/magic-link")
                    .header("content-type", "application/json")
        .json(&json!({ "email": email, "callbackURL": "/" }))
        .send().await;
    // 4. poll inbox
    let mut magic_link: Option<String> = None;
    for _ in 0..25 {
        if let Ok(r) = req_get(nheaders(), None, format!("https://api.tempmail.ing/api/emails/{}", urlencode(&email))).send().await {
            if let Ok(j) = r.json::<Value>().await {
                if j.get("success").and_then(|v| v.as_bool()) == Some(true) {
                    if let Some(emails) = j.get("emails").and_then(|v| v.as_array()) {
                        if let Some(first) = emails.first() {
                            let text = first.get("text").and_then(|v| v.as_str()).or_else(|| first.get("html").and_then(|v| v.as_str())).unwrap_or("");
                            let re = regex::Regex::new(r#"https://nanobanana\.im/api/auth/magic-link/verify\?[^\s"']+"#).unwrap();
                            if let Some(mm) = re.captures(text) {
                                magic_link = Some(mm.get(0).map(|m| m.as_str().to_string()).unwrap_or_default());
                                break;
                            }
                        }
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    }
    let Some(magic_link) = magic_link else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mendapatkan magic link email");
    };
    // 5. verify (no redirects)
    let verify = client().get(&magic_link)
        .header("Cookie", cookie_header(&cookies))
        .header("user-agent", NUA)
        .send().await;
    if let Ok(r) = verify {
        for sc in r.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = sc.to_str() { cookies.push(s.to_string()); }
        }
    }
    if let Ok(r) = req_get(nheaders(), Some(&cookies), "https://nanobanana.im/").send().await {
        for sc in r.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = sc.to_str() { cookies.push(s.to_string()); }
        }
    }
    // 6. presigned url
    let pres = req_post(nheaders(), Some(&cookies), "https://nanobanana.im/api/presigned-urls")
                    .header("Content-Type", "text/plain;charset=UTF-8")
        .body(json!({ "count": 1, "fileType": "image/jpeg" }).to_string())
        .send().await;
    let presj: Value = match pres { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) };
    if presj.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mendapatkan presigned URL");
    }
    let upload_url = presj.pointer("/urls/0/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let key = presj.pointer("/urls/0/key").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // 7. upload
    let _ = dl_client().put(&upload_url)            .header("Content-Type", "image/jpeg").header("user-agent", NUA).body(image).send().await;
    // 8. create task
    let task = req_post(nheaders(), Some(&cookies), "https://nanobanana.im/api/img/nano-banana5")
                    .header("content-type", "application/json")
        .json(&json!({
            "prompt": prompt, "dimension": "auto", "aspect_ratio": "auto",
            "image_urls": [format!("https://temp.videostudioai.com/{}", key)],
            "num_images": "1", "batchSize": 1, "turnstileToken": "",
            "skipVerification": true, "image_path": "hero", "size": "2K",
            "resolution": "2K", "output_format": "png"
        }))
        .send().await;
    let taskj: Value = match task { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()) };
    let Some(task_id) = taskj.get("taskId").cloned().unwrap_or(Value::Null).as_str().map(|s| s.to_string())
        .or_else(|| taskj.get("taskId").and_then(|v| v.as_i64().map(|n| n.to_string()))) else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Gagal membuat task editing");
    };
    // 9. poll
    let mut result_url: Option<String> = None;
    for _ in 0..40 {
        if let Ok(r) = req_post(nheaders(), Some(&cookies), "https://nanobanana.im/api/img/nano-banana5/taskResult")
                        .header("content-type", "application/json")
            .json(&json!({ "taskId": task_id }))
            .send().await
        {
            if let Ok(j) = r.json::<Value>().await {
                if j.get("status").and_then(|v| v.as_i64()) == Some(1) {
                    result_url = j.get("imgAfterSrc").and_then(|v| v.as_str()).map(|s| s.to_string());
                    if result_url.is_some() { break; }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    }
    let Some(result_url) = result_url else {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, "Waktu habis menunggu hasil");
    };
    match download_image(&result_url).await {
        Ok(buf) => img_response("image/png", &buf, &[("X-Prompt", prompt)]),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{:02X}", b),
    }).collect()
}

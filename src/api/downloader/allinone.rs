// All-In-One Downloader (downr.org + retatube fallback) — native conversion of api/downloader/allinone.js
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE: &str = "https://downr.org";
const ANALYTICS: &str = "https://downr.org/.netlify/functions/analytics";
const DOWNLOAD: &str = "https://downr.org/.netlify/functions/download";
const NYT: &str = "https://downr.org/.netlify/functions/nyt";
const RETATUBE: &str = "https://retatube.com";
const RETATUBE_HTML: &str = "https://retatube.com/api/v1/aio/html";

const UA: &str = "Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36";

fn parse_cookie(headers: &reqwest::header::HeaderMap) -> String {
    headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

fn parse_data(raw: &str) -> Value {
    let t = raw.trim();
    serde_json::from_str(t).unwrap_or(Value::String(t.to_string()))
}

fn is_ok(status: u16, data: &Value) -> bool {
    if !(200..300).contains(&status) { return false; }
    match data {
        Value::Null => false,
        Value::String(s) => {
            let s = s.as_str();
            !(s.is_empty() || s == "error" || s == "failed" || s == "user_retry_required")
        }
        Value::Object(o) => {
            if o.get("error").and_then(|e| e.as_bool()) == Some(true) { return false; }
            if o.get("status").and_then(|s| s.as_bool()) == Some(false) { return false; }
            if o.get("success").and_then(|s| s.as_bool()) == Some(false) { return false; }
            true
        }
        _ => true,
    }
}

fn get_error(data: &Value, status: u16) -> String {
    match data {
        Value::String(s) => {
            if s.is_empty() { format!("HTTP {status}") } else { s.clone() }
        }
        Value::Object(o) => ["message", "error", "status", "reason"]
            .iter()
            .find_map(|k| o.get(*k).and_then(|v| v.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("HTTP {status}")),
        _ => format!("HTTP {status}"),
    }
}

fn post_headers(cookie: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    h.insert("accept", mk("*/*"));
    h.insert("accept-language", mk("id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"));
    h.insert("content-type", mk("application/json"));
    if !cookie.is_empty() {
        h.insert("cookie", mk(cookie));
    }
    h.insert("origin", mk(BASE));
    h.insert("referer", mk(&format!("{BASE}/")));
    h.insert("sec-ch-ua", mk("\"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\""));
    h.insert("sec-ch-ua-mobile", mk("?1"));
    h.insert("sec-ch-ua-platform", mk("\"Android\""));
    h.insert("sec-fetch-dest", mk("empty"));
    h.insert("sec-fetch-mode", mk("cors"));
    h.insert("sec-fetch-site", mk("same-origin"));
    h.insert("user-agent", mk(UA));
    h
}

async fn get_cookie(client: &reqwest::Client) -> String {
    match client
        .get(ANALYTICS)
                    .header("accept", "*/*")
        .header("referer", format!("{BASE}/"))
        .header("user-agent", UA)
        .send()
        .await
    {
        Ok(r) => parse_cookie(r.headers()),
        Err(_) => String::new(),
    }
}

async fn post_endpoint(client: &reqwest::Client, endpoint: &str, url: &str, cookie: &str) -> (u16, Value) {
    let body = json!({ "url": url }).to_string();
    match client
        .post(endpoint)
        .headers(post_headers(cookie))
        .body(body)
        .send()
        .await
    {
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            (status, parse_data(&text))
        }
        Err(_) => (500, Value::String("request failed".into())),
    }
}

async fn try_download(client: &reqwest::Client, url: &str) -> (u16, Value) {
    let cookie = get_cookie(client).await;
    let mut result = post_endpoint(client, DOWNLOAD, url, &cookie).await;
    if is_ok(result.0, &result.1) {
        return result;
    }
    let cookie = get_cookie(client).await;
    result = post_endpoint(client, DOWNLOAD, url, &cookie).await;
    if is_ok(result.0, &result.1) {
        return result;
    }
    post_endpoint(client, NYT, url, &cookie).await
}

async fn retatube_fallback(client: &reqwest::Client, url: &str) -> Result<(u16, Value), String> {
    let resp = client
        .post(RETATUBE_HTML)
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36")
        .header("Referer", format!("{RETATUBE}/"))
        .header("Origin", RETATUBE)
        .json(&json!({ "vid": url, "prefix": "retatube.com", "ex": "", "format": "" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let html = resp.text().await.map_err(|e| e.to_string())?;

    let section = match html.find("download-section") {
        Some(_) => html,
        None => return Err("No download results found".into()),
    };
    // extract section inner html (rough, tag-based)
    let sec_start = section.find("download-section").unwrap();
    let seg = &section[sec_start.saturating_sub(30)..];

    let title = {
        let t = attr_text_after(seg, "<h3");
        if t.is_empty() { attr_text_after(seg, "wrap-break-word") } else { t }
    };
    let owner = {
        // "p strong" parent text: find <strong> then take following text until closing p
        let mut o = String::new();
        if let Some(i) = seg.find("<strong>") {
            let after = &seg[i + 8..];
            if let Some(end) = after.find("</p>") {
                let chunk = &after[..end];
                let last_gt = chunk.rfind('>').map(|p| p + 1).unwrap_or(0);
                o = chunk[last_gt..].trim().to_string();
            }
        }
        o.trim_start_matches("Owner:").trim().to_string()
    };
    let thumbnail = attr_value_near(seg, "<img", "src");
    let mut downloads: Vec<Value> = Vec::new();
    let mut rest = seg;
    while let Some(i) = rest.find("download-btn") {
        let chunk = &rest[i..];
        let href = attr_value_near(chunk, "<a", "href");
        if !href.is_empty() && !href.starts_with('#') {
            let label = attr_text_after(chunk, "<a");
            downloads.push(json!({ "label": label, "url": href }));
        }
        rest = &rest[i + 12..];
    }

    Ok((
        status,
        json!({ "title": if title.is_empty() { Value::Null } else { json!(title) },
                "owner": if owner.is_empty() { Value::Null } else { json!(owner) },
                "thumbnail": thumbnail, "downloads": downloads }),
    ))
}

fn attr_value_near<'a>(html: &'a str, tag: &str, attr: &str) -> String {
    match html.find(tag) {
        Some(i) => {
            let seg = &html[i..];
            let pat = format!("{attr}=\"");
            match seg.find(&pat) {
                Some(j) => {
                    let rest = &seg[j + pat.len()..];
                    rest.split('"').next().unwrap_or("").to_string()
                }
                None => String::new(),
            }
        }
        None => String::new(),
    }
}

fn attr_text_after(html: &str, tag: &str) -> String {
    match html.find(tag) {
        Some(i) => {
            let seg = &html[i..];
            match seg.find('>') {
                Some(j) => {
                    let rest = &seg[j + 1..];
                    match rest.find('<') {
                        Some(e) => rest[..e].trim().to_string(),
                        None => String::new(),
                    }
                }
                None => String::new(),
            }
        }
        None => String::new(),
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL tidak valid"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let (mut status, mut data) = try_download(&client, &url).await;
    let mut ok = is_ok(status, &data);

    if !ok && get_error(&data, status).to_lowercase().contains("action_forbidden") {
        if let Ok(fallback) = retatube_fallback(&client, &url).await {
            if is_ok(fallback.0, &fallback.1) {
                data = fallback.1;
                status = fallback.0;
                ok = true;
            }
        }
    }

    let code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    if ok {
        Json(json!({
            "status": true,
            "result": data,
            "endpoint": if data.as_object().map(|o| o.contains_key("downloads")).unwrap_or(false) { RETATUBE_HTML } else { DOWNLOAD },
            "input": url
        }))
        .into_response()
    } else {
        (code, Json(json!({
            "status": false,
            "message": get_error(&data, status),
            "input": url
        }))).into_response()
    }
}

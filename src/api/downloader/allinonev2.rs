// All-In-One Downloader v2 (retatube.com) — native conversion of api/downloader/allinonev2.js
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://retatube.com";
const PREFIX: &str = "retatube.com";

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    h.insert("Content-Type", mk("application/json"));
    h.insert("User-Agent", mk("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36"));
    h.insert("Referer", mk(&format!("{BASE_URL}/")));
    h.insert("Origin", mk(BASE_URL));
    h
}

fn attr_value<'a>(tag: &'a str, attr: &str) -> String {
    let pat = format!("{attr}=\"");
    match tag.find(&pat) {
        Some(j) => tag[j + pat.len()..].split('"').next().unwrap_or("").to_string(),
        None => String::new(),
    }
}

fn text_after(html: &str, tag: &str) -> String {
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

fn parse_html(html: &str) -> Result<Value, String> {
    let sec_idx = match html.find("download-section") {
        Some(i) => i,
        None => return Err("No download results found".into()),
    };
    let seg = &html[sec_idx.saturating_sub(30)..];

    let mut title = text_after(seg, "<h3");
    if title.is_empty() {
        title = text_after(seg, "wrap-break-word");
    }
    let mut owner = String::new();
    if let Some(i) = seg.find("<strong>") {
        let after = &seg[i + 8..];
        if let Some(end) = after.find("</p>") {
            let chunk = &after[..end];
            let last_gt = chunk.rfind('>').map(|p| p + 1).unwrap_or(0);
            owner = chunk[last_gt..].trim().to_string();
        }
    }
    owner = owner.trim_start_matches("Owner:").trim().to_string();
    let thumbnail = attr_value(seg.split('<').find(|t| t.starts_with("img ")).map(|t| t).unwrap_or(""), "src");

    let mut links: Vec<Value> = Vec::new();
    let mut rest = seg;
    while let Some(i) = rest.find("download-btn") {
        let chunk = &rest[i..];
        if let Some(a_start) = chunk.find("<a") {
            let a_end = chunk[a_start..].find('>').map(|p| a_start + p).unwrap_or(a_start);
            let tag = &chunk[a_start..=a_end.min(chunk.len() - 1)];
            let href = attr_value(tag, "href");
            let label = {
                let after_gt = &chunk[a_end + 1..];
                after_gt.split('<').next().unwrap_or("").trim().to_string()
            };
            if !href.is_empty() && !href.starts_with('#') {
                links.push(json!({ "label": label, "url": href }));
            }
        }
        rest = &rest[i + 12..];
    }

    Ok(json!({
        "title": if title.is_empty() { Value::Null } else { json!(title) },
        "owner": if owner.is_empty() { Value::Null } else { json!(owner) },
        "thumbnail": if thumbnail.is_empty() { Value::Null } else { json!(thumbnail) },
        "downloads": links
    }))
}

async fn post_aio(client: &reqwest::Client, path: &str, url: &str, format: &str) -> Result<String, String> {
    let resp = client
        .post(format!("{BASE_URL}{path}"))
        .headers(headers())
        .json(&json!({ "vid": url, "prefix": PREFIX, "ex": "", "format": format }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "format"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };
    let format = merged.get("format").cloned().unwrap_or_default();

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
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

    let result: Result<Value, String> = if !format.is_empty() {
        (|| async {
            let search_resp = post_aio(&client, "/api/v1/aio/search", &url, &format).await?;
            let as_json: Value = serde_json::from_str(&search_resp).unwrap_or(Value::Null);
            if as_json.get("code").and_then(|c| c.as_i64()) == Some(-1) {
                let html = post_aio(&client, "/api/v1/aio/html", &url, &format).await?;
                parse_html(&html)
            } else {
                parse_html(&search_resp)
            }
        })().await
    } else {
        (|| async {
            let html = post_aio(&client, "/api/v1/aio/html", &url, "").await?;
            parse_html(&html)
        })().await
    };

    match result {
        Ok(parsed) => Json(json!({
            "status": true,
            "input": url,
            "title": parsed.get("title"),
            "owner": parsed.get("owner"),
            "thumbnail": parsed.get("thumbnail"),
            "downloads": parsed.get("downloads")
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e, "input": url
        }))).into_response(),
    }
}

// SaveFromIns Downloader — native conversion of api/downloader/savefromins.js
// Scrape savefromins.com Next.js chunks untuk auth/domain/reqUrl, lalu POST /media/parse
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const BASE: &str = "https://savefromins.com";

fn find_pattern(js: &str, key: &str) -> Option<String> {
    let marker = format!("{key}:\"");
    let pos = js.find(&marker)? + marker.len();
    let rest = &js[pos..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

async fn session_config(client: &reqwest::Client) -> Result<(String, String, String), String> {
    let html = client
        .get(BASE)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let mut chunks: Vec<String> = Vec::new();
    let mut rest: &str = &html;
    while let Some(idx) = rest.find("<script") {
        let after = &rest[idx..];
        let end = after.find("</script>").unwrap_or(after.len().min(800));
        if let Some(src) = after[..end].split("src=\"").nth(1).and_then(|s| s.split('"').next()) {
            if src.contains("/_next/static/chunks/") {
                let full = if src.starts_with("http") { src.to_string() } else { format!("{BASE}{src}") };
                chunks.push(full);
            }
        }
        rest = &after[end..];
    }

    let mut auth: Option<String> = None;
    let mut domain: Option<String> = None;
    let mut req_url: Option<String> = None;
    for url in chunks {
        if auth.is_some() && domain.is_some() && req_url.is_some() {
            break;
        }
        let js = match client.get(&url).header("User-Agent", UA).send().await {
            Ok(r) => r.text().await.unwrap_or_default(),
            Err(_) => continue,
        };
        if auth.is_none() && js.contains("media/parse") {
            if let Some(a) = find_pattern(&js, "auth") {
                auth = Some(a);
            }
        }
        if domain.is_none() {
            domain = find_pattern(&js, "VIDEODOWNLOAD");
        }
        if req_url.is_none() {
            req_url = find_pattern(&js, "REQ_URL");
        }
    }

    match (auth, domain, req_url) {
        (Some(a), Some(d), Some(r)) => Ok((a, d, r)),
        _ => Err("Config auth/domain/reqUrl tidak ditemukan".into()),
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
            "status": false, "message": "Parameter 'url' harus berupa URL http/https"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload dari SaveFromIns: {e}"),
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    let (auth, domain, req_url) = match session_config(&client).await {
        Ok(c) => c,
        Err(msg) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    let form = [("auth", auth.as_str()), ("domain", domain.as_str()), ("origin", "source"), ("link", url.as_str())];
    let payload: Value = match client
        .post(format!("{req_url}/media/parse"))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Origin", BASE)
        .header("Referer", format!("{BASE}/"))
                    .header("Accept", "*/*")
        .form(&form)
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload dari SaveFromIns: {e}"),
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    let ok = payload.get("status").and_then(|s| s.as_i64()) == Some(1) && payload.get("data").is_some();
    let resources = payload
        .get("data")
        .and_then(|d| d.get("resources"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    if !ok || resources.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Gagal memproses URL",
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response();
    }

    let d = payload.get("data").unwrap();
    let links: Vec<Value> = resources
        .iter()
        .map(|r| {
            json!({
                "type": r.get("type").cloned().unwrap_or(json!("")),
                "quality": r.get("quality").cloned().unwrap_or(json!("")),
                "format": r.get("format").cloned().unwrap_or(json!("")),
                "url": r.get("download_url").or_else(|| r.get("preview_url")).cloned().unwrap_or(json!(""))
            })
        })
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "title": d.get("title").cloned().unwrap_or(json!("")),
            "thumbnail": d.get("thumbnail").cloned().unwrap_or(json!("")),
            "duration": d.get("duration").cloned().unwrap_or(json!(0)),
            "links": links,
            "comments": d.pointer("/comment_items/items").cloned().unwrap_or(json!([]))
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()

}

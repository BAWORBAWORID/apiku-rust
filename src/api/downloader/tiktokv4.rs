// TikTok Downloader v4 — native conversion of api/downloader/tiktokv4.js
// Provider: ssstik.io (GET page for tt token, POST abc?url=dl, scrape result)
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";

fn attr(html: &str, tag_hint: &str, attr_name: &str) -> Option<String> {
    let idx = html.find(tag_hint)?;
    let window = &html[idx.saturating_sub(200)..(idx + 600).min(html.len())];
    let marker = format!("{attr_name}=\"");
    let start = window.find(&marker)? + marker.len();
    let rest = &window[start..];
    Some(rest.split('"').next().unwrap_or("").to_string())
}

fn link_for(html: &str, cls: &str) -> Option<String> {
    let idx = html.find(cls)?;
    let before = &html[..idx];
    let anchor_start = before.rfind("<a ")?;
    let after = &html[anchor_start..(anchor_start + 1200).min(html.len())];
    let m = after.find("href=\"")? + 6;
    let rest = &after[m..];
    Some(rest.split('"').next().unwrap_or("").to_string())
}

fn extract_result(html: &str) -> Option<Value> {
    let author = attr(html, "result_author", "alt").filter(|s| !s.is_empty());
    let description = html
        .split("class=\"maintext\"")
        .nth(1)
        .and_then(|s| s.split('>').nth(1))
        .and_then(|s| s.split('<').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let video = link_for(html, "download_link without_watermark");
    let video_hd = attr(html, "hd_download", "data-directurl").filter(|s| !s.is_empty());
    let music = link_for(html, "download_link music");

    if video.is_none() && video_hd.is_none() && music.is_none() {
        return None;
    }

    Some(json!({
        "author": author,
        "description": description,
        "video": video,
        "video_hd": video_hd,
        "music": music
    }))
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

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload TikTok: {e}")
        }))).into_response(),
    };

    let home = match client.get("https://ssstik.io/id").send().await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload TikTok: {e}")
        }))).into_response(),
    };
    let tt = home
        .split("name=\"tt\"")
        .nth(1)
        .and_then(|s| s.split("value=\"").nth(1))
        .and_then(|s| s.split('"').next())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "a2JpaXJi".to_string());

    let form = [("id", url.as_str()), ("locale", "id"), ("tt", tt.as_str())];
    let html = match client
        .post("https://ssstik.io/abc?url=dl")
                    .header("hx-current-url", "https://ssstik.io/id")
                    .header("hx-request", "true")
                    .header("hx-target", "target")
                    .header("content-type", "application/x-www-form-urlencoded; charset=UTF-8")
        .form(&form)
        .send()
        .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload TikTok: {e}")
        }))).into_response(),
    };

    match extract_result(&html) {
        Some(result) => Json(json!({
            "status": true,
            "provider": "ssstik.io",
            "input": url,
            "result": result
        })).into_response(),
        None => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": "Gagal mengekstrak link download dari ssstik.io"
        }))).into_response(),
    }
}

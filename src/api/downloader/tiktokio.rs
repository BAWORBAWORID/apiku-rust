// TikTokIO Downloader — native conversion of api/downloader/tiktokio.js
// Provider: tiktokio.com/api/v1/tk/html (POST JSON {prefix, vid}) → scrape HTML
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

fn scrape(html: &str) -> Option<Value> {
    let vi = html.find("<div class=\"video-info\"").or_else(|| html.find("video-info"))?;
    let window = &html[vi..(vi + 20000).min(html.len())];

    let thumbnail = window
        .split("src=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .map(|s| s.to_string());
    let title = window
        .split("<h3")
        .nth(1)
        .and_then(|s| s.split('>').nth(1))
        .and_then(|s| s.split('<').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let mut medias = Vec::new();
    let mut rest = window;
    while let Some(idx) = rest.find("download-btn") {
        let anchor_start = rest[..idx].rfind("<a ").unwrap_or(idx);
        let after = &rest[anchor_start..];
        let anchor_end = after.find("</a>").map(|e| e + 4).unwrap_or(after.len().min(1500));
        let block = &after[..anchor_end];

        if let Some(hs) = block.find("href=\"") {
            let href = block[hs + 6..].split('"').next().unwrap_or("");
            if href.starts_with("http") {
                let text = block
                    .rsplit('>')
                    .next()
                    .unwrap_or("")
                    .split('<')
                    .next()
                    .unwrap_or("")
                    .trim();
                let cls = block
                    .split("class=\"")
                    .nth(1)
                    .and_then(|s| s.split('"').next())
                    .unwrap_or("");
                let (mut qtype, mut quality) = ("video", "Normal");
                if cls.contains("download-btn-purple") {
                    qtype = "audio";
                } else if cls.contains("download-btn-green") {
                    quality = "HD";
                } else if cls.contains("download-btn-gray") {
                    quality = "Watermark";
                }
                medias.push(json!({ "quality": quality, "type": qtype, "text": text, "url": href }));
            }
        }
        rest = &after[anchor_end.min(after.len())..];
    }

    if medias.is_empty() {
        return None;
    }
    Some(json!({
        "title": title,
        "thumbnail": thumbnail,
        "total_media": medias.len(),
        "medias": medias
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "link", "target"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let target = merged
        .get("url")
        .or_else(|| merged.get("link"))
        .or_else(|| merged.get("target"))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if target.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "error": "Parameter 'url', 'link', atau 'target' wajib diisi.",
            "available_actions": { "tiktokio_actions": ["download"] }
        }))).into_response();
    }
    if !(target.contains("tiktok.com") || target.contains("tt.site") || target.contains("douyin.com")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "error": "URL yang dimasukkan bukan URL TikTok yang valid."
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": format!("Terjadi kesalahan internal pada server: {e}")
        }))).into_response(),
    };

    let mut target_url = target.clone();
    if target_url.contains("tt.site") || target_url.contains("vt.tiktok.com") || target_url.contains("vm.tiktok.com") {
        if let Ok(res) = client.head(&target_url).send().await {
            let final_url = res.url().to_string();
            if final_url.starts_with("http") && final_url != target_url {
                target_url = final_url;
            }
        }
    }

    let resp = client
        .post("https://tiktokio.com/api/v1/tk/html")
                    .header("Content-Type", "application/json")
                    .header("Referer", "https://tiktokio.com/id/")
        .json(&json!({ "prefix": "tiktokio.com", "vid": target_url }))
        .send()
        .await;

    let html = match resp {
        Ok(r) => {
            if !r.status().is_success() {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                    "status": false,
                    "error": format!("Gagal menghubungi TikTokIO: HTTP {}", r.status().as_u16())
                }))).into_response();
            }
            r.text().await.unwrap_or_default()
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": format!("Terjadi kesalahan saat memproses media dari TikTokIO: {e}")
        }))).into_response(),
    };

    match scrape(&html) {
        Some(mut result) => {
            result["url"] = json!(target_url);
            Json(json!({ "status": true, "result": result })).into_response()
        }
        None => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "error": "Gagal mengambil media. Pastikan URL video publik."
        }))).into_response(),
    }
}

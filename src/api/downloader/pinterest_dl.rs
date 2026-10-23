// Pinterest Downloader — native conversion of api/downloader/pinterest-dl.js
// Scrape HTML langsung (Googlebot UA), extract semua link .mp4
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn quality_label(link: &str) -> &'static str {
    if link.contains("/720p/") {
        "720p (HD)"
    } else if link.contains("_t1.mp4") {
        "HEVC t1 (Very Low)"
    } else if link.contains("_t2.mp4") {
        "HEVC t2 (Low)"
    } else if link.contains("_t3.mp4") {
        "HEVC t3 (Medium)"
    } else if link.contains("_t4.mp4") {
        "HEVC t4 (High)"
    } else if link.contains("_t5.mp4") {
        "HEVC t5 (Highest)"
    } else {
        "Unknown"
    }
}

fn extract_mp4s(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(idx) = rest.find("https://") {
        let after = &rest[idx..];
        let end = after
            .find(|c| c == '"' || c == '\\' || c == '<' || c == ' ')
            .unwrap_or(after.len());
        let candidate = &after[..end];
        if candidate.ends_with(".mp4") && !out.iter().any(|l| l == candidate) {
            out.push(candidate.to_string());
        }
        rest = &after[end..];
    }
    out
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
            "status": false, "message": "Parameter 'url' wajib diisi."
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil data: {e}")
        }))).into_response(),
    };

    let html = match client
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
        .send()
        .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil data: {e}")
        }))).into_response(),
    };

    let links = extract_mp4s(&html);
    if links.is_empty() {
        return (StatusCode::NOT_FOUND, Json(json!({
            "status": false, "message": "Tidak ditemukan video MP4 di URL tersebut."
        }))).into_response();
    }

    let best = links
        .iter()
        .find(|l| l.contains("720p"))
        .cloned()
        .unwrap_or_else(|| links[links.len() - 1].clone());

    let resolutions: Vec<Value> = links
        .iter()
        .map(|l| json!({ "quality": quality_label(l), "url": l }))
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "url": url,
            "download_url": best,
            "total_resolutions": resolutions.len(),
            "resolutions": resolutions
        }
    })).into_response()

}

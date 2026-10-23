// Pinterest Downloader — native conversion of api/downloader/pinterest.js
// Scrape meta og: tags + regex pinimg video URLs (tanpa proxy Node).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn unescape_html(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn get_meta(html: &str, property: &str) -> Option<String> {
    let mut rest = html;
    while let Some(idx) = rest.find("<meta") {
        let after = &rest[idx..];
        let end = after.find('>').unwrap_or(after.len().min(600));
        let tag = &after[..end];
        if tag.contains(property) {
            if let Some(cpos) = tag.find("content=\"") {
                let val = &tag[cpos + 9..];
                let v = val.split('"').next().unwrap_or("");
                if !v.is_empty() {
                    return Some(unescape_html(v));
                }
            }
        }
        rest = &after[end..];
    }
    if property == "title" {
        if let Some(start) = html.find("<title>") {
            let rest2 = &html[start + 7..];
            if let Some(end) = rest2.find("</title>") {
                return Some(unescape_html(rest2[..end].trim()));
            }
        }
    }
    None
}

fn penalize(url: &str) -> bool {
    let l = url.to_lowercase();
    l.contains("av1mp4") || l.contains("hevc") || l.contains("control-v2")
}

fn list_qualities(html: &str) -> Vec<Value> {
    let mut by_width: std::collections::HashMap<u32, String> = std::collections::HashMap::new();
    let lower_html = html.to_ascii_lowercase();
    let bytes = lower_html.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() {
        if lower_html[idx..].starts_with("https://") {
            let after = &lower_html[idx..];
            let end = after
                .find(|c: char| c == '"' || c == '\\' || c == '<' || c == ' ')
                .unwrap_or(after.len());
            let candidate = &after[..end];
            if candidate.contains("pinimg.com/videos/") && candidate.ends_with(".mp4") {
                if let Some(wp) = candidate.rfind("w.mp4") {
                    let before = &candidate[..wp];
                    let num_start = before
                        .rfind(|c: char| !c.is_ascii_digit())
                        .map(|p| p + 1)
                        .unwrap_or(0);
                    let num_str = &before[num_start..];
                    if let Ok(width) = num_str.parse::<u32>() {
                        let original = html[idx..idx + end].to_string();
                        match by_width.get(&width) {
                            None => {
                                by_width.insert(width, original);
                            }
                            Some(cur) => {
                                if !penalize(&original) && penalize(cur) {
                                    by_width.insert(width, original);
                                }
                            }
                        }
                    }
                }
            }
            idx += end;
        } else {
            idx += 1;
        }
    }
    let mut items: Vec<(u32, String)> = by_width.into_iter().collect();
    items.sort_by(|a, b| b.0.cmp(&a.0));
    items
        .into_iter()
        .map(|(w, u)| json!({ "quality": format!("{w}p"), "url": u }))
        .collect()
}

fn find_video_url(html: &str) -> Option<String> {
    for prop in ["og:video:secure_url", "og:video:url", "og:video"] {
        if let Some(v) = get_meta(html, prop) {
            if v.contains("pinimg.com") || v.ends_with(".mp4") || v.contains(".m3u8") {
                return Some(v);
            }
        }
    }
    let lower = html.to_ascii_lowercase();
    if let Some(i) = lower.find("pinimg.com/videos/") {
        let start = lower[..i].rfind("https://").unwrap_or(0);
        let after = &lower[start..];
        let end = after.find(|c: char| c == '"' || c == '\\').unwrap_or(after.len());
        let candidate = html[start..start + end].to_string();
        if candidate.ends_with(".m3u8") || candidate.ends_with(".mp4") {
            return Some(candidate);
        }
    }
    None
}

fn extract_pin_id(url: &str) -> Option<String> {
    if let Some(rest) = url.split("pin.it/").nth(1) {
        let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    if let Some(rest) = url.split("/pin/").nth(1) {
        let id: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
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
    let target = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();

    if target.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response();
    }
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL harus diawali http:// atau https://"
        }))).into_response();
    }

    // direct pinimg URL passthrough
    if target.contains("i.pinimg.com/") {
        let lower = target.to_lowercase();
        let is_video = lower.ends_with(".mp4")
            || lower.ends_with(".m3u8")
            || lower.contains(".mp4?")
            || lower.contains(".m3u8?");
        return Json(json!({
            "status": true,
            "result": {
                "type": if is_video { "video" } else { "image" },
                "title": target.rsplit('/').next().unwrap_or(&target),
                "image": if is_video { Value::Null } else { json!(target) },
                "video": if is_video { json!(target) } else { Value::Null },
                "directUrl": target,
                "sourceUrl": target
            }
        }))
        .into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal scrape Pinterest: {e}")
        }))).into_response(),
    };

    let (html, final_url) = match client.get(&target).send().await {
        Ok(r) => {
            let final_url = r.url().to_string();
            let body = r.text().await.unwrap_or_default();
            if body.len() <= 500 {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                    "status": false, "message": "Gagal memuat halaman Pinterest"
                }))).into_response();
            }
            (body, final_url)
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal memuat halaman Pinterest: {e}")
        }))).into_response(),
    };

    let image = get_meta(&html, "og:image");
    let video = find_video_url(&html);
    let title = get_meta(&html, "og:title").or_else(|| get_meta(&html, "title"));

    let direct_url = video.clone().or(image.clone());
    if direct_url.is_none() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Media tidak ditemukan di halaman Pinterest"
        }))).into_response();
    }

    let qualities = if video.is_some() { list_qualities(&html) } else { Vec::new() };

    Json(json!({
        "status": true,
        "result": {
            "type": if video.is_some() { "video" } else { "image" },
            "title": title,
            "image": image,
            "video": video,
            "qualities": qualities,
            "directUrl": direct_url,
            "sourceUrl": final_url,
            "pinId": extract_pin_id(&final_url).or_else(|| extract_pin_id(&target))
        }
    })).into_response()

}

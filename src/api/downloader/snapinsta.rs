// SnapInsta Instagram Story & Profile Downloader — native conversion of api/downloader/snapinsta.js
// Provider: snapinsta.im/process (form) → scrape snap-viewer HTML sections
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://snapinsta.im";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

fn attr_after(html: &str, marker: &str, attr_name: &str) -> Option<String> {
    let idx = html.find(marker)?;
    let window = &html[idx..(idx + 3000).min(html.len())];
    let m = format!("{attr_name}=\"");
    let start = window.find(&m)? + m.len();
    let rest = &window[start..];
    Some(rest.split('"').next().unwrap_or("").to_string())
}

fn text_after(html: &str, marker: &str) -> Option<String> {
    let idx = html.find(marker)?;
    let window = &html[idx..(idx + 2000).min(html.len())];
    let after = window.split_once('>')?.1;
    let t = after.split('<').next().unwrap_or("").trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn scrape_cards(section_html: &str, group_id: Option<&str>) -> Vec<Value> {
    let mut cards = Vec::new();
    let mut c_rest = section_html;
    while let Some(cidx) = c_rest.find("snap-profile-card") {
        let c_after = &c_rest[cidx..];
        let c_end = c_after
            .find("snap-profile-card")
            .and_then(|p| if p > 0 { Some(p) } else { None })
            .unwrap_or(c_after.len().min(2000));
        let card = &c_after[..c_end];
        cards.push(json!({
            "group": group_id,
            "type": attr_after(card, "snap-open-media", "data-profile-play"),
            "media": attr_after(card, "snap-open-media", "data-playback-url"),
            "thumbnail": attr_after(card, "<img", "src"),
            "download": attr_after(card, "download-media", "href"),
            "mediaToken": attr_after(card, "snap-media-options", "data-media-token")
        }));
        c_rest = &c_after[c_end..];
    }
    cards
}

fn scrape(html: &str) -> Value {
    let mut result = json!({
        "username": attr_after(html, "snap-viewer", "data-viewer-username"),
        "session": attr_after(html, "snap-viewer", "data-viewer-session"),
        "profile": {
            "name": text_after(html, "<h2"),
            "username": text_after(html, "premium-eyebrow"),
            "bio": text_after(html, "snap-bio-text"),
            "followers": text_after(html, "snap-profile-stats"),
            "following": None::<Value>,
            "image": attr_after(html, "snap-profile", "src"),
            "download": attr_after(html, "download-media", "href")
        },
        "highlights": [],
        "stories": [],
        "posts": []
    });

    if let Some(idx) = html.find("snap-profile-stats") {
        let window = &html[idx..(idx + 2000).min(html.len())];
        let mut strongs = Vec::new();
        let mut rest = window;
        while let Some(p) = rest.find("<strong") {
            let after = match rest[p..].split_once('>') {
                Some((_, a)) => a,
                None => break,
            };
            strongs.push(after.split('<').next().unwrap_or("").trim().to_string());
            rest = &rest[p + 7..];
        }
        if strongs.len() >= 2 {
            result["profile"]["followers"] = json!(strongs[0]);
            result["profile"]["following"] = json!(strongs[1]);
        }
    }

    // highlights
    let mut highlights = Vec::new();
    let mut rest = html;
    while let Some(idx) = rest.find("snap-profile-highlight") {
        let after = &rest[idx..];
        let end = after
            .find("snap-profile-highlight")
            .and_then(|p| if p > 0 { Some(p) } else { None })
            .unwrap_or(after.len().min(1500));
        let block = &after[..end];
        highlights.push(json!({
            "id": attr_after(block, "snap-profile-highlight", "data-highlight-id"),
            "title": block
                .split("<span")
                .nth(1)
                .and_then(|s| s.split('>').nth(1))
                .and_then(|s| s.split('<').next())
                .map(|s| s.trim().to_string()),
            "image": attr_after(block, "<img", "src")
        }));
        rest = &after[end..];
    }
    result["highlights"] = json!(highlights);

    for section in ["stories", "posts"] {
        let marker = format!("data-profile-section=\"{section}\"");
        let sec_html = match html.split(marker.as_str()).nth(1) {
            Some(s) => s,
            None => continue,
        };
        let sec_end = sec_html.find("data-profile-section").unwrap_or(sec_html.len());
        let sec = &sec_html[..sec_end];

        let mut out = Vec::new();
        let mut g_rest = sec;
        while let Some(gidx) = g_rest.find("snap-profile-group") {
            let g_after = &g_rest[gidx..];
            let g_end = g_after
                .find("snap-profile-group")
                .and_then(|p| if p > 0 { Some(p) } else { None })
                .unwrap_or(g_after.len().min(8000));
            let group_html = &g_after[..g_end];
            let group_id = attr_after(group_html, "snap-profile-group", "data-profile-group");

            if section == "stories" {
                for c in scrape_cards(group_html, group_id.as_deref()) {
                    out.push(c);
                }
            } else {
                let caption = group_html
                    .split("snap-post-caption")
                    .nth(1)
                    .and_then(|s| s.split('>').nth(1))
                    .and_then(|s| s.split('<').next())
                    .map(|s| s.trim().to_string());
                let media = scrape_cards(group_html, None)
                    .into_iter()
                    .map(|mut c| {
                        c.as_object_mut().map(|o| {
                            o.remove("mediaToken");
                            o.remove("group");
                        });
                        c
                    })
                    .collect::<Vec<_>>();
                out.push(json!({ "id": group_id, "caption": caption, "media": media }));
            }
            g_rest = &g_after[g_end..];
        }
        result[section] = json!(out);
    }

    result
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["username", "user", "url"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let raw = merged
        .get("username")
        .or_else(|| merged.get("user"))
        .or_else(|| merged.get("url"))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if raw.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'username' wajib diisi (contoh: cristiano). Alternatif: 'url' dengan URL profil lengkap."
        }))).into_response();
    }
    let target = if raw.starts_with("http") { raw.clone() } else { raw.trim_start_matches('@').to_string() };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil profil Instagram: {e}")
        }))).into_response(),
    };

    let html = match client
        .post(format!("{BASE_URL}/process"))
                    .header("accept", "*/*")
                    .header("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
        .header("origin", BASE_URL)
        .header("referer", format!("{BASE_URL}/"))
                    .header("x-requested-with", "XMLHttpRequest")
        .body(format!(
            "url={}&scope=storyDownloader&locale=id&viewerVersion=profile-r3",
            urlencoding::encode(&target)
        ))
        .send()
        .await
    {
        Ok(r) => {
            let status = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();
            if status == 404 || status == 502 || status == 503 {
                return (StatusCode::NOT_FOUND, Json(json!({
                    "status": false,
                    "message": "Profil tidak ditemukan, akun mungkin privat, atau tidak ada konten yang bisa diambil untuk username ini."
                }))).into_response();
            }
            body
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil profil Instagram: {e}")
        }))).into_response(),
    };

    let result = scrape(&html);
    let is_empty = result["profile"]["name"].is_null()
        && result["stories"].as_array().map(|a| a.is_empty()).unwrap_or(true)
        && result["posts"].as_array().map(|a| a.is_empty()).unwrap_or(true)
        && result["highlights"].as_array().map(|a| a.is_empty()).unwrap_or(true);

    if is_empty {
        return (StatusCode::NOT_FOUND, Json(json!({
            "status": false,
            "message": "Profil tidak ditemukan, akun mungkin privat, atau tidak memiliki konten yang dapat diambil."
        }))).into_response();
    }

    Json(json!({ "status": true, "result": result })).into_response()
}

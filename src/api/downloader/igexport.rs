// IGExport Instagram Downloader — native conversion of api/downloader/igexport.js
// Provider: igexport.com/api/ig-reels/ & /api/ig-photo/ (GET url=...)
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://igexport.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fn clean_url(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(start) = trimmed.find("https://") {
        let rest = &trimmed[start..];
        if let Some(rel) = rest.find("instagram.com/") {
            let after = &rest[rel..];
            let segs: Vec<&str> = after.split('/').collect();
            if segs.len() >= 3 && ["reel", "p", "tv"].contains(&segs[1]) {
                let code = segs[2].split('?').next().unwrap_or("");
                if !code.is_empty() {
                    return format!("https://www.instagram.com/{}/{code}/", segs[1]);
                }
            }
        }
        return trimmed.to_string();
    }
    trimmed.to_string()
}

fn shortcode(url: &str) -> String {
    for key in ["/reel/", "/p/", "/tv/"] {
        if let Some(rest) = url.split(key).nth(1) {
            let code: String = rest.chars().take_while(|c| *c != '/' && *c != '?' && *c != '#').collect();
            if !code.is_empty() {
                return code;
            }
        }
    }
    String::new()
}

async fn fetch_api(client: &reqwest::Client, endpoint: &str, target: &str) -> Value {
    let is_photo = endpoint.contains("photo");
    let referer_path = if is_photo { "/id/photo-download/" } else { "/id/reels-download/" };
    let resp = client
        .get(format!("{BASE_URL}{endpoint}?url={}", urlencoding::encode(target)))
        .header("User-Agent", UA)
        .header("Referer", format!("{BASE_URL}{referer_path}"))
        .header("Origin", BASE_URL)
                    .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .ok();

    match resp {
        Some(r) => r.json::<Value>().await.unwrap_or(Value::Null),
        None => Value::Null,
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "link"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let target_raw = merged.get("url").or_else(|| merged.get("link")).cloned().unwrap_or_default();
    if target_raw.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response();
    }

    let cleaned = clean_url(&target_raw);
    let code = shortcode(&cleaned);
    if code.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "URL Instagram tidak valid. Contoh: https://www.instagram.com/reel/xxx/ atau /p/xxx/"
        }))).into_response();
    }

    let is_reel = cleaned.contains("/reel/");
    let endpoints: [&str; 2] = if is_reel {
        ["/api/ig-reels/", "/api/ig-photo/"]
    } else {
        ["/api/ig-photo/", "/api/ig-reels/"]
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload media Instagram: {e}")
        }))).into_response(),
    };

    let mut api_data: Option<Value> = None;
    let mut last_err = String::new();
    for ep in endpoints {
        let data = fetch_api(&client, ep, &cleaned).await;
        if data.get("ok").and_then(|o| o.as_bool()) == Some(true) && data.get("media").is_some() {
            api_data = Some(data);
            break;
        } else if let Some(e) = data.get("error").and_then(|e| e.as_str()) {
            last_err = e.to_string();
        }
    }

    let api_data = match api_data {
        Some(d) => d,
        None => {
            let msg = if last_err.is_empty() {
                "Media tidak ditemukan atau akun bersifat privat.".to_string()
            } else {
                last_err
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": format!("Gagal mengambil media Instagram: {msg}")
            }))).into_response();
        }
    };

    let media = api_data.get("media").cloned().unwrap_or(Value::Null);
    let mut items: Vec<Value> = Vec::new();

    let raw_items = media.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
    if !raw_items.is_empty() {
        let is_multi = raw_items.len() > 1;
        for (idx, item) in raw_items.iter().enumerate() {
            let url_str = item.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let is_video = item.get("type").and_then(|t| t.as_str()) == Some("video")
                || url_str.to_lowercase().ends_with(".mp4");
            let ext = if is_video { "mp4" } else { "jpg" };
            let name = item
                .get("filename")
                .and_then(|f| f.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    if is_multi {
                        format!("igexport-{code}-{}.{ext}", idx + 1)
                    } else {
                        format!("igexport-{code}.{ext}")
                    }
                });
            items.push(json!({
                "index": idx + 1,
                "type": if is_video { "video" } else { "image" },
                "url": url_str,
                "thumbnail": item.get("thumbnailUrl").cloned().unwrap_or(Value::Null),
                "filename": name
            }));
        }
    } else if let Some(vurl) = media.get("videoUrl").and_then(|v| v.as_str()) {
        let vl = vurl.to_lowercase();
        let is_jpg = vl.ends_with(".jpg") || vl.ends_with(".jpeg") || vl.ends_with(".png") || vl.ends_with(".webp");
        items.push(json!({
            "index": 1,
            "type": if is_jpg { "image" } else { "video" },
            "url": vurl,
            "thumbnail": media.get("thumbnailUrl").cloned().unwrap_or(Value::Null),
            "filename": media.get("filename").cloned().unwrap_or(json!(format!("igexport-{code}.{}", if is_jpg { "jpg" } else { "mp4" })))
        }));
    }

    if items.is_empty() {
        return (StatusCode::NOT_FOUND, Json(json!({
            "status": false,
            "message": "Gagal mengambil media Instagram: Media tidak ditemukan atau akun bersifat privat."
        }))).into_response();
    }

    Json(json!({ "status": true, "result": { "items": items } })).into_response()
}

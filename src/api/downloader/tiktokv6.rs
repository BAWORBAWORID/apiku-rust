// TikTok Downloader v6 — native conversion of api/downloader/tiktokv6.js
// API: ttdl.zone.id/api/tiktok + cross-validation via TikTok oEmbed.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API: &str = "https://ttdl.zone.id/api/tiktok";
const OEMBED: &str = "https://www.tiktok.com/oembed";
const UA1: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA2: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fn is_valid_tiktok_host(input: &str) -> bool {
    let lower = input.to_lowercase();
    let after = lower
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = after.split('/').next().unwrap_or("");
    host == "tiktok.com" || host == "tt.site"
        || host.ends_with(".tiktok.com") || host.ends_with(".tt.site")
}

async fn parse_tiktok_url(client: &reqwest::Client, input: &str) -> Result<String, String> {
    let mut s = input.trim().to_string();
    if !is_valid_tiktok_host(&s) {
        return Err("Bukan link TikTok. Contoh: https://vt.tiktok.com/ZSbM4DXTu/ atau https://www.tiktok.com/@user/video/123".into());
    }
    if !s.starts_with("http") {
        s = format!("https://{s}");
    }
    if s.contains("tt.site") || s.contains("vt.tiktok.com") || s.contains("vm.tiktok.com") {
        if let Ok(res) = client.head(&s).send().await {
            let final_url = res.url().to_string();
            if final_url.starts_with("http") {
                return Ok(final_url);
            }
        }
    }
    Ok(s)
}

async fn oembed_truth(client: &reqwest::Client, url: &str) -> Option<Value> {
    let res = client
        .get(format!("{OEMBED}?url={}", urlencoding::encode(url)))
        .header("User-Agent", UA1)
                    .header("Accept", "application/json")
                    .header("Referer", "https://www.tiktok.com/")
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let j: Value = res.json().await.ok()?;
    let html = j.get("html").and_then(|h| h.as_str()).unwrap_or("");
    let id = html
        .split("data-video-id=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .map(|s| s.to_string());
    let username = j
        .get("author_url")
        .and_then(|a| a.as_str())
        .and_then(|a| a.split('@').nth(1))
        .map(|u| u.split('/').next().unwrap_or("").to_lowercase())
        .filter(|u| !u.is_empty());
    Some(json!({
        "id": id,
        "username": username,
        "title": j.get("title").cloned().unwrap_or(json!(""))
    }))
}

fn to_string_val(v: Option<&Value>) -> String {
    match v {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
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
            "status": false, "error": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA1)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": e.to_string()
        }))).into_response(),
    };

    let url = match parse_tiktok_url(&client, &url).await {
        Ok(u) => u,
        Err(msg) => return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "error": msg }))).into_response(),
    };

    let truth = oembed_truth(&client, &url).await;

    let mut resp = match client
        .get(format!("{API}?url={}", urlencoding::encode(&url)))
                    .header("Accept", "application/json")
                    .header("Referer", "https://ttdl.zone.id/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "error": e.to_string() }))).into_response(),
    };
    if resp.status().as_u16() == 403 || resp.status().as_u16() == 429 {
        if let Ok(r) = client
            .get(format!("{API}?url={}", urlencoding::encode(&url)))
                        .header("Accept", "application/json")
            .header("User-Agent", UA2)
                        .header("Referer", "https://ttdl.zone.id/")
            .send()
            .await
        {
            resp = r;
        }
    }
    if !resp.status().is_success() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": format!("Server downloader sedang sibuk (HTTP {})", resp.status().as_u16())
        }))).into_response();
    }
    let body_json: Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": "Gagal mengambil data."
        }))).into_response(),
    };
    let ok = body_json.get("ok").and_then(|o| o.as_bool()).unwrap_or(false);
    let d = body_json.get("data").cloned();
    if !ok || d.is_none() {
        let msg = body_json.get("error").and_then(|e| e.as_str()).unwrap_or("Gagal mengambil data.");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "error": msg }))).into_response();
    }
    let d = d.unwrap();

    let got_user = d.pointer("/author/username").and_then(|u| u.as_str()).unwrap_or("").to_lowercase();
    let got_id = to_string_val(d.pointer("/video/id").or_else(|| d.pointer("/photo/id")));

    let truth_user = truth.as_ref().and_then(|t| t.get("username")).and_then(|u| u.as_str()).unwrap_or("");
    let truth_id = truth.as_ref().and_then(|t| t.get("id")).and_then(|u| u.as_str()).unwrap_or("");
    if (!truth_user.is_empty() && !got_user.is_empty() && got_user != truth_user)
        || (!truth_id.is_empty() && !got_id.is_empty() && got_id != truth_id)
    {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "error": "Video tidak ditemukan atau sudah dihapus."
        }))).into_response();
    }

    let s = d.get("statistics").cloned().unwrap_or(json!({}));
    let jget = |k: &str| s.get(k).cloned().unwrap_or(Value::Null);

    let video_obj = d.get("video").cloned();
    let nowm = video_obj.as_ref().and_then(|v| v.get("download_nowm")).cloned().unwrap_or(Value::Null);
    let video_size = video_obj.as_ref().and_then(|v| v.get("size")).cloned().unwrap_or(Value::Null);

    let photos: Vec<Value> = d
        .pointer("/photo/images")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter(|(_, p)| p.get("download").is_some())
        .map(|(i, p)| {
            json!({
                "index": i + 1,
                "view": p.get("view"),
                "download": p.get("download")
            })
        })
        .collect();

    let music = d.get("music").and_then(|m| m.get("download")).map(|dl| {
        json!({
            "title": d.pointer("/music/title").cloned().unwrap_or(json!("")),
            "author": d.pointer("/music/author").cloned().unwrap_or(json!("")),
            "download": dl
        })
    });

    let main: Value = if !nowm.is_null() {
        json!({ "type": "video", "url": nowm, "size": video_size })
    } else if let Some(first) = photos.first() {
        json!({ "type": "photo", "url": first["download"], "size": null })
    } else if let Some(m) = &music {
        json!({ "type": "audio", "url": m["download"], "size": null })
    } else {
        Value::Null
    };

    let id_val = if !got_id.is_empty() {
        json!(got_id)
    } else if !truth_id.is_empty() {
        json!(truth_id)
    } else {
        Value::Null
    };

    let mut info = json!({
        "id": id_val,
        "type": d.get("type").cloned().unwrap_or(Value::Null),
        "verified": if truth.is_some() { "oembed" } else { "api-only" },
        "author": {
            "username": d.pointer("/author/username").cloned()
                .filter(|v| !v.is_null())
                .or_else(|| truth.as_ref().and_then(|t| t.get("username")).cloned()),
            "nickname": d.pointer("/author/nickname").cloned().unwrap_or(json!("")),
            "region": d.pointer("/author/region").cloned().unwrap_or(Value::Null),
            "avatar": d.pointer("/author/avatar").cloned().unwrap_or(Value::Null),
            "signature": d.pointer("/author/signature").cloned().unwrap_or(Value::Null)
        },
        "desc": d.pointer("/video/desc").cloned()
            .or_else(|| d.pointer("/photo/desc").cloned())
            .or_else(|| truth.as_ref().and_then(|t| t.get("title")).cloned())
            .unwrap_or(json!("")),
        "statistics": {
            "play": jget("play_count"),
            "like": jget("digg_count"),
            "comment": jget("comment_count"),
            "share": jget("share_count"),
            "download": jget("download_count")
        },
        "video": video_obj.map(|v| json!({
            "duration": v.get("duration"),
            "size": v.get("size"),
            "cover": v.get("thumbnail"),
            "nowm": v.get("download_nowm"),
            "wm": v.get("download_wm"),
            "stream": v.get("stream")
        })),
        "photos": photos,
        "music": music
    });

    info["download"] = main;
    info["downloads"] = json!({
        "video": if nowm.is_null() { Value::Null } else { nowm },
        "audio": info["music"].get("download").cloned().unwrap_or(Value::Null),
        "photos": info["photos"].as_array().map(|a| a.iter().map(|p| p["download"].clone()).collect::<Vec<_>>()).unwrap_or_default()
    });

    if truth.is_none() {
        info["warning"] = json!("Tidak tervalidasi: oEmbed TikTok tidak bisa dihubungi (rate limit), sehingga link ini tidak dicek apakah masih hidup. Data di bawah bisa jadi konten acak milik akun lain.");
    }

    Json(json!({ "status": true, "result": info })).into_response()
}

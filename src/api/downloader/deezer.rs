// Deezer Downloader — native conversion of api/downloader/deezer.js
// Modes: search (api.deezer.com), info (track.php), download (deezdownloaders.com).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://deezdownloaders.com";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

fn clean(s: &str) -> String {
    s.replace(['\'', '"'], "").trim().to_string()
}

async fn search_deezer(client: &reqwest::Client, query: &str, limit: u32) -> Result<Value, String> {
    let url = format!("https://api.deezer.com/search?q={}&limit={}", urlencoding::encode(query), limit);
    let resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Deezer API HTTP Error: {}", resp.status().as_u16()));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let items = data.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    let mapped: Vec<Value> = items
        .iter()
        .map(|t| {
            json!({
                "id": t.get("id"),
                "title": t.get("title"),
                "artist": t.pointer("/artist/name"),
                "album": t.pointer("/album/title"),
                "duration": t.get("duration"),
                "link": t.get("link"),
                "thumbnail": t.pointer("/album/cover_big").or_else(|| t.pointer("/album/cover"))
            })
        })
        .collect();
    Ok(Value::Array(mapped))
}

async fn expand_url(client: &reqwest::Client, url: &str) -> String {
    let api = format!("{}/api/expandUrl.php?url={}", BASE_URL, urlencoding::encode(url));
    let resp = match client
        .get(&api)
        .header("User-Agent", USER_AGENT)
        .header("Referer", format!("{BASE_URL}/"))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return url.to_string(),
    };
    if !resp.status().is_success() {
        return url.to_string();
    }
    let data: Value = resp.json().await.unwrap_or(Value::Null);
    if data.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        data.get("url").and_then(|u| u.as_str()).unwrap_or(url).to_string()
    } else {
        url.to_string()
    }
}

async fn normalize_url(client: &reqwest::Client, input: &str) -> Result<String, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("URL atau judul lagu Deezer diperlukan".into());
    }
    if s.chars().all(|c| c.is_ascii_digit()) {
        return Ok(format!("https://www.deezer.com/track/{s}"));
    }
    if s.contains("deezer.page.link") || s.contains("link.tospotify.com") || s.contains("dzr.page.link") {
        return Ok(expand_url(client, s).await);
    }
    if s.starts_with("http") {
        return Ok(s.to_string());
    }
    let results = search_deezer(client, s, 1).await?;
    if let Some(first) = results.as_array().and_then(|a| a.first()) {
        if let Some(link) = first.get("link").and_then(|l| l.as_str()) {
            return Ok(link.to_string());
        }
    }
    Ok(s.to_string())
}

async fn get_track_info(client: &reqwest::Client, url_or_id: &str) -> Result<Value, String> {
    let url = normalize_url(client, url_or_id).await?;
    let api = format!("{}/api/track.php?url={}", BASE_URL, urlencoding::encode(&url));
    let resp = client
        .get(&api)
        .header("User-Agent", USER_AGENT)
        .header("Referer", format!("{BASE_URL}/"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP Error {}: Gagal mengambil info track", resp.status().as_u16()));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    if data.get("name").is_none() {
        return Err("Track tidak ditemukan atau link tidak didukung".into());
    }
    Ok(json!({
        "name": data.get("name"),
        "artist": data.get("artist"),
        "album": data.get("album"),
        "duration": data.get("duration"),
        "releaseDate": data.get("release_date").cloned().unwrap_or(Value::Null),
        "thumbnail": data.get("thumb").cloned().unwrap_or(Value::Null),
        "trackPosition": data.get("track_position").cloned().unwrap_or(json!(1)),
        "url": data.get("url").cloned().unwrap_or(json!(url))
    }))
}

async fn download_track(client: &reqwest::Client, url_or_id: &str, quality: &str) -> Result<Value, String> {
    let track_info = get_track_info(client, url_or_id).await?;
    let name = track_info.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
    let artist = track_info.get("artist").and_then(|n| n.as_str()).unwrap_or("").to_string();
    let url = track_info.get("url").and_then(|n| n.as_str()).unwrap_or("").to_string();

    let form = format!(
        "name={}&artist={}&url={}&token=none&zip_download=false&quality={}",
        urlencoding::encode(&clean(&name)),
        urlencoding::encode(&clean(&artist)),
        urlencoding::encode(&url),
        urlencoding::encode(quality)
    );

    let resp = client
        .post(format!("{BASE_URL}/api/downloader.php"))
        .header("User-Agent", USER_AGENT)
        .header("Referer", format!("{BASE_URL}/track.php"))
        .header("Origin", BASE_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    .header("X-Requested-With", "XMLHttpRequest")
        .body(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Downloader HTTP Error: {}", resp.status().as_u16()));
    }
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let dlink = data.get("dlink").and_then(|d| d.as_str()).unwrap_or("");
    if !success || dlink.is_empty() {
        let reason = data.get("reason").and_then(|r| r.as_str()).unwrap_or("Gagal menghasilkan download link dari deezdownloaders.com");
        return Err(reason.to_string());
    }
    Ok(json!({
        "title": track_info.get("name"),
        "artist": track_info.get("artist"),
        "album": track_info.get("album"),
        "duration": track_info.get("duration"),
        "thumbnail": track_info.get("thumbnail"),
        "download_url": dlink,
        "source_url": track_info.get("url")
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "query", "id", "q", "action", "quality", "limit"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let action = merged.get("action").map(|s| s.to_lowercase()).unwrap_or_default();
    let input = ["url", "query", "id", "q"]
        .iter()
        .find_map(|k| merged.get(*k).filter(|v| !v.trim().is_empty()).cloned());
    let quality = merged.get("quality").cloned().unwrap_or_else(|| "MP3_128".into());

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    if action == "search" {
        let input = match input {
            Some(i) => i,
            None => return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "Parameter 'query' wajib diisi untuk pencarian lagu Deezer"
            }))).into_response(),
        };
        let limit: u32 = merged.get("limit").and_then(|l| l.parse().ok()).unwrap_or(5);
        match search_deezer(&client, &input, limit).await {
            Ok(results) => {
                let total = results.as_array().map(|a| a.len()).unwrap_or(0);
                Json(json!({
                    "status": true, "action": "search", "query": input,
                    "total": total, "result": results
                })).into_response()
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e
            }))).into_response(),
        }
    } else if action == "info" {
        let input = match input {
            Some(i) => i,
            None => return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "Parameter 'url', 'query', atau 'id' wajib diisi untuk cek info track"
            }))).into_response(),
        };
        match get_track_info(&client, &input).await {
            Ok(info) => Json(json!({ "status": true, "action": "info", "result": info })).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e
            }))).into_response(),
        }
    } else {
        let input = match input {
            Some(i) => i,
            None => return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'url' atau 'query' wajib diisi",
                "usage": {
                    "download_by_url": "/api/downloader/deezer?url=https://www.deezer.com/track/2743578151",
                    "download_by_title": "/api/downloader/deezer?query=espresso+sabrina+carpenter",
                    "search_songs": "/api/downloader/deezer?action=search&query=sabrina+carpenter",
                    "track_info": "/api/downloader/deezer?action=info&url=https://www.deezer.com/track/2743578151"
                }
            }))).into_response(),
        };
        match download_track(&client, &input, &quality).await {
            Ok(result) => Json(json!({ "status": true, "action": "download", "result": result })).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e
            }))).into_response(),
        }
    }
}

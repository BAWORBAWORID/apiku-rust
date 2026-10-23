// YouTube Downloader v4 (y2mate.gs) — native conversion of api/downloader/youtubev4.js
// Flow: auth -> init -> convert(mp3+mp4) -> poll progress -> download links
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use reqwest::header;

const API_KEY: &str = "e4b503d6ae10c35b1d3ee822c807d2f5";
const AUTH_URL: &str = "https://eta.etacloud.org/api/v1/auth";
const INIT_URL: &str = "https://eta.etacloud.org/api/v1/init";
const HEADERS_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn err_code(data: &Value) -> String {
    data.get("error").map(|e| match e {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }).unwrap_or_default()
}

fn extract_video_id(url: &str) -> Option<String> {
    for key in ["youtu.be/", "/embed/", "/live/", "/shorts/"] {
        if let Some(rest) = url.split(key).nth(1) {
            let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
            if id.len() == 11 {
                return Some(id);
            }
        }
    }
    if let Some(pos) = url.find("v=") {
        let rest = &url[pos + 2..];
        let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    None
}

async fn get_auth(client: &reqwest::Client) -> Result<String, String> {
    let url = format!("{AUTH_URL}?api_key={API_KEY}&_={}", now_ms());
    let data: Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let err = data.get("err").map(|e| e.to_string()).unwrap_or_default();
    if !err.is_empty() && err != "null" {
        return Err("Auth failed".into());
    }
    data.get("key").and_then(|k| k.as_str()).map(|s| s.to_string()).ok_or_else(|| "Auth failed".into())
}

async fn get_convert_url(client: &reqwest::Client, bearer: &str) -> Result<String, String> {
    let url = format!("{INIT_URL}?_={}", now_ms());
    let data: Value = client
        .get(&url)
        .header("Authorization", format!("Bearer {bearer}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let err = err_code(&data);
    if !err.is_empty() && err != "0" && err != "\"0\"" && err != "null" {
        return Err("Init failed".into());
    }
    data.get("convertURL").and_then(|c| c.as_str()).map(|s| s.to_string()).ok_or_else(|| "Init failed".into())
}

async fn convert(client: &reqwest::Client, convert_url: &str, vid: &str, format: &str) -> Result<Value, String> {
    let url = format!("{convert_url}&v={vid}&f={format}&_={}", now_ms());
    let data: Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let err = err_code(&data);
    if !err.is_empty() && err != "0" && err != "\"0\"" && err != "null" {
        return Err(format!("Convert error: {err}"));
    }
    Ok(data)
}

async fn wait_for_download(
    client: &reqwest::Client,
    progress_url: &str,
    download_url: &str,
    vid: &str,
    format: &str,
    title: &str,
) -> Result<Value, String> {
    for _ in 0..60 {
        let url = format!("{progress_url}&_={}", now_ms());
        let data: Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        let progress = data.get("progress").map(|p| match p {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }).unwrap_or_default();
        if progress == "3" {
            let t = data.get("title").and_then(|t| t.as_str()).unwrap_or(title);
            let title = if t.is_empty() { "YouTube Download" } else { t };
            return Ok(json!({
                "title": title,
                "downloadURL": format!("{download_url}&v={vid}&f={format}&r=y2mate.gs")
            }));
        }
        let err = err_code(&data);
        if !err.is_empty() && err != "0" && err != "\"0\"" && err != "null" {
            return Err(format!("Progress error: {err}"));
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    Err("Timeout: download tidak selesai dalam 120 detik".into())
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
    let video_id = match extract_video_id(&url) {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL YouTube tidak valid"
        }))).into_response(),
    };

    let mut hb = reqwest::header::HeaderMap::new();
    hb.insert("Referer", "https://y2mate.gs/".parse().unwrap());
    hb.insert("Origin", "https://y2mate.gs".parse().unwrap());
    let client = match reqwest::Client::builder()
        
        .user_agent(HEADERS_UA)
        .default_headers(hb)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let run = async {
        let bearer = get_auth(&client).await?;
        let convert_url = get_convert_url(&client, &bearer).await?;
        let mut mp3 = convert(&client, &convert_url, &video_id, "mp3").await?;
        let mut mp4 = convert(&client, &convert_url, &video_id, "mp4").await?;

        if mp3.get("redirect").is_some() {
            let r = mp3.get("redirectURL").and_then(|r| r.as_str()).ok_or("missing redirectURL")?;
            mp3 = convert(&client, r, &video_id, "mp3").await?;
        }
        if mp4.get("redirect").is_some() {
            let r = mp4.get("redirectURL").and_then(|r| r.as_str()).ok_or("missing redirectURL")?;
            mp4 = convert(&client, r, &video_id, "mp4").await?;
        }

        let mp3_title = mp3.get("title").and_then(|t| t.as_str()).unwrap_or("");
        let mp4_title = mp4.get("title").and_then(|t| t.as_str()).unwrap_or("");
        let mp3_ready = wait_for_download(
            &client,
            mp3.get("progressURL").and_then(|p| p.as_str()).unwrap_or(""),
            mp3.get("downloadURL").and_then(|p| p.as_str()).unwrap_or(""),
            &video_id, "mp3", mp3_title,
        ).await?;
        let mp4_ready = wait_for_download(
            &client,
            mp4.get("progressURL").and_then(|p| p.as_str()).unwrap_or(""),
            mp4.get("downloadURL").and_then(|p| p.as_str()).unwrap_or(""),
            &video_id, "mp4", mp4_title,
        ).await?;
        Ok::<Value, String>(json!({ "mp3": mp3_ready, "mp4": mp4_ready }))
    };

    match run.await {
        Ok(r) => Json(json!({ "status": true, "result": r })).into_response(),
        Err(msg) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg
        }))).into_response(),
    }
}

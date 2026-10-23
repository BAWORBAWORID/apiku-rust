// NglSpam — native conversion of api/tools/ngl-spam.js (background sender)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

fn generate_device_id() -> String {
    (0..16)
        .map(|_| {
            let chars = b"abcdefghijklmnopqrstuvwxyz0123456789";
            (chars[rand::random::<usize>() % chars.len()] as char).to_string()
        })
        .collect()
}

fn validate_ngl_url(url_string: &str) -> Result<(String, String), String> {
    let parsed = url::Url::parse(url_string).map_err(|_| "Invalid URL format".to_string())?;
    if !parsed
        .host_str()
        .map(|h| h.ends_with("ngl.link"))
        .unwrap_or(false)
    {
        return Err("Invalid NGL URL (domain must be ngl.link)".into());
    }
    let username = parsed
        .path()
        .split('/')
        .filter(|s| !s.is_empty())
        .last()
        .ok_or("Invalid NGL URL (username not found)")?
        .to_string();
    if username.is_empty() {
        return Err("Invalid NGL URL (username not found)".into());
    }
    Ok((username, url_string.to_string()))
}

async fn send_once(client: &reqwest::Client, question: &str, url: &str) -> Result<(), String> {
    if question.trim().is_empty() {
        return Err("Question cannot be empty".into());
    }
    if question.len() > 1000 {
        return Err("Question too long (max 1000 chars)".into());
    }
    let (username, full_url) = validate_ngl_url(url)?;

    let device_id = generate_device_id();
    let payload = [
        ("username", username.as_str()),
        ("question", question),
        ("deviceId", device_id.as_str()),
        ("gameSlug", ""),
        ("referrer", ""),
    ];

    client
        .post("https://ngl.link/api/submit")
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", full_url)
                    .header("Origin", "https://ngl.link")
                    .header("Accept", "*/*")
                    .header("X-Requested-With", "XMLHttpRequest")
                    .header("Accept-Language", "en-US,en;q=0.9")
        
        .form(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn run_background_process(
    client: reqwest::Client,
    question: String,
    url: String,
    count: u32,
    delay_ms: u64,
) {
    for i in 0..count {
        if send_once(&client, &question, &url).await.is_err() {
            break;
        }
        if i + 1 < count {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
    }
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str().map(|s| s.to_string()).or_else(|| {
                    if v.is_null() {
                        None
                    } else {
                        Some(v.to_string())
                    }
                })
            })
        })
    };

    let url = get("url");
    let question = get("question");
    if url.as_deref().unwrap_or("").is_empty() || question.as_deref().unwrap_or("").is_empty() {
        return Json(
            json!({"status": false, "message": "Parameter 'url' dan 'question' wajib diisi"}),
        )
        .into_response();
    }

    let count: u32 = get("count")
        .and_then(|c| c.trim().parse().ok())
        .unwrap_or(100);
    if count < 1 {
        return Json(
            json!({"status": false, "message": "Parameter 'count' harus angka minimal 1"}),
        )
        .into_response();
    }
    if count > 10000 {
        return Json(json!({"status": false, "message": "Parameter 'count' maksimal 10000"}))
            .into_response();
    }

    const DELAY_MS: u64 = 2000;

    tokio::spawn(run_background_process(
        state.client.clone(),
        question.clone().unwrap(),
        url.clone().unwrap(),
        count,
        DELAY_MS,
    ));

    Json(json!({
        "status": true,
        "result": {
            "totalMessages": count,
            "delay": "2 detik",
            "estimatedTime": format!("{:.1} menit", (count as f64 * DELAY_MS as f64) / 60000.0),
            "note": "Proses berjalan di latar belakang",
        }
    })).into_response()

}

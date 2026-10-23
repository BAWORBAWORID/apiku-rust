// 8D Audio Search, Catalog & Stream — native conversion of api/search/8daudio.js
// Base: https://8daudio.vercel.app — actions: search, library, track, play.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://8daudio.vercel.app";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const ACTIONS: [&str; 4] = ["search", "library", "track", "play"];

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

async fn req_api(c: &reqwest::Client, path: &str, method: &str) -> Result<Value, String> {
    let url = format!("{}{}", BASE, path);
    let mut last_err = String::new();
    for i in 0..=3 {
        let attempt = if method == "POST" {
            c.post(&url).send().await
        } else {
            c.get(&url).send().await
        };
        match attempt {
            Ok(res) => {
                let status = res.status().as_u16();
                let retryable = matches!(status, 408 | 425 | 429 | 500 | 502 | 503 | 504);
                let txt = res.text().await.unwrap_or_default();
                if retryable && i < 3 {
                    let wait = (1000u64 * 2u64.pow(i)).min(8000);
                    tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                    last_err = format!("HTTP {}", status);
                    continue;
                }
                let data: Value = serde_json::from_str(txt.trim())
                    .map_err(|_| format!("Respons bukan JSON ({}): {}...", status, &txt[..txt.len().min(100)]))?;
                if !(200..300).contains(&status) {
                    let msg = data
                        .get("error")
                        .or_else(|| data.get("message"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("HTTP {}", status));
                    return Err(msg);
                }
                return Ok(data);
            }
            Err(e) => {
                last_err = e.to_string();
                if i < 3 {
                    tokio::time::sleep(std::time::Duration::from_millis((1000u64 * 2u64.pow(i)).min(8000))).await;
                }
            }
        }
    }
    Err(last_err)
}

fn normalize_track(t: &Value) -> Value {
    let opt_str = |k: &str| -> Value {
        t.get(k)
            .and_then(Value::as_str)
            .map(|s| json!(s.trim()))
            .unwrap_or(Value::Null)
    };
    let opt_num = |k: &str| -> Value { t.get(k).and_then(Value::as_f64) .map(|v| Value::from(v)).unwrap_or(Value::Null) };
    json!({
        "id": opt_str("id"),
        "title": opt_str("title"),
        "artist": opt_str("artist"),
        "genre": opt_str("genre"),
        "description": t.get("description").and_then(Value::as_str).unwrap_or(""),
        "duration": opt_num("duration"),
        "plays": t.get("plays").and_then(Value::as_f64) .map(|v| Value::from(v)).unwrap_or(json!(0)),
        "status": opt_str("status"),
        "audio_url": opt_str("audio_url"),
        "cover_url": opt_str("cover_url"),
        "created_at": opt_str("created_at"),
        "updated_at": opt_str("updated_at"),
    })
}

async fn fetch_library(c: &reqwest::Client, status: Option<&str>, search: Option<&str>, genre: Option<&str>) -> Result<Vec<Value>, String> {
    let mut p = Vec::new();
    if let Some(s) = status {
        p.push(format!("status={}", urlencoding::encode(s)));
    }
    if let Some(s) = search {
        p.push(format!("search={}", urlencoding::encode(s)));
    }
    if let Some(g) = genre {
        if g != "Semua" {
            p.push(format!("genre={}", urlencoding::encode(g)));
        }
    }
    let data = req_api(c, &format!("/api/audio?{}", p.join("&")), "GET").await?;
    let arr = data
        .as_array()
        .ok_or_else(|| "Respons katalog audio bukan array".to_string())?;
    Ok(arr.iter().map(normalize_track).collect())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if !v.is_empty() {
                    return Some(v.clone());
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(s) = v.get(*k).and_then(Value::as_str) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        None
    };

    let raw_action = match get_param(&["action"]) {
        Some(a) => a.trim().to_lowercase(),
        None => {
            return err(
                StatusCode::BAD_REQUEST,
                &format!("Parameter 'action' wajib diisi: {}", ACTIONS.join(", ")),
            )
        }
    };
    if !ACTIONS.contains(&raw_action.as_str()) {
        return err(
            StatusCode::BAD_REQUEST,
            &format!("Action '{}' tidak valid. Pilihan: {}", raw_action, ACTIONS.join(", ")),
        );
    }

    let query_str = get_param(&["query", "search", "q"]).map(|v| v.trim().to_string()).unwrap_or_default();
    let track_id = get_param(&["id", "trackId"]).map(|v| v.trim().to_string()).unwrap_or_default();
    let genre = get_param(&["genre"]).map(|v| v.trim().to_string());
    let status = get_param(&["status"]).map(|v| v.trim().to_string());

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    if raw_action == "search" || raw_action == "library" {
        return match fetch_library(&c, status.as_deref(), if query_str.is_empty() { None } else { Some(&query_str) }, genre.as_deref()).await {
            Ok(items) => Json(json!({
                "status": true,
                "total": items.len(),
                "filters": {
                    "search": if query_str.is_empty() { Value::Null } else { json!(query_str) },
                    "genre": genre,
                    "status": status,
                },
                "result": items,
            }))
            .into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    if raw_action == "track" {
        if track_id.is_empty() {
            return err(StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi (contoh: track-xxxx-xxxx).");
        }
        return match req_api(&c, &format!("/api/audio/{}", urlencoding::encode(&track_id)), "GET").await {
            Ok(t) => Json(json!({"status": true, "result": normalize_track(&t)})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    // play
    if track_id.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=play.");
    }
    match req_api(&c, &format!("/api/audio/{}/play", urlencoding::encode(&track_id)), "POST").await {
        Ok(play_res) => Json(json!({
            "status": true,
            "message": "Play count berhasil ditambahkan",
            "result": play_res,
        }))
        .into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

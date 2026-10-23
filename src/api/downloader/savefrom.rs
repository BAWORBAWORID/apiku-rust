// SaveFrom Downloader — native conversion of api/downloader/savefrom.js
// API: api-wh.savefrom.co.id/api/convert, signature = sha256(sf_url+ts+SECRET).
// Node version decodes the obfuscated link.chunk.js at runtime (node:vm) to
// refresh SECRET; Rust keeps the verified fallback constants. If upstream
// rejects the signature the error is surfaced honestly (no Node proxying).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const API: &str = "https://api-wh.savefrom.co.id/api/convert";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FALLBACK_SECRET: &str = "f798d44177a88668ccff03b58ff945f002bc6ae2eea4901ba9596e3be5367706";
const FALLBACK_TS_CONST: u128 = 1791197287300;

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn is_audio_ext(ext: &str) -> bool {
    ["mp3", "aac", "wav", "ogg", "m4a"].contains(&ext)
}

fn map_media(json: &Value) -> Value {
    let urls = json.get("url").and_then(|u| u.as_array()).cloned().unwrap_or_default();
    let medias: Vec<Value> = urls
        .iter()
        .map(|u| {
            let format = u
                .get("type")
                .or_else(|| u.get("ext"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_lowercase();
            let quality = u.get("quality").cloned().unwrap_or(json!("unknown"));
            json!({
                "type": if is_audio_ext(&format) { "audio" } else { "video" },
                "format": format,
                "quality": quality,
                "url": u.get("url")
            })
        })
        .collect();

    let best = medias
        .iter()
        .find(|m| m["type"] == "video")
        .cloned()
        .or_else(|| medias.first().cloned());

    json!({ "total": medias.len(), "medias": medias, "best": best })
}

async fn do_request(client: &reqwest::Client, target: &str, secret: &str, ts_const: u128) -> Result<Value, String> {
    let ts = now_ms();
    let sig_input = format!("{target}{ts}{secret}");
    let sig = hex::encode(Sha256::digest(sig_input.as_bytes()));

    let form = format!(
        "sf_url={}&ts={}&_ts={}&_tsc=0&_s={}",
        urlencoding::encode(target),
        ts,
        ts_const,
        sig
    );

    let resp = client
        .post(API)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("Origin", "https://savefrom.co.id")
                    .header("Referer", "https://savefrom.co.id/")
                    .header("X-Requested-With", "XMLHttpRequest")
                    .header("Accept", "application/json, text/plain, */*")
        .body(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&text).map_err(|_| "Respons upstream bukan JSON".to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "type"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };
    let dl_type = merged.get("type").cloned().unwrap_or_default();

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let json = match do_request(&client, &url, FALLBACK_SECRET, FALLBACK_TS_CONST).await {
        Ok(j) => j,
        Err(msg) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg
        }))).into_response(),
    };

    let code = json.get("code").and_then(|c| c.as_str()).unwrap_or("");
    if code.contains("invalid_request") {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": "Signature ditolak upstream (SECRET chunk berubah) — perlu update fallback secret"
        }))).into_response();
    }
    if json.get("success").and_then(|s| s.as_bool()) == Some(false) || json.get("message").is_some() {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Upstream error");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg
        }))).into_response();
    }
    let has_urls = json.get("url").and_then(|u| u.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
    if !has_urls {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Tidak ada media ditemukan untuk URL ini"
        }))).into_response();
    }

    let mapped = map_media(&json);
    let medias = mapped["medias"].as_array().cloned().unwrap_or_default();
    let filtered: Vec<Value> = if dl_type == "audio" {
        medias.into_iter().filter(|m| m["type"] == "audio").collect()
    } else {
        medias
    };

    Json(json!({
        "status": true,
        "input": url,
        "result": {
            "total": filtered.len(),
            "medias": filtered,
            "best": mapped.get("best")
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()

}

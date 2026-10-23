// SnapAny Downloader — native conversion of api/downloader/snapany.js
// API: api.snapany.com/v1/extract/post with HMAC-SHA256 G-Footer auth
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha2::Sha256;

const API: &str = "https://api.snapany.com";
const SECRET_KEY: &str = "a5wU-SVyy5gXIyMbPQIfIz7UP7rCBp76U8Z8i-FtDMU";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "locale"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }

    let raw_url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    let clean_url = match url::Url::parse(&raw_url) {
        Ok(u) if u.scheme() == "http" || u.scheme() == "https" => u.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' harus berupa URL http/https yang valid"
        }))).into_response(),
    };

    let locale = merged.get("locale").cloned().unwrap_or_else(|| "en".into());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();

    let footer = {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(SECRET_KEY.as_bytes()).expect("hmac key");
        mac.update(format!("{clean_url}{locale}{timestamp}").as_bytes());
        hex::encode(mac.finalize().into_bytes())
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("SnapAny API error: {e}")
        }))).into_response(),
    };

    let data: Value = match client
        .post(format!("{API}/v1/extract/post"))
                    .header("Content-Type", "application/json")
        .header("Accept-Language", &locale)
        .header("G-Timestamp", &timestamp)
        .header("G-Footer", footer)
                    .header("G-Timezone", "Asia/Jakarta")
                    .header("Origin", "https://snapany.com")
                    .header("Referer", "https://snapany.com/")
        .json(&json!({ "link": clean_url }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false, "message": format!("SnapAny API error: {e}")
            }))).into_response(),
        },
        Ok(r) => {
            let text = r.text().await.unwrap_or_default();
            let snippet: String = text.chars().take(500).collect();
            return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false, "message": format!("SnapAny API error: {snippet}")
            }))).into_response();
        }
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false, "message": format!("SnapAny API error: {e}")
        }))).into_response(),
    };

    let medias: Vec<Value> = data
        .get("medias")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            json!({
                "media_type": m.get("media_type").cloned().unwrap_or(Value::Null),
                "resource_url": m.get("resource_url").cloned().unwrap_or(Value::Null),
                "resource_proxy_url": m.get("resource_proxy_url").cloned().unwrap_or(Value::Null),
                "preview_url": m.get("preview_url").cloned().unwrap_or(Value::Null),
                "duration": m.get("duration").cloned().unwrap_or(Value::Null),
                "variants": m.get("variants").cloned().unwrap_or(Value::Null),
                "subtitles": m.get("subtitles").cloned().unwrap_or(Value::Null)
            })
        })
        .collect();

    Json(json!({
        "status": true,
        "url": data.get("post_url").cloned().unwrap_or(json!(clean_url)),
        "site": data.get("site").cloned().unwrap_or(Value::Null),
        "title": data.get("title").cloned().unwrap_or(Value::Null),
        "text": data.get("text").cloned().unwrap_or(Value::Null),
        "total": medias.len(),
        "medias": medias,
        "duration": format!("{}ms", started.elapsed().as_millis())
    })).into_response()

}

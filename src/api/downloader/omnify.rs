// Omnify AIO Downloader — native conversion of api/downloader/omnify.js
// Upstream: api-aio.omnifylabs.sbs/api/v1/media/resolve (no auth, plain POST JSON).
use axum::{
    extract::{Query, Json as AxumJson},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const RESOLVE_URL: &str = "https://api-aio.omnifylabs.sbs/api/v1/media/resolve";

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
        _ => return Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        })).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(json!({
            "status": false, "message": format!("Gagal menghubungi Omnify resolver: {e}")
        })).into_response(),
    };

    let data: Value = match client
        .post(RESOLVE_URL)
                    .header("Content-Type", "application/json")
        .json(&json!({ "url": url }))
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => return Json(json!({
            "status": false, "message": format!("Gagal menghubungi Omnify resolver: {e}")
        })).into_response(),
    };

    let status = data.get("status").and_then(|s| s.as_str()).unwrap_or("");
    if status != "success" {
        let msg = data
            .pointer("/data/message")
            .or_else(|| data.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Gagal resolve media")
            .to_string();
        return Json(json!({
            "status": false,
            "message": msg,
            "platform": data.get("platform").cloned().unwrap_or(Value::Null)
        }))
        .into_response();
    }

    Json(json!({ "status": true, "result": data })).into_response()
}

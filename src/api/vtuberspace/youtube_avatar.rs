// YouTube Avatar — native conversion of api/vtuberspace/youtube-avatar.js
// Calls vtuberspace.id /api/youtube-avatar?url=... and shapes the response.
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://vtuberspace.id";

fn default_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".parse().unwrap());
    h.insert("Accept", "application/json, text/plain, */*".parse().unwrap());
    h.insert("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h.insert("Referer", format!("{}/", BASE_URL).parse().unwrap());
    h
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let mut url_param = query.get("url").cloned().unwrap_or_default();
    if url_param.is_empty() {
        if let Some(Json(b)) = &body { url_param = b.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(); }
    }
    if url_param.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "error": "Parameter 'url' wajib diisi"}))).into_response();
    }

    let target = format!("{}/api/youtube-avatar?url={}", BASE_URL, urlencoding::encode(url_param.trim()));
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap();
    let res = match client.get(&target).headers(default_headers()).send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": e.to_string()}))).into_response(),
    };
    if !res.status().is_success() {
        let err = format!("Failed to resolve YouTube avatar ({})", res.status().as_u16());
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": err}))).into_response();
    }
    let json: Value = match res.json().await {
        Ok(j) => j,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": e.to_string()}))).into_response(),
    };
    let avatar = json.get("avatar").cloned().unwrap_or(Value::Null);
    Json(json!({"success": true, "channel_url": url_param, "avatar": avatar})).into_response()
}

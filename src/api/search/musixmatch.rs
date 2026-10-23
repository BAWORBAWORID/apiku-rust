use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/// Merge query params + JSON body params (mirrors `{ ...req.query, ...req.body }`).
fn param(query: &HashMap<String, String>, body: &Option<Json<Value>>, key: &str) -> Option<String> {
    if let Some(v) = query.get(key) {
        if !v.trim().is_empty() {
            return Some(v.clone());
        }
    }
    if let Some(Json(b)) = body {
        if let Some(s) = b.get(key).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("client error: {e}"))
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": message}))).into_response()
}

fn server_error(message: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": message}))).into_response()
}


// Musixmatch Lyrics — native conversion of api/search/musixmatch.js
// Extract __NEXT_DATA__ JSON from a Musixmatch lyrics page.
pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let url = match param(&query, &body, "url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return bad_request("Parameter 'url' wajib diisi");
        }
    };

    if !url.contains("musixmatch.com/lyrics/") {
        return bad_request("URL harus dari domain musixmatch.com/lyrics/");
    }

    let c = match client(30) {
        Ok(c) => c,
        Err(e) => return server_error(&e),
    };

    let html = match c.get(&url)            .header("Accept", "text/html").send().await {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return server_error(&format!("Gagal scrape Musixmatch: {e}")),
        },
        Err(e) => return server_error(&format!("Gagal scrape Musixmatch: {e}")),
    };

    // Find <script id="__NEXT_DATA__" type="application/json">...</script>
    let start_tag = "<script id=\"__NEXT_DATA__\" type=\"application/json\">";
    let start = match html.find(start_tag) {
        Some(i) => i + start_tag.len(),
        None => return server_error("Tidak dapat menemukan __NEXT_DATA__ di halaman"),
    };
    let end = match html[start..].find("</script>") {
        Some(e) => start + e,
        None => return server_error("Tidak dapat menemukan __NEXT_DATA__ di halaman"),
    };
    let state: Value = match serde_json::from_str(html[start..end].trim()) {
        Ok(v) => v,
        Err(e) => return server_error(&format!("__NEXT_DATA__ tidak valid: {e}")),
    };

    let track_info = match state.pointer("/props/pageProps/data/trackInfo/data") {
        Some(t) if !t.is_null() => t.clone(),
        _ => return server_error("Track info tidak ditemukan"),
    };

    let lyrics = track_info
        .pointer("/lyrics/body")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let result = json!({
        "title": track_info.pointer("/track/name").filter(|v| !v.is_null()),
        "artist": track_info.pointer("/track/artistName").filter(|v| !v.is_null()),
        "album": track_info.pointer("/track/albumName").filter(|v| !v.is_null()),
        "language": track_info.pointer("/lyrics/languageDescription").filter(|v| !v.is_null()),
        "image": track_info
            .pointer("/track/coverImageHD")
            .filter(|v| !v.is_null())
            .or_else(|| track_info.pointer("/track/coverImage").filter(|v| !v.is_null())),
        "lyrics": lyrics,
        "url": url,
    });

    Json(json!({"status": true, "result": result})).into_response()
}

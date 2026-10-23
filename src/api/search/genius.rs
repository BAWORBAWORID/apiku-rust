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

// Genius Lyrics — native conversion of api/search/genius.js
// Public Genius API (app headers, no key): search songs or fetch detail + lyrics.
const GENIUS_HEADERS: &[(&str, &str)] = &[
    ("x-genius-app-background-request", "0"),
    ("x-genius-logged-out", "true"),
    ("x-genius-android-version", "8.1.1"),
    ("User-Agent", "Genius/8.1.1 (Android; Android 13; ZN/Android)"),
];

/// Recursively flatten the Genius lyrics DOM JSON into plain text.
fn parse_lyrics(node: &Value) -> String {
    match node {
        Value::String(s) => s.clone(),
        Value::Object(o) => {
            if o.get("tag").and_then(|t| t.as_str()) == Some("br") {
                return "\n".to_string();
            }
            match o.get("children").and_then(|c| c.as_array()) {
                Some(children) => children.iter().map(parse_lyrics).collect::<Vec<_>>().join(""),
                None => String::new(),
            }
        }
        Value::Array(a) => a.iter().map(parse_lyrics).collect::<Vec<_>>().join(""),
        _ => String::new(),
    }
}

async fn genius_get(url: &str) -> Result<Value, String> {
    let c = client(30)?;
    let mut req = c.get(url);
    for (k, v) in GENIUS_HEADERS {
        req = req.header(*k, *v);
    }
    let resp = req.send().await.map_err(|e| format!("Request error: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read error: {e}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    serde_json::from_str(&text).map_err(|e| format!("JSON parse error: {e}"))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let id = param(&query, &body, "id");
    let query_param = param(&query, &body, "query");

    if let Some(id) = id.filter(|s| !s.trim().is_empty()) {
        let url = format!("https://api.genius.com/songs/{}", urlencoding::encode(id.trim()));
        let data = match genius_get(&url).await {
            Ok(d) => d,
            Err(e) => return server_error(&e),
        };
        let song = &data["response"]["song"];
        let lyrics = song
            .pointer("/lyrics/dom")
            .map(parse_lyrics)
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty());
        let result = json!({
            "id": song.get("id"),
            "title": song.get("title"),
            "artist": song.get("artist_names"),
            "header_image_url": song.get("header_image_url"),
            "song_art_image_url": song.get("song_art_image_url"),
            "instrumental": song.get("instrumental"),
            "is_music": song.get("is_music"),
            "hidden": song.get("hidden"),
            "explicit": song.get("explicit"),
            "release_date": song.get("release_date_for_display"),
            "url": song.get("url"),
            "lyrics": lyrics,
        });
        return Json(json!({"status": true, "result": result})).into_response();
    }

    let q = match query_param {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => {
            return bad_request("Parameter 'query' wajib diisi.");
        }
    };

    let url = format!(
        "https://api.genius.com/search/multi?q={}",
        urlencoding::encode(&q)
    );
    let data = match genius_get(&url).await {
        Ok(d) => d,
        Err(e) => return server_error(&e),
    };

    let mut seen = std::collections::HashSet::new();
    let mut songs = Vec::new();
    if let Some(sections) = data.pointer("/response/sections").and_then(|s| s.as_array()) {
        for section in sections {
            let stype = section.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if stype != "song" && stype != "top_hit" {
                continue;
            }
            if let Some(hits) = section.get("hits").and_then(|h| h.as_array()) {
                for hit in hits {
                    if hit.get("type").and_then(|t| t.as_str()) != Some("song") {
                        continue;
                    }
                    let result = &hit["result"];
                    let song_id = result.get("id").cloned().unwrap_or(Value::Null);
                    let key = song_id.to_string();
                    if !seen.insert(key) {
                        continue;
                    }
                    songs.push(json!({
                        "id": result.get("id"),
                        "title": result.get("title"),
                        "artist": result.get("artist_names"),
                        "header_image_url": result.get("header_image_url"),
                        "url": result.get("url"),
                    }));
                }
            }
        }
    }

    Json(json!({"status": true, "result": songs})).into_response()
}

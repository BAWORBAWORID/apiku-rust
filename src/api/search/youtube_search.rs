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


// YouTube Search — native conversion of api/search/youtube-search.js
// Node version used the yt-search library (which scrapes YouTube internally);
// Rust version performs the equivalent scrape of the YouTube search page HTML.
fn text_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    let q = match query.get("query") {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => {
            return bad_request("Parameter 'query' wajib diisi");
        }
    };

    let url = format!(
        "https://www.youtube.com/results?search_query={}&hl=en&gl=US",
        urlencoding::encode(&q)
    );
    let c = match client(60) {
        Ok(c) => c,
        Err(e) => return server_error(&e),
    };

    let html = match c
        .get(&url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return server_error(&format!("Gagal mencari video: {e}")),
        },
        Err(e) => return server_error(&format!("Gagal mencari video: {e}")),
    };

    // Extract ytInitialData JSON
    let data: Value = {
        let start = match html.find("var ytInitialData = ") {
            Some(i) => i + "var ytInitialData = ".len(),
            None => return server_error("ytInitialData tidak ditemukan"),
        };
        let mut depth = 0usize;
        let mut in_str = false;
        let mut esc = false;
        let bytes = html.as_bytes();
        let mut end = None;
        for (i, &b) in bytes[start..].iter().enumerate() {
            let ch = b as char;
            if in_str {
                if esc { esc = false; }
                else if ch == '\\' { esc = true; }
                else if ch == '"' { in_str = false; }
                continue;
            }
            match ch {
                '"' => in_str = true,
                '{' | '[' => depth += 1,
                '}' | ']' => {
                    depth -= 1;
                    if depth == 0 { end = Some(i + 1); break; }
                }
                _ => {}
            }
        }
        let end = match end {
            Some(e) => start + e,
            None => return server_error("ytInitialData tidak valid"),
        };
        match serde_json::from_str(&html[start..end]) {
            Ok(v) => v,
            Err(e) => return server_error(&format!("JSON ytInitialData tidak valid: {e}")),
        }
    };

    // Walk the JSON tree collecting videoRenderer entries
    fn walk(node: &Value, out: &mut Vec<Value>) {
        match node {
            Value::Object(obj) => {
                if let Some(v) = obj.get("videoRenderer") {
                    let video_id = text_of(v.get("videoId")).unwrap_or_default();
                    if !video_id.is_empty() {
                        let runs = |key: &str| -> Option<String> {
                            v.pointer(key)
                                .and_then(|t| t.get("runs"))
                                .and_then(|r| r.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                                        .collect::<Vec<_>>()
                                        .join("")
                                })
                        };
                        let channel_url = v
                            .pointer("/ownerText/runs/0/navigationEndpoint/browseEndpoint/browseId")
                            .and_then(|b| b.as_str())
                            .map(|id| format!("https://www.youtube.com/channel/{}", id));
                        out.push(json!({
                            "title": runs("/title").filter(|s| !s.is_empty()),
                            "channel": runs("/ownerText"),
                            "channelUrl": channel_url,
                            "duration": v.pointer("/lengthText/simpleText"),
                            "thumbnail": v.pointer("/thumbnail/thumbnails").and_then(|t| t.as_array())
                                .and_then(|a| a.last())
                                .and_then(|t| t.get("url")),
                            "url": format!("https://www.youtube.com/watch?v={}", video_id),
                            "views": v.pointer("/viewCountText/simpleText"),
                            "uploadedAt": v.pointer("/publishedTimeText/simpleText"),
                        }));
                    }
                }
                for val in obj.values() {
                    walk(val, out);
                }
            }
            Value::Array(arr) => {
                for v in arr {
                    walk(v, out);
                }
            }
            _ => {}
        }
    }

    let mut raw = Vec::new();
    walk(&data, &mut raw);

    if raw.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "status": false,
                "message": format!("Video \"{}\" tidak ditemukan.", q),
                "timestamp": now_ms(),
            })),
        )
            .into_response();
    }

    let videos: Vec<Value> = raw
        .into_iter()
        .take(20)
        .enumerate()
        .map(|(i, mut v)| {
            v["index"] = json!(i + 1);
            v
        })
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "total": videos.len(),
            "videos": videos,
        },
        "timestamp": now_ms(),
    })).into_response()

}

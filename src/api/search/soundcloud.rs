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

// SoundCloud Search — native conversion of api/search/soundcloud.js
// Scrape hasil pencarian mobile SoundCloud (list vertikal) via HTML parsing.
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

    let url = format!("https://m.soundcloud.com/search?q={}", urlencoding::encode(&q));
    let c = match client(30) {
        Ok(c) => c,
        Err(e) => return server_error(&e),
    };

    let html = match c.get(&url).send().await {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return server_error(&format!("Gagal mencari lagu: {e}")),
        },
        Err(e) => return server_error(&format!("Gagal mencari lagu: {e}")),
    };

    let doc = scraper::Html::parse_document(&html);
    let li_sel = scraper::Selector::parse(".List_VerticalList__2uQYU li").unwrap();
    let cell_sel = scraper::Selector::parse(".Cell_CellLink__3yLVS").unwrap();

    let mut results = Vec::new();
    for li in doc.select(&li_sel) {
        if let Some(cell) = li.select(&cell_sel).next() {
            let title = cell.value().attr("aria-label").unwrap_or("").to_string();
            let music_url = cell.value().attr("href").unwrap_or("").to_string();
            if !title.is_empty() && !music_url.is_empty() {
                let full = if music_url.starts_with("http") {
                    music_url
                } else {
                    format!("https://m.soundcloud.com{}", music_url)
                };
                results.push((title, full));
            }
        }
    }

    if results.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "status": false,
                "message": format!("Lagu \"{}\" tidak ditemukan.", q),
                "timestamp": now_ms(),
            })),
        )
            .into_response();
    }

    let tracks: Vec<Value> = results
        .into_iter()
        .take(10)
        .enumerate()
        .map(|(i, (title, url))| json!({"index": i + 1, "title": title, "url": url}))
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "total": tracks.len(),
            "tracks": tracks,
        },
        "timestamp": now_ms(),
    })).into_response()

}

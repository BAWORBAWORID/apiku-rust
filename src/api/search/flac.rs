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

// FlacDownloader Search — native conversion of api/search/flac.js
// Scrape flacdownloader.com search results (trending/popular lists, fallback /berita/ + /news/ links).
pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let q = match param(&query, &body, "q") {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'q' wajib diisi",
                "timestamp": now_ms(),
            }))).into_response()
        }
    };

    const BASE_URL: &str = "https://flacdownloader.com";
    let search_url = format!("{}/search?q={}", BASE_URL, urlencoding::encode(&q));

    let client = match client(30) {
        Ok(c) => c,
        Err(e) => return server_error(&e),
    };

    let html = match client
        .get(&search_url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", format!("{}/en", BASE_URL))
        .header("Origin", format!("{}/en", BASE_URL))
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return server_error(&format!("Gagal mencari track di FlacDownloader: {e}")),
        },
        Err(e) => return server_error(&format!("Gagal mencari track di FlacDownloader: {e}")),
    };

    let doc = scraper::Html::parse_document(&html);

    let mut tracks: Vec<(String, String)> = Vec::new();
    // Primary: list items inside trending/popular lists
    let li_sel = scraper::Selector::parse(
        ".trending-list li, .trending li, .popular li, [class*='trending'] li, [class*='popular'] li",
    )
    .unwrap();
    let a_sel = scraper::Selector::parse("a").unwrap();
    for el in doc.select(&li_sel) {
        let link_el = match el.select(&a_sel).next() {
            Some(a) => a,
            None => continue,
        };
        let title = link_el
            .text()
            .collect::<String>()
            .trim()
            .to_string();
        let title = if title.is_empty() {
            el.text().collect::<String>().trim().to_string()
        } else {
            title
        };
        let link = link_el.value().attr("href").unwrap_or("").to_string();
        if !title.is_empty() && !link.is_empty() && title.chars().count() > 3 {
            let full = if link.starts_with("http") { link } else { format!("{}{}", BASE_URL, link) };
            tracks.push((title, full));
        }
    }

    // Fallback: /berita/ or /news/ links
    if tracks.is_empty() {
        let news_sel = scraper::Selector::parse("a[href*='/berita/'], a[href*='/news/']").unwrap();
        for el in doc.select(&news_sel) {
            let href = el.value().attr("href").unwrap_or("").to_string();
            let text = el.text().collect::<String>().trim().to_string();
            if !href.is_empty() && text.chars().count() > 10 {
                let full = if href.starts_with("http") { href } else { format!("{}{}", BASE_URL, href) };
                tracks.push((text, full));
            }
        }
    }

    // Dedupe by link, limit 20
    let mut seen = std::collections::HashSet::new();
    let results: Vec<Value> = tracks
        .into_iter()
        .filter(|(_, l)| seen.insert(l.clone()))
        .take(20)
        .map(|(title, link)| json!({"title": title, "link": link}))
        .collect();

    Json(json!({
        "status": true,
        "timestamp": now_ms(),
        "data": {
            "source": BASE_URL,
            "query": q,
            "total": results.len(),
            "tracks": results,
        }
    })).into_response()

}

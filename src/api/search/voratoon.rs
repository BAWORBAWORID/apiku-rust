// Voratoon Updates — native conversion of api/search/voratoon.js
// Update manga/manhwa terbaru dari v1.voratoon.com (JSON embedded / fallback regex).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://v1.voratoon.com";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().to_rfc3339()}))).into_response()
}

fn latest_chapter_json(series: &Value, slug: &str) -> Value {
    match series.get("latestChapter") {
        Some(l) if !l.is_null() => {
            let index = l
                .get("chapterIndex")
                .or_else(|| l.get("index"))
                .cloned()
                .unwrap_or(Value::Null);
            json!({
                "index": index,
                "id": l.get("id").cloned().unwrap_or(Value::Null),
                "url": format!("{}/series/{}/chapter/{}", BASE, slug, index),
            })
        }
        _ => Value::Null,
    }
}

fn series_item(series: &Value, updated_at: Value) -> Value {
    let slug = series
        .get("slug")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let genres: String = series
        .get("genres")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|g| g.get("name").and_then(Value::as_str).unwrap_or_else(|| g.as_str().unwrap_or("")))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let pick = |names: &[&str]| -> Value {
        for n in names {
            if let Some(v) = series.get(*n) {
                if !v.is_null() {
                    return v.clone();
                }
            }
        }
        Value::Null
    };
    json!({
        "title": pick(&["title", "name"]),
        "nativeTitle": pick(&["nativeTitle", "originalTitle"]),
        "slug": if slug.is_empty() { Value::Null } else { json!(slug) },
        "coverImage": pick(&["coverImage", "thumbnail", "image"]),
        "synopsis": pick(&["synopsis", "description"]),
        "author": pick(&["author", "authorName"]),
        "rating": pick(&["rating", "rate"]),
        "status": pick(&["status", "statusName"]),
        "format": pick(&["format", "type"]),
        "totalChapters": pick(&["totalChapters", "chapterCount"]),
        "genres": if genres.is_empty() { Value::Null } else { json!(genres) },
        "url": if slug.is_empty() { Value::Null } else { json!(format!("{}/series/{}", BASE, slug)) },
        "latestChapter": latest_chapter_json(series, &slug),
        "updatedAt": updated_at,
    })
}

fn parse_series_data(series: &Value) -> Vec<Value> {
    series
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|s| series_item(s, Value::Null))
                .filter(|i| i.get("title").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_updates_data(updates: &Value) -> Vec<Value> {
    let mut results = Vec::new();
    if let Some(arr) = updates.as_array() {
        for item in arr {
            let series = item
                .get("series")
                .or_else(|| item.get("data"))
                .unwrap_or(item);
            if series.is_null() {
                continue;
            }
            let updated_at = item
                .get("updatedAt")
                .or_else(|| item.get("updated_at"))
                .cloned()
                .unwrap_or(Value::Null);
            let parsed = series_item(series, updated_at);
            if parsed.get("title").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false) {
                results.push(parsed);
            }
        }
    }
    results
}

fn parse_html_direct(html: &str) -> Vec<Value> {
    let re = regex::Regex::new(
        r#"<a[^>]*href="/series/([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</[^>]*>"#,
    )
    .unwrap();
    re.captures_iter(html)
        .map(|m| {
            let slug = m[1].to_string();
            let cover = m[2].to_string();
            let title = m[3].trim().to_string();
            json!({
                "title": title,
                "slug": slug,
                "coverImage": cover,
                "url": format!("{}/series/{}", BASE, slug),
                "nativeTitle": Value::Null,
                "synopsis": Value::Null,
                "author": Value::Null,
                "rating": Value::Null,
                "status": Value::Null,
                "format": Value::Null,
                "totalChapters": Value::Null,
                "genres": Value::Null,
                "latestChapter": Value::Null,
                "updatedAt": Value::Null,
            })
        })
        .filter(|i| i.get("title").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false))
        .collect()
}

fn extract_series_from_html(html: &str) -> Vec<Value> {
    let script_re = regex::Regex::new(r#"<script[^>]*type="application/json"[^>]*>([\s\S]*?)</script>"#).unwrap();
    for m in script_re.captures_iter(html) {
        let content = m[1].trim();
        if let Ok(data) = serde_json::from_str::<Value>(content) {
            if let Some(s) = data.pointer("/props/pageProps/series") {
                return parse_series_data(s);
            }
            if let Some(s) = data.get("series") {
                return parse_series_data(s);
            }
            if let Some(u) = data.get("updates") {
                return parse_updates_data(u);
            }
        }
    }
    let next_re = regex::Regex::new(r#"<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>"#).unwrap();
    if let Some(m) = next_re.captures(html) {
        if let Ok(data) = serde_json::from_str::<Value>(m[1].trim()) {
            if let Some(s) = data.pointer("/props/pageProps/series") {
                return parse_series_data(s);
            }
            if let Some(s) = data.pointer("/query/series") {
                return parse_series_data(s);
            }
            if let Some(u) = data.pointer("/props/pageProps/updates") {
                return parse_updates_data(u);
            }
        }
    }
    parse_html_direct(html)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let page_param = query
        .get("page")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("page").and_then(Value::as_i64).map(|n| n.to_string())))
        .unwrap_or_else(|| "1".to_string());
    let page: i64 = page_param.parse().unwrap_or(1).clamp(1, 20);

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let url = if page == 1 {
        format!("{}/updates", BASE)
    } else {
        format!("{}/updates?page={}", BASE, page)
    };

    let html = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        },
        Ok(r) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP {}", r.status().as_u16())),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let items = extract_series_from_html(&html);
    if items.is_empty() {
        return err(StatusCode::NOT_FOUND, "No updates found for this page");
    }

    Json(json!({
        "status": true,
        "page": page,
        "total": items.len(),
        "results": items,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })).into_response()
}

// Drama Series Stream Downloader — native conversion of api/downloader/drama.js
// Node version delegates to lk21Scraper with category 'series'; native version
// reuses the native lk21.rs scrapers (pub(crate)) the same way.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["action", "q", "page", "slug", "genre"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let s = |k: &str| merged.get(k).map(|v| v.to_string());

    let action = s("action").unwrap_or_else(|| "latest".into());
    let page: u32 = s("page").and_then(|v| v.parse().ok()).unwrap_or(1);
    // Default category 'series' for drama
    let category = "series";

    let result: Result<Value, String> = match action.to_lowercase().as_str() {
        "home" => crate::api::downloader::lk21::scrape_home(category).await,
        "search" => match s("q").as_deref() {
            Some(q) if !q.is_empty() => crate::api::downloader::lk21::scrape_search(q, category, page).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'q' wajib untuk search"
                }))).into_response()
            }
        },
        "genre" => match s("genre").as_deref() {
            Some(g) if !g.is_empty() => crate::api::downloader::lk21::scrape_genre(g, category, page).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'genre' wajib"
                }))).into_response()
            }
        },
        "detail" => match s("slug").as_deref() {
            Some(sl) if !sl.is_empty() => crate::api::downloader::lk21::scrape_detail(sl, category).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'slug' wajib untuk detail"
                }))).into_response()
            }
        },
        "watch" => match s("slug").as_deref() {
            Some(sl) if !sl.is_empty() => crate::api::downloader::lk21::scrape_watch_series(sl).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'slug' wajib untuk watch"
                }))).into_response()
            }
        },
        _ => crate::api::downloader::lk21::scrape_latest(category, page).await,
    };

    match result {
        Ok(result) => Json(json!({
            "status": true,
            "creator": "ShanMolvyr",
            "action": action,
            "category": category,
            "result": result
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e
        }))).into_response(),
    }
}

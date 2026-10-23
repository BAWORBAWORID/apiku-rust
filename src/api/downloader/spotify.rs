// Spotify Downloader (spotidown.app) — native conversion of api/downloader/spotify.js
// Node version drives spotidown.app with Puppeteer (browser) to submit the track
// form and intercept /action/track. Native HTTP cannot replicate the browser
// flow reliably (Turnstile-protected), so this endpoint returns an honest error.
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
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = merged.get("url").cloned().unwrap_or_default();
    if !url.contains("open.spotify.com/track") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib berupa link Spotify track (https://open.spotify.com/track/...)"
        }))).into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "spotidown.app membutuhkan browser engine (Puppeteer + Turnstile) — belum didukung native. Gunakan /api/downloader/spotifyv2 untuk metadata."
    }))).into_response()
}

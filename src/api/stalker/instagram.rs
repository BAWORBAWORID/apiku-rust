// Instagram Stalker — native conversion of api/stalker/instagram.js
// The Node version drives Puppeteer (headless Chrome) through InstaShadow's
// Cloudflare-protected UI (cf-turnstile + /api/analytics interception). There is
// no browser engine in the native build, so this endpoint reports that honestly.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(_query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "status": false,
            "message": "butuh browser engine (Puppeteer/Chrome) untuk melewati Cloudflare InstaShadow, belum didukung native",
        })),
    )
        .into_response()
}

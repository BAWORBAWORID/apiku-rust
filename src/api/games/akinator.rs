// Akinator — native conversion of api/games/akinator.js
//
// IMPORTANT: id.akinator.com kini memakai Cloudflare dengan TLS-fingerprinting.
// curl maupun reqwest (rustls) di-block 403 "Just a moment..." — versi Node lolos
// karena got-scraping meniru TLS fingerprint browser. Native HTTP Rust TIDAK bisa
// melewati ini, jadi handler mengembalikan error yang jelas tanpa fallback diam-diam.
use axum::{response::{IntoResponse, Json}, extract::{Query, State}};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

pub async fn handler(
    State(_state): State<AppState>,
    _query: Query<HashMap<String, String>>,
) -> impl IntoResponse {
    Json(json!({
        "status": false,
        "code": "UPSTREAM_BLOCKED",
        "message": "id.akinator.com memblokir non-browser (Cloudflare TLS fingerprinting). Endpoint ini memerlukan got-scraping (Node) atau browser engine — tidak tersedia di solver native Rust."
    })).into_response()
}

// OuO Bypass — native conversion of api/bypass/ouo-bypass.js
// The Node version drives a stealth Puppeteer browser to pass ouo.io's challenge
// and click through. Pure HTTP cannot reproduce that, so this native version
// returns the honest "browser required" error.
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
    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "butuh browser engine, belum didukung native"
    })))
    .into_response()
}

// Recaptcha V2 Solver — native conversion of api/solve/recaptcha-v2.js
// Node version drives Puppeteer (Chrome + Qwen AI audio/image assist) to solve
// reCAPTCHA V2 challenges. There is no browser engine in the native build, so
// this endpoint reports that honestly.
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
            "message": "butuh browser engine (Puppeteer + Qwen AI) untuk solve reCAPTCHA V2, belum didukung native",
        })),
    )
        .into_response()
}

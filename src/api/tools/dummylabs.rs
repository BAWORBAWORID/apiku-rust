// DummyLabs — native conversion of api/tools/dummylabs.js
// JS membutuhkan browser engine (puppeteer/playwright); belum didukung native — response jujur.
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(_query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    Json(json!({
        "status": false,
        "message": "butuh browser engine, belum didukung native"
    })).into_response()

}

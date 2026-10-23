// sertifikat-tolol — native conversion of api/canvas/sertifikat-tolol.js
// Canvas is deprecated: the Node version depends on node-canvas to render images,
// which has no native Rust equivalent wired up here. Short-circuit to a clear
// error so callers get a structured response instead of a proxy call.
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
        "message": "canvas deprecated, butuh canvas engine"
    })).into_response()

}

// Profilejson — native conversion of api/maker/profilejson.js
// Node version renders the response image with @napi-rs/canvas; Rust has no
// canvas/browser engine yet, so this handler validates parameters exactly
// like the Node version and then returns an honest unsupported-engine error
// instead of silently proxying to the Node backend.
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    // Merge query params and JSON body (body takes precedence, like {...req.query, ...req.body})
    let mut p = query;
    if let Some(Json(b)) = body {
        if let Value::Object(map) = b {
            for (k, v) in map {
                let s = match v {
                    Value::String(s) => s,
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                p.insert(k, s);
            }
        }
    }

    // Semua parameter punya default di versi Node — tidak ada validasi wajib.
    (StatusCode::NOT_IMPLEMENTED, Json(json!({ "status": false, "message": "butuh canvas/browser engine, belum didukung native" }))).into_response()
}

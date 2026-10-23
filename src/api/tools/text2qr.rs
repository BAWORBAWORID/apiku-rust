// Text2Qr — native conversion of api/tools/text2qr.js
// JS menghasilkan PNG QR via library `qrcode`; native membutuhkan crate qrcode+image
// yang belum ada di Cargo.toml — response jujur sesuai konvensi tools engine-dependent.
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let text = query.get("text").cloned().or_else(|| {
        body.as_ref()
            .and_then(|b| b.get("text"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    });

    let _text = match text {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Json(json!({"status": false, "message": "Parameter 'text' wajib diisi"}))
                .into_response()
        }
    };

    Json(json!({
        "status": false,
        "message": "butuh browser engine, belum didukung native"
    })).into_response()

}

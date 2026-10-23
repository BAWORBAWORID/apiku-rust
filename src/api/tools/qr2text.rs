// Qr2Text — native conversion of api/tools/qr2text.js
// JS mendekode QR via canvas + jsQR (image decoding engine); native belum didukung
// tanpa crate image/rqrr di Cargo.toml — response jujur sesuai konvensi.
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
    let url = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|b| b.get("url"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    });

    let _url = match url {
        Some(u) if !u.is_empty() => u,
        _ => {
            return Json(json!({"status": false, "message": "Parameter 'url' wajib diisi"}))
                .into_response()
        }
    };

    Json(json!({
        "status": false,
        "message": "butuh browser engine, belum didukung native"
    })).into_response()

}

// GTW APK Downloader — native conversion of api/downloader/gtw.js
// Node version (34KB): multi-source (an1, liteapk, ...) HTML scraping dengan
// safe math-expression evaluator untuk link terobfuscasi + session cookies.
// Native subset: evaluator obfuscasi belum dikonversi — error jujur.
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
        for k in ["action", "query", "url", "source", "page", "sub"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let action = merged.get("action").cloned().unwrap_or_default();
    if action.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'action' wajib: search, detail, download, home, apps, games"
        }))).into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "GTW APK Downloader membutuhkan evaluasi ekspresi terobfuscasi (safe math eval) untuk resolve link download — belum didukung native.",
        "action": action
    }))).into_response()
}

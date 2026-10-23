// SssInstagram Downloader — native conversion of api/downloader/sssinstagram.js
// Node version: resolves Turnstile captcha via cap.jhx.my.id, evaluates obfuscated
// webpack chunk (node:vm) to generate signature, then calls api-wh.sssinstagram.com.
// Native subset: signature generation butuh evaluasi JS webpack chunk — tidak
// mungkin dikonversi aman ke Rust, jadi endpoint mengembalikan error jujur.
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
        for k in ["url", "link"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let target = merged.get("url").or_else(|| merged.get("link")).map(|s| s.trim().to_string()).unwrap_or_default();
    if target.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "sssinstagram.com membutuhkan solver Turnstile + evaluasi chunk JS webpack untuk signature — belum didukung native."
    }))).into_response()
}

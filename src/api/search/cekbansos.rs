// Cek Bansos (Kemensos) — native conversion of api/search/cekbansos.js
// Node versi menyelesaikan captcha via OCR (ddddocr-node) + proxy khusus.
// Native Rust belum punya OCR captcha yang setara, jadi return error jujur.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let nik = query
        .get("nik")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("nik").and_then(Value::as_str).map(str::to_string)));

    let nik = match nik {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "error": "Parameter 'nik' wajib diisi (16 digit)."}))).into_response(),
    };

    if nik.len() != 16 || !nik.chars().all(|c| c.is_ascii_digit()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "error": "NIK harus 16 digit angka."}))).into_response();
    }

    (StatusCode::BAD_GATEWAY, Json(json!({
        "success": false,
        "message": "butuh engine OCR captcha (ddddocr) dan proxy khusus, belum didukung native"
    })))
    .into_response()
}

// GoPay QRIS — native conversion of api/payment/gopay-qris.js
// QRIS payload composition (EMVCo + CRC16) is fully native. Node rendered the
// QR PNG via the qrcode package (canvas/PNG engine); the native build has no
// QR image encoder wired up, so `image` is reported honestly instead of a PNG data URL.
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use super::gopay_sdk as sdk;

fn merged(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Value {
    let mut m = json!({});
    if let Some(Json(b)) = body {
        if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } }
    }
    for (k, v) in query { m[k] = json!(v); }
    m
}

fn str_param(m: &Value, key: &str) -> Option<String> {
    match m.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(b.to_string()),
        _ => None,
    }
}

fn bool_param(m: &Value, key: &str) -> Option<bool> {
    match m.get(key) {
        Some(Value::Bool(b)) => Some(*b),
        Some(Value::String(s)) => match s.as_str() { "true" => Some(true), "false" => Some(false), _ => None },
        _ => None,
    }
}

fn fail(e: sdk::UpstreamErr, fallback: &str) -> Response {
    let mut body = json!({ "status": false, "message": if e.message.is_empty() { fallback.to_string() } else { e.message } });
    if e.is_auth {
        body["hint"] = json!("Access token tidak valid atau kedaluwarsa. Gunakan endpoint GoPay Refresh, atau login ulang bila refresh token juga sudah habis.");
    }
    (StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(body)).into_response()
}

async fn resolve_token(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Result<sdk::ResolvedToken, Response> {
    match sdk::resolve_token(query, &body.as_ref().map(|Json(v)| v.clone()).unwrap_or(json!({}))).await {
        Ok(t) => Ok(t),
        Err(msg) => Err((StatusCode::UNAUTHORIZED, Json(json!({"status": false, "message": msg}))).into_response()),
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let amount = str_param(&m, "amount");
    let qr = str_param(&m, "qr");
    if amount.is_none() || qr.is_none() {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'amount' dan 'qr' wajib diisi."}))).into_response();
    }
    let nominal: i64 = match amount.unwrap().parse() {
        Ok(n) if n > 0 => n,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'amount' harus angka positif."}))).into_response(),
    };
    let payload = match sdk::build_dynamic_qris_payload(&qr.unwrap(), nominal) {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": e}))).into_response(),
    };
    let created_at = sdk::now_iso();
    // Registry optional — daftarkan supaya bisa dilacak lewat GoPay Qris Status.
    let registry_key = sdk::register_qris(Some(nominal), &created_at, None).map(|_| created_at.clone());
    let cdn = bool_param(&m, "cdn").unwrap_or(false);
    let _ = cdn; // Node only used cdn for cloud upload of the rendered PNG; no QR image is rendered natively.
    Json(json!({
        "status": true,
        "message": "QRIS dinamis berhasil dibuat.",
        "result": {
            "amount": nominal,
            "qr_string": payload,
            "image": null,
            "created_at": created_at,
            "registry_key": registry_key,
            "image_url": null,
            "note": "Render QR PNG butuh canvas/QR image engine, belum didukung native. Gunakan qr_string."
        }
    })).into_response()
}

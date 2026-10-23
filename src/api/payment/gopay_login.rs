// GoPay Login — native conversion of api/payment/gopay-login.js
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
        _ => None,
    }
}

fn int_param(m: &Value, key: &str, default: i64) -> i64 {
    str_param(m, key).and_then(|s| s.parse().ok()).unwrap_or(default)
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
    let Some(phone) = str_param(&m, "phone") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'phone' wajib diisi."}))).into_response();
    };
    let mut digits: String = phone.trim_start_matches('+').chars().filter(|c: &char| !c.is_whitespace() && *c != '-').collect();
    if digits.starts_with("62") { digits = digits[2..].to_string(); }
    if !(8..=15).contains(&digits.len()) || !digits.chars().all(|c| c.is_ascii_digit()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Format nomor tidak valid. Contoh: 6281234567890 atau 81234567890."}))).into_response();
    }
    match sdk::request_otp(&digits).await {
        Err(e) => (StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(json!({"status": false, "message": e.message}))).into_response(),
        Ok(data) => {
            let otp_token = data.pointer("/data/otp_token").and_then(|v| v.as_str())
                .or_else(|| data.get("otp_token").and_then(|v| v.as_str())).map(|s| s.to_string());
            match otp_token {
                Some(t) => Json(json!({
                    "status": true,
                    "message": "Kode OTP berhasil dikirim. Simpan otp_token untuk verifikasi.",
                    "result": {
                        "otp_token": t,
                        "message": data.pointer("/data/message").cloned().unwrap_or(json!("Kode OTP berhasil dikirim"))
                    }
                })).into_response(),
                None => (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false,
                    "message": "OTP tidak terkirim. Periksa kembali nomor HP merchant.",
                    "error": data
                }))).into_response(),
            }
        }
    }
}

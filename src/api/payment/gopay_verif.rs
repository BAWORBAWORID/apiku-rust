// GoPay Verif — native conversion of api/payment/gopay-verif.js
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

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let (Some(otp), Some(otp_token)) = (str_param(&m, "otp"), str_param(&m, "otpToken")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'otp' dan 'otpToken' wajib diisi."}))).into_response();
    };
    let data = match sdk::verify_otp(&otp, &otp_token).await {
        Ok(d) => d,
        Err(e) => {
            let status = if e.status == 500 { StatusCode::INTERNAL_SERVER_ERROR } else { StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR) };
            return (status, Json(json!({"status": false, "message": e.message}))).into_response();
        }
    };
    let payload = data.get("data").cloned().unwrap_or_else(|| data.clone());
    let access_token = payload.get("access_token").and_then(|v| v.as_str()).map(|s| s.to_string());
    let Some(access_token) = access_token else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Verifikasi gagal. Pastikan OTP benar dan belum kedaluwarsa.",
            "error": data
        }))).into_response();
    };
    let refresh_token = payload.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.to_string());
    let save = bool_param(&m, "save").unwrap_or(false);
    let mut saved = false;
    if save {
        if let Some(rt) = &refresh_token {
            sdk::set_tokens(&access_token, rt);
            saved = true;
        }
    }
    Json(json!({
        "status": true,
        "message": if saved { "OTP terverifikasi dan token tersimpan di server." } else { "OTP terverifikasi. Simpan access_token & refresh_token dengan aman." },
        "result": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": payload.get("token_type"),
            "expires_in": payload.get("expires_in"),
            "saved": saved
        }
    })).into_response()
}

// GoPay Refresh — native conversion of api/payment/gopay-refresh.js
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
    let (stored_at, stored_rt) = sdk::get_tokens();
    let use_token = match str_param(&m, "refreshToken") {
        Some(rt) => rt,
        None => match stored_rt {
            Some(rt) => rt,
            None => return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'refreshToken' wajib diisi. Belum ada refresh token tersimpan di server."
            }))).into_response(),
        },
    };
    let data = match sdk::refresh_token(&use_token).await {
        Ok(d) => d,
        Err(e) => {
            let status = if e.status == 500 { StatusCode::UNAUTHORIZED } else { StatusCode::from_u16(e.status).unwrap_or(StatusCode::UNAUTHORIZED) };
            return (status, Json(json!({"status": false, "message": e.message}))).into_response();
        }
    };
    let payload = data.get("data").cloned().unwrap_or_else(|| data.clone());
    let access_token = payload.get("access_token").and_then(|v| v.as_str()).map(|s| s.to_string());
    let Some(access_token) = access_token else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Refresh gagal. Refresh token mungkin kedaluwarsa, lakukan login ulang.",
            "error": data
        }))).into_response();
    };
    let rotated = payload.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.to_string());
    let final_refresh = rotated.clone().unwrap_or_else(|| use_token.clone());
    let should_save = !matches!(m.get("save"), Some(Value::String(s)) if s == "false") && !matches!(m.get("save"), Some(Value::Bool(false)));
    let mut saved = false;
    if should_save {
        sdk::set_tokens(&access_token, &final_refresh);
        saved = true;
    }
    let rotated_flag = rotated.as_ref().map(|r| r != &use_token).unwrap_or(false);
    Json(json!({
        "status": true,
        "message": if saved { "Access token diperbarui dan disimpan. Auto-refresh aktif." } else { "Access token berhasil diperbarui." },
        "result": {
            "access_token": access_token,
            "refresh_token": final_refresh,
            "refresh_token_rotated": rotated_flag,
            "token_type": payload.get("token_type"),
            "expires_in": payload.get("expires_in"),
            "saved": saved
        }
    })).into_response()
}

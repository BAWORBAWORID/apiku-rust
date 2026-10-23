// GoPay Payouts — native conversion of api/payment/gopay-payouts.js
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
    let (page, per) = (int_param(&m, "page", 1), int_param(&m, "per", 50));
    let r = match resolve_token(&query, &body).await {
        Ok(r) => r,
        Err(resp) => return resp,
    };
    match sdk::get_payouts(&r.token, page, per).await {
        Err(e) => fail(e, "Gagal mengambil payout"),
        Ok(data) => {
            let payouts = data.pointer("/data/payouts").cloned()
                .or_else(|| data.get("payouts").cloned())
                .or_else(|| data.pointer("/data/hits").cloned())
                .or_else(|| data.get("data").cloned())
                .unwrap_or_else(|| data.clone());
            Json(json!({
                "status": true,
                "message": "Daftar payout berhasil diambil.",
                "result": { "page": page, "per_page": per, "payouts": payouts }
            })).into_response()
        }
    }
}

// GoPay QRIS Official Status — native conversion of api/payment/gopay-qris-official-status.js
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
    let Some(transaction_id) = str_param(&m, "transactionId") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'transactionId' wajib diisi."}))).into_response();
    };
    let (client_id, client_secret, outlet_env) = sdk::partner_config();
    if client_id.is_none() || client_secret.is_none() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status": false, "message": sdk::partner_config_error(&(client_id, client_secret, outlet_env.clone())).unwrap_or_default()}))).into_response();
    }
    let Some(outlet) = str_param(&m, "outletId").or(outlet_env) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'outletId' wajib diisi atau set env GOBIZ_OUTLET_ID."}))).into_response();
    };
    let partner_token = match sdk::get_partner_token(&client_id.unwrap(), &client_secret.unwrap()).await {
        Ok(t) => t,
        Err(e) => return fail(e, "Gagal mengambil status transaksi QRIS official"),
    };
    match sdk::get_qris_transaction(&outlet, &transaction_id, &partner_token).await {
        Err(e) => fail(e, "Gagal mengambil status transaksi QRIS official"),
        Ok(data) => {
            let tx = data.get("data").cloned().unwrap_or_else(|| data.clone());
            let get = |k: &str| tx.get(k).cloned().unwrap_or(Value::Null);
            Json(json!({
                "status": true,
                "message": "Status transaksi QRIS official berhasil diambil.",
                "result": {
                    "transaction_id": tx.get("transaction_id").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or(transaction_id),
                    "transaction_status": get("transaction_status").is_null().then(|| get("status")).unwrap_or_else(|| get("transaction_status")),
                    "order_id": get("order_id"),
                    "gross_amount": get("gross_amount"),
                    "currency": get("currency"),
                    "qr_string": get("qr_string"),
                    "expires_at": get("expires_at")
                }
            })).into_response()
        }
    }
}

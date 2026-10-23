// GoPay QRIS Status — native conversion of api/payment/gopay-qris-status.js
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
    let r = match resolve_token(&query, &body).await {
        Ok(r) => r,
        Err(resp) => return resp,
    };
    let m = merged(&query, &body);
    let created_at = str_param(&m, "created_at");
    let amount = str_param(&m, "amount");
    let Some(merchant_id) = sdk::resolve_merchant_id(&r.token).await else {
        return sdk::no_merchant_id();
    };
    let journal = match sdk::get_journals(&r.token, &merchant_id, None, 30).await {
        Err(e) => return fail(e, "Gagal mengecek status QRIS"),
        Ok(j) => j,
    };
    let mut entries: Vec<Value> = sdk::map_qris_entries(&journal);
    if let Some(ca) = &created_at {
        let prefix: String = ca.chars().take(13).collect();
        entries.retain(|e| e.get("time").and_then(|t| t.as_str()).map(|t| t.starts_with(&prefix)).unwrap_or(false));
    }

    let matched: Option<Value> = if let Some(amt) = &amount {
        match amt.parse::<i64>() {
            Ok(target) => entries.iter().find(|e| e.get("amount").and_then(|a| a.as_i64()) == Some(target * 100)).cloned(),
            Err(_) => None,
        }
    } else {
        entries.first().cloned()
    };

    if let Some(ma) = matched {
        let registry_entry = created_at.as_ref().and_then(|ca| sdk::get_qris(ca));
        if created_at.is_some() && registry_entry.is_some() {
            sdk::remove_qris(created_at.as_ref().unwrap());
        }
        let amt = ma.get("amount").and_then(|a| a.as_i64()).unwrap_or(0);
        return Json(json!({
            "status": true,
            "message": "Pembayaran QRIS ditemukan.",
            "result": {
                "paid": true,
                "transaction_id": ma.get("id"),
                "reference_id": ma.get("reference_id"),
                "transaction_status": ma.get("status"),
                "amount": amt / 100,
                "transaction_time": ma.get("time"),
                "merchant_name": ma.get("merchant_name"),
                "merchant_city": ma.get("merchant_city"),
                "issuer": ma.get("issuer"),
                "acquirer": ma.get("acquirer"),
                "terminal_label": ma.get("terminal_label"),
                "image_url": registry_entry.as_ref().and_then(|re| re.get("image_url")).cloned().unwrap_or(Value::Null)
            }
        })).into_response();
    }

    // Belum lunas: bersihkan registry agar tidak menumpuk.
    if let Some(ca) = &created_at {
        sdk::remove_qris(ca);
    }

    Json(json!({
        "status": true,
        "message": if created_at.is_some() { "Pembayaran belum ditemukan (belum lunas atau kedaluwarsa)." } else { "Belum ada transaksi QRIS pada periode ini." },
        "result": {
            "paid": false,
            "created_at": created_at,
            "amount": amount.and_then(|a| a.parse::<i64>().ok()),
            "checked_count": entries.len(),
            "merchant_id": merchant_id
        }
    })).into_response()
}

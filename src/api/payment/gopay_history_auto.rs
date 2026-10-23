// GoPay History Auto — native conversion of api/payment/gopay-history-auto.js
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
    let days = int_param(&m, "days", 7);
    if !sdk::has_tokens() {
        return (StatusCode::UNAUTHORIZED, Json(json!({
            "status": false,
            "message": "Belum ada token tersimpan di server. Jalankan GoPay Verif dengan save=true atau GoPay Token Save terlebih dahulu."
        }))).into_response();
    }
    let (access_token, refreshed) = match sdk::ensure_fresh_token().await {
        Ok((tok, refreshed)) => (tok, refreshed),
        Err(reason) => {
            let (at, _) = sdk::get_tokens();
            match at {
                Some(at) => (at, false),
                None => return (StatusCode::UNAUTHORIZED, Json(json!({
                    "status": false,
                    "message": "Token tersimpan tidak dapat diperbarui. Jalankan login ulang.",
                    "reason": reason
                }))).into_response(),
            }
        }
    };
    let Some(merchant_id) = sdk::resolve_merchant_id(&access_token).await else {
        return sdk::no_merchant_id();
    };
    match sdk::get_journals(&access_token, &merchant_id, None, days).await {
        Err(e) => fail(e, "Gagal mengambil riwayat transaksi"),
        Ok(journal) => {
            let entries = sdk::map_qris_entries(&journal);
            let now = chrono::Utc::now();
            Json(json!({
                "status": true,
                "message": format!("Berhasil mengambil {} transaksi QRIS dalam {} hari terakhir.", entries.len(), days),
                "result": {
                    "merchant_id": merchant_id,
                    "total": entries.len(),
                    "days": days,
                    "auto_refreshed": refreshed,
                    "from": (now - chrono::Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "to": now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "journals": entries
                }
            })).into_response()
        }
    }
}

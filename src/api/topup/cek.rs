// CEK TOP UP — native conversion of api/topup/cek.js
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use super::tokogame;

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

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let (Some(order_id), Some(order_code)) = (str_param(&m, "orderId"), str_param(&m, "orderCode")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter \"orderId\" dan \"orderCode\" wajib diisi"}))).into_response();
    };
    let url = format!("{}/orders?id={}&code={}", tokogame::TOKOGAKE_BASE, order_id, order_code);
    let mut req = tokogame::client().get(&url);
    for (k, v) in tokogame::make_headers() { req = req.header(&k, &v); }
    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string()}))).into_response(),
    };
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = data.get("message").and_then(|v| v.as_str()).unwrap_or("Gagal cek status").to_string();
        return (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(json!({"status": false, "message": msg}))).into_response();
    }
    let d = data.get("data").cloned().unwrap_or(json!({}));
    let ps = d.get("paymentStatus").and_then(|v| v.as_str()).unwrap_or("UNKNOWN");
    let prs = d.get("processingStatus").and_then(|v| v.as_str()).unwrap_or("UNKNOWN");
    Json(json!({
        "status": true,
        "result": {
            "orderId": order_id,
            "orderCode": order_code,
            "paymentStatus": ps,
            "processingStatus": prs
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()
}

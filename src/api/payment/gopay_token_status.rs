// GoPay Token Status — native conversion of api/payment/gopay-token-status.js
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
    Query(_query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    let s = sdk::token_status();
    let has = s.get("hasTokens").and_then(|v| v.as_bool()).unwrap_or(false);
    Json(json!({
        "status": true,
        "message": if has { "Token tersimpan dan siap dipakai." } else { "Belum ada token tersimpan. Jalankan GoPay Verif (save=true) atau GoPay Token Save." },
        "result": s
    })).into_response()
}

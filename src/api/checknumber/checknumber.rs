// Check Number (XL & Tri) — native conversion of api/checknumber/checknumber.js
// Router with automatic operator detection; delegates to tricheck/xlcheck logic.
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

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

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .build().unwrap_or_default()
}

use super::{tricheck, xlcheck};

fn detect_operator(clean: &str) -> &'static str {
    let num = if let Some(stripped) = clean.strip_prefix("628") {
        format!("08{}", stripped)
    } else if let Some(stripped) = clean.strip_prefix("8") {
        format!("0{}", stripped)
    } else {
        clean.to_string()
    };
    let b = num.as_bytes();
    if num.len() >= 4 && b[0] == b'0' && b[1] == b'8' && b[2] == b'9' && (b'5'..=b'9').contains(&b[3]) {
        return "TRI";
    }
    let is_xl = num.len() >= 4 && (
        (b[0] == b'0' && b[1] == b'8' && b[2] == b'1' && (b'7'..=b'9').contains(&b[3]))
        || num.starts_with("0859")
        || (num.starts_with("087") && matches!(b[3], b'7' | b'8'))
        || (num.starts_with("083") && matches!(b[3], b'1'..=b'3' | b'8'))
    );
    if is_xl { "XL" } else { "UNKNOWN" }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(number) = str_param(&m, "number") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'number' wajib diisi"}))).into_response();
    };
    let clean: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    match detect_operator(&clean) {
        "TRI" => tricheck::handler(Query(query), body).await,
        "XL" => xlcheck::handler(Query(query), body).await,
        _ => (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Operator tidak didukung. Nomor harus merupakan kartu XL/Axis (0817–0819, 0859, 0877–0878, 0831–0838) atau Tri (0895–0899)."
        }))).into_response(),
    }
}

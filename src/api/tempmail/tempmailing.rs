// tempmailing — native conversion of api/tempmail/tempmailing.js
// Base: https://tempmail.ing — API: https://api.tempmail.ing/api
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const API_URL: &str = "https://api.tempmail.ing/api";

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("accept", "*/*".parse().unwrap());
    h.insert("accept-language", "en-US,en;q=0.9".parse().unwrap());
    h.insert("content-type", "application/json".parse().unwrap());
    h.insert("origin", "https://tempmail.ing".parse().unwrap());
    h.insert("referer", "https://tempmail.ing/".parse().unwrap());
    h.insert(
        "user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
            .parse()
            .unwrap(),
    );
    h
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

async fn generate_email() -> Result<String, String> {
    let res = client()?
        .post(format!("{API_URL}/generate"))
        .headers(headers())
        .body("{}")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data
        .get("success")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        if let Some(addr) = data.pointer("/email/address").and_then(|a| a.as_str()) {
            return Ok(addr.to_string());
        }
    }
    Err(data
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("Gagal generate email")
        .to_string())
}

async fn check_inbox(email: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!("{API_URL}/emails/{}", urlencoding::encode(email)))
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data
        .get("success")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        Ok(data.get("emails").cloned().unwrap_or(json!([])))
    } else {
        Err(data
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Gagal mengecek inbox")
            .to_string())
    }
}

fn bad(msg: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "message": msg })),
    )
        .into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| -> Option<String> {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()))
        })
    };
    let action = match get("action") {
        Some(a) if a == "create" || a == "inbox" => a,
        _ => return bad("Parameter 'action' harus 'create' atau 'inbox'"),
    };

    if action == "create" {
        return match generate_email().await {
            Ok(email) => Json(json!({
                "status": true,
                "action": "create",
                "result": { "email": email }
            }))
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    // action == inbox
    let email = match get("email").filter(|e| e.contains('@')) {
        Some(e) => e,
        None => return bad("Parameter 'email' wajib diisi (valid) untuk action=inbox"),
    };
    let email = email.trim().to_string();
    match check_inbox(&email).await {
        Ok(inbox) => Json(json!({
            "status": true,
            "action": "inbox",
            "email": email,
            "result": { "inbox": inbox }
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "status": false, "message": e })),
        )
            .into_response(),
    }
}

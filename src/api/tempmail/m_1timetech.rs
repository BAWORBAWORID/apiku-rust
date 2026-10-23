// 1TimeTech TempMail — native conversion of api/tempmail/1timetech.js
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://mail-server.1timetech.com/api/email";
const X_APP_KEY: &str = "f07bed4503msh719c2010df3389fp1d6048jsn411a41a84a3c";

fn decode(encoded: &str) -> Result<Value, String> {
    let s = encoded.strip_prefix('=').unwrap_or(encoded);
    let rev: String = s.chars().rev().collect();
    let raw = base64::engine::general_purpose::STANDARD
        .decode(rev.as_bytes())
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw).map_err(|e| e.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", "okhttp/4.9.2".parse().unwrap());
    h.insert("Connection", "Keep-Alive".parse().unwrap());
    h.insert(
        "Accept",
        "application/json, text/plain, */*".parse().unwrap(),
    );
    h.insert("x-app-key", X_APP_KEY.parse().unwrap());
    h
}

async fn generate_email() -> Result<Value, String> {
    let c = client()?;
    let res = c
        .post(BASE_URL)
        .headers(headers())
        .json(&json!({ "data": "" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to generate email: HTTP {}", res.status()));
    }
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    let data = j.get("data").and_then(|d| d.as_str()).unwrap_or("");
    decode(data)
}

async fn check_inbox(email: &str) -> Result<Value, String> {
    let c = client()?;
    let url = format!(
        "{}/{}/messages?params==03e&_={}",
        BASE_URL,
        urlencoding::encode(email),
        chrono::Utc::now().timestamp_millis()
    );
    let res = c
        .get(&url)
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to fetch inbox: HTTP {}", res.status()));
    }
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    let data = j.get("data").and_then(|d| d.as_str()).unwrap_or("");
    decode(data)
}

fn bad(msg: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"status": false, "message": msg})),
    )
        .into_response()
}

fn internal(msg: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"status": false, "message": msg})),
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
        Some(a) if !a.trim().is_empty() => a,
        _ => return bad("Parameter 'action' wajib diisi (create / inbox)"),
    };

    if action == "create" {
        match generate_email().await {
            Ok(g) => Json(json!({
                "status": true,
                "action": "create",
                "result": {
                    "email": g.get("email").cloned().unwrap_or(Value::Null),
                    "mailId": g.get("id").cloned().unwrap_or(Value::Null),
                }
            }))
            .into_response(),
            Err(e) => internal(&format!("Gagal membuat email: {e}")),
        }
    } else if action == "inbox" {
        let email = match get("email") {
            Some(e) if !e.trim().is_empty() => e,
            _ => return bad("Parameter 'email' wajib diisi untuk action=inbox"),
        };
        match check_inbox(email.trim()).await {
            Ok(messages) => {
                let empty = Vec::new();
                let list = messages.as_array().unwrap_or(&empty);
                let mapped: Vec<Value> = list
                    .iter()
                    .map(|m| {
                        json!({
                            "id": m.get("id").or_else(|| m.get("uid")).cloned().unwrap_or(Value::Null),
                            "from": m.get("from").or_else(|| m.get("sender")).cloned().unwrap_or(Value::Null),
                            "subject": m.get("subject").cloned().unwrap_or(Value::Null),
                            "date": m.get("date").or_else(|| m.get("created_at")).or_else(|| m.get("time")).cloned().unwrap_or(Value::Null),
                            "body": m.get("body").or_else(|| m.get("text")).or_else(|| m.get("html")).cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect();
                Json(json!({
                    "status": true,
                    "action": "inbox",
                    "result": {
                        "email": email.trim(),
                        "total": mapped.len(),
                        "messages": mapped,
                    }
                }))
                .into_response()
            }
            Err(e) => internal(&format!("Gagal mengambil pesan: {e}")),
        }
    } else {
        bad("action tidak valid. Gunakan: create / inbox")
    }
}

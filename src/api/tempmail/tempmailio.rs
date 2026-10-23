// tempmailio — native conversion of api/tempmail/tempmailio.js
// Temp-Mail.io v3 API. Session (created email) persisted via std::fs to data/session/.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use reqwest::header;

const API: &str = "https://api.internal.temp-mail.io/api/v3/email";

fn session_path(name: &str) -> PathBuf {
    let dir = PathBuf::from("data/session");
    let _ = fs::create_dir_all(&dir);
    dir.join(name)
}

fn load_session(name: &str) -> Option<Value> {
    let raw = fs::read_to_string(session_path(name)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_session(name: &str, data: &Value) {
    if let Ok(s) = serde_json::to_string_pretty(data) {
        let _ = fs::write(session_path(name), s);
    }
}

fn random_str(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    (0..len)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            CHARS[(seed as usize) % CHARS.len()] as char
        })
        .collect()
}

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("Content-Type", "application/json".parse().unwrap());
    h.insert("Application-Name", "web".parse().unwrap());
    h.insert("Application-Version", "4.0.0".parse().unwrap());
    h.insert("X-CORS-Header", random_str(15).parse().unwrap());
    h.insert("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36".parse().unwrap());
    h.insert("Referer", "https://temp-mail.io/".parse().unwrap());
    h
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

async fn create_email() -> Result<String, String> {
    let res = client()?
        .post(format!("{API}/new"))
        .headers(headers())
        .json(&json!({ "min_name_length": 10, "max_name_length": 12 }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(j.get("email")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string())
}

async fn get_messages(email: &str) -> Result<Vec<Value>, String> {
    let res = client()?
        .get(format!("{API}/{email}/messages"))
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(j.as_array().cloned().unwrap_or_default())
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
        let email = match create_email().await {
            Ok(e) => e,
            Err(e) => return internal(&format!("Gagal membuat email: {e}")),
        };
        let session = json!({ "email": email, "createdAt": chrono::Utc::now().to_rfc3339() });
        if let Some(sid) = get("sessionId").filter(|s| !s.trim().is_empty()) {
            save_session(&format!("tmv8_{sid}.json"), &session);
        }
        return Json(json!({
            "status": true,
            "action": "create",
            "result": { "email": email, "sessionId": get("sessionId") }
        }))
        .into_response();
    }

    if action == "inbox" {
        let sid = match get("sessionId").filter(|s| !s.trim().is_empty()) {
            Some(s) => s,
            None => return bad("Parameter 'sessionId' wajib diisi untuk action=inbox"),
        };
        let session = match load_session(&format!("tmv8_{sid}.json")) {
            Some(s) if s.get("email").and_then(|e| e.as_str()).is_some() => s,
            _ => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({"status": false, "message": "Session tidak ditemukan. Buat email baru dengan action=create"})),
                )
                    .into_response()
            }
        };
        let email = session["email"].as_str().unwrap().to_string();
        let messages = match get_messages(&email).await {
            Ok(m) => m,
            Err(e) => return internal(&format!("Gagal mengambil pesan: {e}")),
        };
        let mapped: Vec<Value> = messages
            .iter()
            .map(|m| {
                json!({
                    "id": m.get("id").cloned().unwrap_or(Value::Null),
                    "from": m.get("from").cloned().unwrap_or(Value::Null),
                    "subject": m.get("subject").cloned().unwrap_or(Value::Null),
                    "date": m.get("created_at").cloned().unwrap_or(Value::Null),
                    "body": m.get("body_text").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        return Json(json!({
            "status": true,
            "action": "inbox",
            "result": { "email": email, "total": mapped.len(), "messages": mapped }
        }))
        .into_response();
    }

    bad("action tidak valid. Gunakan: create / inbox")
}

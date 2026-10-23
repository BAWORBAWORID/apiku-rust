// temporarymail — native conversion of api/tempmail/temporarymail.js
// temporarymail.com API. Session state (address/secretKey) persisted to data/session/.
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

const BASE_URL: &str = "https://temporarymail.com/api/";
const MAX_AGE_MS: u64 = 60 * 60 * 1000;

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

fn remove_session(name: &str) {
    let _ = fs::remove_file(session_path(name));
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", "Mozilla/5.0 (Linux; Android 16; Infinix X6837 Build/BP2A.250605.031.A2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.137 Mobile Safari/537.36".parse().unwrap());
    h.insert("Accept", "*/*".parse().unwrap());
    h.insert("x-requested-with", "XMLHttpRequest".parse().unwrap());
    h.insert("referer", "https://temporarymail.com/".parse().unwrap());
    h.insert(
        "accept-language",
        "en-ID,en;q=0.9,id-ID;q=0.8,id;q=0.7,en-US;q=0.6"
            .parse()
            .unwrap(),
    );
    h
}

fn format_time_remaining(ms: i64) -> String {
    if ms < 0 {
        return "Expired".to_string();
    }
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    if minutes > 0 {
        return format!("{} menit {} detik", minutes, seconds % 60);
    }
    format!("{} detik", seconds)
}

async fn create_mail(session_id: &str) -> Result<Value, String> {
    let url =
        format!("{BASE_URL}?action=requestEmailAccess&key=&value=random&r=https://www.google.com/");
    let res = client()?
        .get(&url)
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP Error: {}", res.status()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let address = data
        .get("address")
        .and_then(|a| a.as_str())
        .ok_or("Gagal mendapatkan email dari temporarymail.com")?
        .to_string();
    let secret_key = data
        .get("secretKey")
        .and_then(|a| a.as_str())
        .ok_or("Gagal mendapatkan email dari temporarymail.com")?
        .to_string();

    let created = now_ms();
    let expires_at = created + MAX_AGE_MS;
    save_session(
        &format!("temporarymail_{session_id}.json"),
        &json!({ "address": address, "secretKey": secret_key, "createdAt": created, "expiresAt": expires_at }),
    );

    Ok(json!({
        "email": address,
        "secretKey": secret_key,
        "createdAt": created,
        "expiresAt": expires_at,
        "timeRemaining": MAX_AGE_MS,
        "timeRemainingHuman": format_time_remaining(MAX_AGE_MS as i64),
        "note": "Email akan otomatis expired setelah 60 menit",
    }))
}

async fn check_mail_inbox(session_id: &str) -> Result<Value, String> {
    let s = load_session(&format!("temporarymail_{session_id}.json"))
        .ok_or("Session tidak ditemukan")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        remove_session(&format!("temporarymail_{session_id}.json"));
        return Err("Email sementara telah kedaluwarsa (maksimal 60 menit)".to_string());
    }
    let address = s
        .get("address")
        .and_then(|a| a.as_str())
        .unwrap_or("")
        .to_string();
    let secret_key = s
        .get("secretKey")
        .and_then(|a| a.as_str())
        .unwrap_or("")
        .to_string();
    let created = s.get("createdAt").cloned().unwrap_or(Value::Null);

    let url = format!("{BASE_URL}?action=checkInbox&value={secret_key}");
    let res = client()?
        .get(&url)
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP Error: {}", res.status()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let empty = Vec::new();
    let list = data.as_array().unwrap_or(&empty);
    let formatted: Vec<Value> = list
        .iter()
        .map(|msg| {
            let date = msg
                .get("date")
                .and_then(|d| d.as_i64())
                .and_then(|d| chrono::DateTime::from_timestamp(d, 0))
                .map(|d| json!(d.to_rfc3339()))
                .unwrap_or(Value::Null);
            json!({
                "id": msg.get("id").cloned().unwrap_or(Value::Null),
                "from": msg.get("from").cloned().unwrap_or(Value::Null),
                "name": msg.get("name").cloned().unwrap_or(Value::Null),
                "subject": msg.get("subject").cloned().unwrap_or(Value::Null),
                "date": date,
                "snippet": msg.get("snippet").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();

    let remaining = expires_at as i64 - now_ms() as i64;
    Ok(json!({
        "email": address,
        "messages": formatted,
        "inboxCount": list.len(),
        "createdAt": created,
        "expiresAt": expires_at,
        "timeRemaining": remaining,
        "timeRemainingHuman": format_time_remaining(remaining),
    }))
}

async fn get_email_detail(session_id: &str, email_id: &str) -> Result<Value, String> {
    let s = load_session(&format!("temporarymail_{session_id}.json"))
        .ok_or("Session tidak ditemukan")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        remove_session(&format!("temporarymail_{session_id}.json"));
        return Err("Email sementara telah kedaluwarsa (maksimal 60 menit)".to_string());
    }
    if email_id.is_empty() {
        return Err("Parameter 'emailId' wajib diisi".to_string());
    }
    let url = format!("{BASE_URL}?action=getEmail&value={email_id}");
    let res = client()?
        .post(&url)
        .headers(headers())
                    .header("origin", "https://temporarymail.com")
                    .header("content-length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP Error: {}", res.status()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let detail = data.get(email_id).ok_or("Email tidak ditemukan")?;
    let date = detail
        .get("date")
        .and_then(|d| d.as_i64())
        .and_then(|d| chrono::DateTime::from_timestamp(d, 0))
        .map(|d| json!(d.to_rfc3339()))
        .unwrap_or(Value::Null);
    Ok(json!({
        "id": detail.get("id").cloned().unwrap_or(Value::Null),
        "from": detail.get("from").cloned().unwrap_or(Value::Null),
        "name": detail.get("name").cloned().unwrap_or(Value::Null),
        "subject": detail.get("subject").cloned().unwrap_or(Value::Null),
        "date": date,
        "body": detail.get("body").cloned().unwrap_or(Value::Null),
        "html": detail.get("html").cloned().unwrap_or(Value::Null),
        "attachments": detail.get("attachments").cloned().unwrap_or(json!([])),
    }))
}

fn bad(code: &str, msg: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "message": msg, "code": code })),
    )
        .into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
    let get = |k: &str| -> Option<String> {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()))
        })
    };
    let session_id = match get("sessionId")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(s) => s,
        None => return bad("MISSING_SESSION_ID", "Parameter 'sessionId' wajib diisi"),
    };
    let action = match get("action") {
        Some(a) if ["create", "inbox", "detail"].contains(&a.as_str()) => a,
        _ => {
            return bad(
                "INVALID_ACTION",
                "Parameter 'action' harus 'create', 'inbox', atau 'detail'",
            )
        }
    };
    let email_id = get("emailId").unwrap_or_default();

    let result = match action.as_str() {
        "create" => create_mail(&session_id).await,
        "inbox" => check_mail_inbox(&session_id).await,
        _ => get_email_detail(&session_id, email_id.trim()).await,
    };

    match result {
        Ok(r) => Json(json!({
            "status": true,
            "action": action,
            "sessionId": session_id,
            "result": r,
            "timestamp": now_ms(),
            "processingTimeMs": start.elapsed().as_millis(),
        }))
        .into_response(),
        Err(e) => {
            if e.contains("tidak ditemukan") && e.contains("Session") {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({
                        "status": false,
                        "message": "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
                        "code": "SESSION_NOT_FOUND",
                        "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                    })),
                )
                    .into_response();
            }
            if e.contains("kedaluwarsa") {
                return (
                    StatusCode::GONE,
                    Json(json!({
                        "status": false,
                        "message": "Email sementara telah kedaluwarsa (maksimal 60 menit). Buat email baru dengan action=create",
                        "code": "EMAIL_EXPIRED",
                        "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                    })),
                )
                    .into_response();
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "status": false,
                    "message": e,
                    "code": "TEMPMAIL_V4_ERROR",
                    "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                })),
            )
                .into_response()
        }
    }
}

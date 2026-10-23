// guerrilla — native conversion of api/tempmail/guerrilla.js
// GuerrillaMail AJAX API. Session state (sid_token) persisted to data/session/.
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

const BASE_URL: &str = "https://api.guerrillamail.com/ajax.php";
const MAX_AGE_MS: u64 = 60 * 60 * 1000;
const MAX_MESSAGES: usize = 50;

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
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
        .build()
        .map_err(|e| e.to_string())
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

async fn api_get(params: &[(&str, &str)]) -> Result<Value, String> {
    client()?
        .get(BASE_URL)
                    .header("Accept", "application/json")
        .query(params)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

async fn get_inbox(sid_token: &str) -> Vec<Value> {
    api_get(&[
        ("f", "get_email_list"),
        ("sid_token", sid_token),
        ("offset", "0"),
    ])
    .await
    .ok()
    .and_then(|d| d.get("list").and_then(|l| l.as_array()).cloned())
    .unwrap_or_default()
}

async fn get_message(sid_token: &str, email_id: &str) -> Option<Value> {
    api_get(&[
        ("f", "fetch_email"),
        ("sid_token", sid_token),
        ("email_id", email_id),
    ])
    .await
    .ok()
}

async fn create_mail(session_id: &str) -> Result<Value, String> {
    let account = api_get(&[
        ("f", "get_email_address"),
        ("ip", "127.0.0.1"),
        ("agent", "Chrome120"),
    ])
    .await?;
    let email = account
        .get("email_addr")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();
    let sid_token = account
        .get("sid_token")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();

    let inbox = get_inbox(&sid_token).await;
    let created = now_ms();
    let expires_at = created + MAX_AGE_MS;

    save_session(
        &format!("guerrilla_{session_id}.json"),
        &json!({
            "email": email,
            "sidToken": sid_token,
            "seenMessages": [],
            "createdAt": created,
            "expiresAt": expires_at,
        }),
    );

    Ok(json!({
        "email": email,
        "inbox": inbox,
        "inboxCount": inbox.len(),
        "createdAt": created,
        "expiresAt": expires_at,
        "timeRemaining": MAX_AGE_MS,
        "timeRemainingHuman": format_time_remaining(MAX_AGE_MS as i64),
        "note": "Email akan otomatis expired setelah 60 menit",
    }))
}

async fn check_mail_inbox(session_id: &str, message_id: Option<&str>) -> Result<Value, String> {
    let s =
        load_session(&format!("guerrilla_{session_id}.json")).ok_or("Session tidak ditemukan")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        remove_session(&format!("guerrilla_{session_id}.json"));
        return Err("Email sementara telah kedaluwarsa (maksimal 60 menit)".to_string());
    }
    let sid_token = s
        .get("sidToken")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let email = s
        .get("email")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();
    let created = s.get("createdAt").and_then(|c| c.as_u64()).unwrap_or(0);

    let messages = get_inbox(&sid_token).await;

    let message_detail = match message_id.filter(|m| !m.is_empty()) {
        Some(mid) => get_message(&sid_token, mid).await.map(|d| {
            json!({
                "id": d.get("mail_id").cloned().unwrap_or(Value::Null),
                "from": d.get("mail_from").cloned().unwrap_or(Value::Null),
                "subject": d.get("mail_subject").cloned().unwrap_or(Value::Null),
                "time": d.get("mail_timestamp").cloned().unwrap_or(Value::Null),
                "content": d.get("mail_body").cloned().unwrap_or(json!("")),
                "textBody": d.get("mail_text_only").cloned().unwrap_or(json!("")),
                "attachments": d.get("attachments").cloned().unwrap_or(json!([])),
            })
        }),
        None => None,
    };

    let seen: Vec<Value> = s
        .get("seenMessages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let formatted: Vec<Value> = messages
        .iter()
        .map(|msg| {
            let id = msg.get("mail_id").cloned().unwrap_or(Value::Null);
            let is_new = !seen.contains(&id);
            json!({
                "id": id,
                "from": msg.get("mail_from").cloned().unwrap_or(Value::Null),
                "subject": msg.get("mail_subject").cloned().unwrap_or(Value::Null),
                "time": msg.get("mail_timestamp").cloned().unwrap_or(Value::Null),
                "isNew": is_new,
            })
        })
        .collect();

    // update seen messages
    let mut new_seen = seen;
    for msg in &messages {
        let id = msg.get("mail_id").cloned();
        if let Some(id) = id {
            if !new_seen.contains(&id) {
                new_seen.push(id);
            }
        }
    }
    save_session(
        &format!("guerrilla_{session_id}.json"),
        &json!({
            "email": email,
            "sidToken": sid_token,
            "seenMessages": new_seen,
            "createdAt": created,
            "expiresAt": expires_at,
        }),
    );

    let remaining = expires_at as i64 - now_ms() as i64;
    Ok(json!({
        "email": email,
        "messages": formatted,
        "messageDetail": message_detail.unwrap_or(Value::Null),
        "inboxCount": messages.len(),
        "createdAt": created,
        "expiresAt": expires_at,
        "timeRemaining": remaining,
        "timeRemainingHuman": format_time_remaining(remaining),
    }))
}

async fn monitor_mail(session_id: &str) -> Result<Value, String> {
    let s =
        load_session(&format!("guerrilla_{session_id}.json")).ok_or("Session tidak ditemukan")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        remove_session(&format!("guerrilla_{session_id}.json"));
        return Err("Email sementara telah kedaluwarsa (maksimal 60 menit)".to_string());
    }
    let sid_token = s
        .get("sidToken")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let email = s
        .get("email")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();
    let created = s.get("createdAt").and_then(|c| c.as_u64()).unwrap_or(0);
    let seen: Vec<Value> = s
        .get("seenMessages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let messages = get_inbox(&sid_token).await;
    let mut new_messages: Vec<Value> = Vec::new();
    let mut new_seen = seen.clone();
    for msg in &messages {
        let id = msg.get("mail_id").cloned();
        let id_str = id
            .as_ref()
            .map(|i| i.to_string().trim_matches('"').to_string())
            .unwrap_or_default();
        if !id_str.is_empty() && !seen.contains(&id.unwrap_or(Value::Null)) {
            new_seen.push(json!(id_str));
            let detail = get_message(&sid_token, &id_str).await;
            new_messages.push(json!({
                "id": msg.get("mail_id").cloned().unwrap_or(Value::Null),
                "from": msg.get("mail_from").cloned().unwrap_or(Value::Null),
                "subject": msg.get("mail_subject").cloned().unwrap_or(Value::Null),
                "time": msg.get("mail_timestamp").cloned().unwrap_or(Value::Null),
                "content": detail.as_ref().and_then(|d| d.get("mail_body")).cloned().unwrap_or(json!("")),
                "textBody": detail.as_ref().and_then(|d| d.get("mail_text_only")).cloned().unwrap_or(json!("")),
                "attachments": detail.as_ref().and_then(|d| d.get("attachments")).cloned().unwrap_or(json!([])),
            }));
        }
    }
    save_session(
        &format!("guerrilla_{session_id}.json"),
        &json!({
            "email": email,
            "sidToken": sid_token,
            "seenMessages": new_seen,
            "createdAt": created,
            "expiresAt": expires_at,
        }),
    );

    let remaining = expires_at as i64 - now_ms() as i64;
    Ok(json!({
        "email": email,
        "newMessages": new_messages,
        "inboxCount": messages.len(),
        "createdAt": created,
        "expiresAt": expires_at,
        "timeRemaining": remaining,
        "timeRemainingHuman": format_time_remaining(remaining),
    }))
}

async fn delete_mail(session_id: &str) -> Result<Value, String> {
    let s =
        load_session(&format!("guerrilla_{session_id}.json")).ok_or("Session tidak ditemukan")?;
    let email = s
        .get("email")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();
    let sid_token = s
        .get("sidToken")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let created = s.get("createdAt").cloned().unwrap_or(Value::Null);
    let expires_at = s.get("expiresAt").cloned().unwrap_or(Value::Null);

    let _ = api_get(&[("f", "forget_me"), ("sid_token", &sid_token)]).await; // best effort
    remove_session(&format!("guerrilla_{session_id}.json"));

    Ok(json!({
        "success": true,
        "message": "Session email berhasil dihapus",
        "email": email,
        "deletedAt": now_ms(),
        "note": "Data email dihapus dari server GuerrillaMail",
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
        Some(a) if ["create", "inbox", "monitor", "delete"].contains(&a.as_str()) => a,
        _ => {
            return bad(
                "INVALID_ACTION",
                "Parameter 'action' harus 'create', 'inbox', 'monitor', atau 'delete'",
            )
        }
    };
    let message_id = get("messageId");

    let result = match action.as_str() {
        "create" => create_mail(&session_id).await,
        "inbox" => check_mail_inbox(&session_id, message_id.as_deref()).await,
        "monitor" => monitor_mail(&session_id).await,
        _ => delete_mail(&session_id).await,
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
            if e.contains("tidak ditemukan") {
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
                    "code": "GUERRILLA_ERROR",
                    "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                })),
            )
                .into_response()
        }
    }
}

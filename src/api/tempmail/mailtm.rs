// mailtm — native conversion of api/tempmail/mailtm.js
// mail.tm account service. Session state (email/token) persisted to data/session/.
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

const BASE_URL: &str = "https://api.mail.tm";
const MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;

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

fn rand_lower(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut seed = now_ms();
    (0..len)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            CHARS[(seed as usize) % CHARS.len()] as char
        })
        .collect()
}

fn format_time_remaining(ms: i64) -> String {
    if ms < 0 {
        return "Expired".to_string();
    }
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;
    if days > 0 {
        return format!("{} day(s) {} hour(s)", days, hours % 24);
    }
    if hours > 0 {
        return format!("{} hour(s) {} minute(s)", hours, minutes % 60);
    }
    if minutes > 0 {
        return format!("{} minute(s) {} second(s)", minutes, seconds % 60);
    }
    format!("{} second(s)", seconds)
}

async fn get_available_domains() -> Result<String, String> {
    let res = client()?
        .get(format!("{BASE_URL}/domains?page=1"))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let list = data.as_array().cloned().unwrap_or_default();
    let active = list
        .iter()
        .find(|d| d.get("isActive").and_then(|a| a.as_bool()).unwrap_or(false))
        .or_else(|| list.first())
        .ok_or("No domains available")?;
    Ok(active
        .get("domain")
        .and_then(|d| d.as_str())
        .unwrap_or("")
        .to_string())
}

async fn create_mail(session_id: &str) -> Result<Value, String> {
    let domain = get_available_domains().await?;
    let local = rand_lower(5);
    let password = rand_lower(8);
    let email = format!("{local}@{domain}");

    let c = client()?;
    let res = c
        .post(format!("{BASE_URL}/accounts"))
        .json(&json!({ "address": email, "password": password }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let account: Value = res.json().await.map_err(|e| e.to_string())?;

    let token_res = c
        .post(format!("{BASE_URL}/token"))
        .json(&json!({ "address": email, "password": password }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let token_data: Value = token_res.json().await.map_err(|e| e.to_string())?;
    let token = token_data
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or("Failed to get access token")?
        .to_string();

    let inbox = get_inbox(&token).await.unwrap_or(json!([]));
    let created = now_ms();
    let expires_at = created + MAX_AGE_MS;

    let session = json!({
        "email": email,
        "password": password,
        "accountId": account.get("id").cloned().unwrap_or(Value::Null),
        "token": token,
        "createdAt": created,
        "expiresAt": expires_at,
    });
    save_session(&format!("mailtm_{session_id}.json"), &session);

    Ok(json!({
        "email": email,
        "password": password,
        "inbox": inbox,
        "createdAt": created,
        "expiresAt": expires_at,
    }))
}

async fn get_inbox(token: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!("{BASE_URL}/messages?page=1"))
        .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn get_message_detail(token: &str, message_id: &str) -> Option<Value> {
    let res = client()
        .ok()?
        .get(format!("{BASE_URL}/messages/{message_id}"))
        .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    res.json::<Value>().await.ok()
}

async fn delete_account(token: &str, account_id: &str) -> Result<(), String> {
    client()?
        .delete(format!("{BASE_URL}/accounts/{account_id}"))
        .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn check_mail_inbox(session_id: &str) -> Result<Value, String> {
    let s = load_session(&format!("mailtm_{session_id}.json")).ok_or("Session not found")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        let _ = fs::remove_file(session_path(&format!("mailtm_{session_id}.json")));
        return Err("Temp mail expired (max 1 day)".to_string());
    }
    let token = s
        .get("token")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let inbox_data = get_inbox(&token).await?;
    let empty = Vec::new();
    let list = inbox_data.as_array().unwrap_or(&empty);

    let mut messages_with_detail: Vec<Value> = Vec::new();
    for msg in list.iter().take(5) {
        let id = msg
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let detail = get_message_detail(&token, &id).await;
        let text = detail
            .as_ref()
            .and_then(|d| d.get("text"))
            .and_then(|t| t.as_str())
            .map(|t| {
                if t.len() > 200 {
                    format!(
                        "{}...",
                        &t[..t.char_indices().nth(200).map(|(i, _)| i).unwrap_or(t.len())]
                    )
                } else {
                    t.to_string()
                }
            });
        messages_with_detail.push(json!({
            "id": msg.get("id").cloned().unwrap_or(Value::Null),
            "subject": msg.get("subject").cloned().unwrap_or(Value::Null),
            "from": msg.get("from").cloned().unwrap_or(Value::Null),
            "to": msg.get("to").cloned().unwrap_or(Value::Null),
            "intro": msg.get("intro").cloned().unwrap_or(Value::Null),
            "createdAt": msg.get("createdAt").cloned().unwrap_or(Value::Null),
            "seen": msg.get("seen").cloned().unwrap_or(Value::Null),
            "hasAttachments": msg.get("hasAttachments").cloned().unwrap_or(Value::Null),
            "size": msg.get("size").cloned().unwrap_or(Value::Null),
            "detail": match detail {
                Some(d) => json!({
                    "text": text,
                    "html": if d.get("html").map(|h| !h.is_null()).unwrap_or(false) { json!("(html content)") } else { Value::Null },
                }),
                None => Value::Null,
            },
        }));
    }

    let inbox_val = if messages_with_detail.is_empty() {
        json!(list)
    } else {
        json!(messages_with_detail)
    };
    let remaining = expires_at as i64 - now_ms() as i64;
    Ok(json!({
        "email": s.get("email").cloned().unwrap_or(Value::Null),
        "password": s.get("password").cloned().unwrap_or(Value::Null),
        "inbox": inbox_val,
        "inboxCount": list.len(),
        "createdAt": s.get("createdAt").cloned().unwrap_or(Value::Null),
        "expiresAt": expires_at,
        "timeRemaining": remaining,
        "timeRemainingHuman": format_time_remaining(remaining),
    }))
}

async fn delete_mail(session_id: &str) -> Result<Value, String> {
    let s = load_session(&format!("mailtm_{session_id}.json")).ok_or("Session not found")?;
    let email = s
        .get("email")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();
    let token = s
        .get("token")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let account_id = s
        .get("accountId")
        .and_then(|a| a.as_str())
        .unwrap_or("")
        .to_string();

    let server_result = delete_account(&token, &account_id).await;
    let _ = fs::remove_file(session_path(&format!("mailtm_{session_id}.json")));

    if server_result.is_ok() {
        Ok(json!({
            "success": true,
            "message": "Email account successfully deleted",
            "email": email,
            "deletedAt": now_ms(),
        }))
    } else {
        Ok(json!({
            "success": true,
            "message": "Session deleted locally (server cleanup may have failed)",
            "email": email,
            "deletedAt": now_ms(),
            "serverError": server_result.unwrap_err(),
        }))
    }
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
        Some(a) if ["create", "inbox", "delete"].contains(&a.as_str()) => a,
        _ => {
            return bad(
                "INVALID_ACTION",
                "Parameter 'action' harus 'create', 'inbox', atau 'delete'",
            )
        }
    };

    let result = match action.as_str() {
        "create" => create_mail(&session_id).await,
        "inbox" => check_mail_inbox(&session_id).await,
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
            if e.contains("Session not found") {
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
            if e.contains("expired") {
                return (
                    StatusCode::GONE,
                    Json(json!({
                        "status": false,
                        "message": "Email sementara telah kedaluwarsa (maksimal 1 hari). Buat email baru dengan action=create",
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
                    "code": "MAILTM_ERROR",
                    "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                })),
            )
                .into_response()
        }
    }
}

// boomlify — native conversion of api/tempmail/boomlify.js
// Boomlify API with simulated fallback. Session state persisted to data/session/.
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

const BOOMIFY_API_URL: &str = "https://api.boomlify.com";
const MAX_AGE_MS: u64 = 60 * 24 * 60 * 60 * 1000; // 60 days

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

fn uuid4() -> String {
    let mut b = [0u8; 16];
    let seed = now_ms();
    for (i, byte) in b.iter_mut().enumerate() {
        *byte = ((seed >> ((i % 8) * 8)) as u8)
            .wrapping_mul(31)
            .wrapping_add(i as u8 * 7);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
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

async fn boomlify_create_email(domain: Option<&str>) -> Value {
    let dom = domain.unwrap_or("temp.mail");
    if let Ok(c) = reqwest::Client::builder()
        
        .build()
    {
        if let Ok(res) = c
            .post(format!("{BOOMIFY_API_URL}/v1/mailboxes"))
                        .header("Content-Type", "application/json")
            .json(&json!({ "domain": dom }))
            .send()
            .await
        {
            if let Ok(data) = res.json::<Value>().await {
                if let Some(addr) = data.get("address").and_then(|a| a.as_str()) {
                    return json!({
                        "address": addr,
                        "createdAt": chrono::Utc::now().to_rfc3339(),
                        "expiresAt": chrono::DateTime::from_timestamp_millis((now_ms() + MAX_AGE_MS) as i64).map(|d| d.to_rfc3339()).unwrap_or_default(),
                        "domain": data.get("domain").and_then(|d| d.as_str()).unwrap_or(dom),
                        "isActive": true,
                    });
                }
            }
        }
    }
    // fallback simulation
    let email_name = uuid4().split('-').next().unwrap_or("temp").to_string();
    json!({
        "address": format!("{email_name}@{dom}"),
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "expiresAt": chrono::DateTime::from_timestamp_millis((now_ms() + MAX_AGE_MS) as i64).map(|d| d.to_rfc3339()).unwrap_or_default(),
        "domain": dom,
        "isActive": true,
    })
}

async fn boomlify_get_inbox(email: &str) -> Value {
    if let Ok(c) = reqwest::Client::builder()
        
        .build()
    {
        if let Ok(res) = c
            .get(format!("{BOOMIFY_API_URL}/v1/mailboxes/{email}/messages"))
            .send()
            .await
        {
            if let Ok(data) = res.json::<Value>().await {
                return json!({ "address": email, "messages": data.get("messages").cloned().unwrap_or(json!([])) });
            }
        }
    }
    json!({ "address": email, "messages": [] })
}

async fn create_mail(session_id: &str, domain: Option<&str>) -> Result<Value, String> {
    let email_data = boomlify_create_email(domain).await;
    let address = email_data
        .get("address")
        .and_then(|a| a.as_str())
        .ok_or("Failed to create email")?
        .to_string();
    let expires_at = email_data
        .get("expiresAt")
        .and_then(|e| e.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis() as u64)
        .unwrap_or(now_ms() + MAX_AGE_MS);

    save_session(
        &format!("boomlify_{session_id}.json"),
        &json!({ "email": address, "createdAt": now_ms(), "expiresAt": expires_at }),
    );

    Ok(json!({
        "email": address,
        "createdAt": now_ms(),
        "expiresAt": expires_at,
        "timeRemaining": expires_at.saturating_sub(now_ms()),
        "timeRemainingHuman": format_time_remaining(expires_at as i64 - now_ms() as i64),
        "note": "Email will expire in 60 days",
    }))
}

async fn check_mail_inbox(session_id: &str) -> Result<Value, String> {
    let s = load_session(&format!("boomlify_{session_id}.json")).ok_or("Session not found")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        remove_session(&format!("boomlify_{session_id}.json"));
        return Err("Email session expired".to_string());
    }
    let email = s
        .get("email")
        .and_then(|e| e.as_str())
        .unwrap_or("")
        .to_string();
    let inbox_data = boomlify_get_inbox(&email).await;
    let count = inbox_data
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    Ok(json!({
        "email": email,
        "messages": inbox_data.get("messages").cloned().unwrap_or(json!([])),
        "inboxCount": count,
        "createdAt": s.get("createdAt").cloned().unwrap_or(Value::Null),
        "expiresAt": expires_at,
        "timeRemaining": expires_at.saturating_sub(now_ms()),
        "timeRemainingHuman": format_time_remaining(expires_at as i64 - now_ms() as i64),
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
    let action = match get("action") {
        Some(a) if ["create", "inbox", "delete"].contains(&a.as_str()) => a,
        _ => {
            return bad(
                "INVALID_ACTION",
                "Parameter 'action' harus 'create', 'inbox', atau 'delete'",
            )
        }
    };
    let session_id = match get("sessionId")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(s) => s,
        None => {
            return bad(
                "INVALID_SESSION_ID",
                "Parameter 'sessionId' wajib diisi dan harus berupa string yang tidak kosong",
            )
        }
    };

    let result = match action.as_str() {
        "create" => create_mail(&session_id, get("domain").as_deref()).await,
        "inbox" => check_mail_inbox(&session_id).await,
        _ => {
            let existed = load_session(&format!("boomlify_{session_id}.json")).is_some();
            remove_session(&format!("boomlify_{session_id}.json"));
            if existed {
                Ok(json!({ "success": true, "message": "Session deleted successfully" }))
            } else {
                Err("Session not found".to_string())
            }
        }
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
                        "message": "Email sementara telah kedaluwarsa. Buat email baru dengan action=create",
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
                    "code": "TEMPMAIL_V5_ERROR",
                    "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                })),
            )
                .into_response()
        }
    }
}

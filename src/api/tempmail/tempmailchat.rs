// tempmailchat — native conversion of api/tempmail/tempmailchat.js
// TempMail Chat backend (api.lmngh.site): create/inbox/wait/auto/delete inbox.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const API_BASE: &str = "https://api.lmngh.site/api";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        "Accept",
        "application/json, text/plain, */*".parse().unwrap(),
    );
    h.insert("Content-Type", "application/json".parse().unwrap());
    h.insert("Origin", "https://lmngh.site".parse().unwrap());
    h.insert("Referer", "https://lmngh.site/".parse().unwrap());
    h
}

async fn create_inbox() -> Result<Value, String> {
    let res = client()?
        .post(format!("{API_BASE}/create-inbox"))
        .headers(headers())
        .body("{}")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn get_inbox(token: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!(
            "{API_BASE}/inbox?token={}",
            urlencoding::encode(token)
        ))
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn delete_inbox(token: &str) -> Result<Value, String> {
    let res = client()?
        .post(format!("{API_BASE}/delete-inbox"))
        .headers(headers())
        .json(&json!({ "token": token }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn wait_for_email(token: &str, max_wait: u64) -> Option<Value> {
    let max_attempts = (max_wait.max(1)) / 5;
    let mut known_ids: Vec<String> = Vec::new();
    for _ in 0..max_attempts {
        if let Ok(inbox) = get_inbox(token).await {
            if inbox
                .get("success")
                .and_then(|s| s.as_bool())
                .unwrap_or(false)
            {
                let messages = inbox
                    .get("messages")
                    .and_then(|m| m.as_array())
                    .cloned()
                    .unwrap_or_default();
                for msg in messages {
                    let msg_id = msg
                        .get("id")
                        .map(|i| i.to_string())
                        .or_else(|| msg.get("received_at").map(|r| r.to_string()))
                        .unwrap_or_else(|| msg.to_string());
                    if !known_ids.contains(&msg_id) {
                        return Some(inbox);
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
    None
}

fn extract_links(body: &str) -> Vec<String> {
    if body.is_empty() {
        return Vec::new();
    }
    let mut links: Vec<String> = Vec::new();
    let mut push = |l: String| {
        if !links.contains(&l) {
            links.push(l);
        }
    };
    // href="..." / href='...'
    let mut i = 0;
    while i + 6 <= body.len() {
        if &body[i..i + 5] == "href=" {
            let rest = &body[i + 5..];
            let quote = rest.chars().next();
            if let Some(q @ ('"' | '\'')) = quote {
                let inner = &rest[1..];
                if let Some(end) = inner.find(q) {
                    push(inner[..end].to_string());
                    i += 5 + 1 + end + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    // bare URLs
    let mut start: Option<usize> = None;
    let bytes = body.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        let is_url_char = b.is_ascii_alphanumeric()
            || matches!(
                b,
                b':' | b'/' | b'.' | b'-' | b'_' | b'?' | b'=' | b'&' | b'%' | b'#' | b'~'
            );
        if is_url_char && start.is_none() {
            if i + 7 <= bytes.len()
                && (&body[i..i + 7] == "http://"
                    || (i + 8 <= bytes.len() && &body[i..i + 8] == "https://"))
            {
                start = Some(i);
            }
        } else if !is_url_char {
            if let Some(s) = start {
                if i > s {
                    push(body[s..i].to_string());
                }
                start = None;
            }
        }
    }
    if let Some(s) = start {
        push(body[s..].to_string());
    }
    links
}

fn format_remaining(s: i64) -> String {
    if s <= 0 {
        return "expired".to_string();
    }
    let hours = s / 3600;
    let minutes = (s % 3600) / 60;
    if hours >= 24 && hours % 24 == 0 && minutes == 0 {
        return format!("{hours} jam");
    }
    if hours >= 24 {
        let days = hours / 24;
        let rem_h = hours % 24;
        return if rem_h > 0 {
            format!("{days} hari {rem_h} jam")
        } else {
            format!("{days} hari")
        };
    }
    if hours > 0 {
        return if minutes > 0 {
            format!("{hours} jam {minutes} menit")
        } else {
            format!("{hours} jam")
        };
    }
    format!("{} menit", minutes.max(1))
}

fn format_expires_data(expires_in_or_at: &Value) -> (Value, Value) {
    let raw = match expires_in_or_at {
        Value::Null => return (Value::Null, Value::Null),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.trim().to_string(),
        other => other.to_string(),
    };
    let now = chrono::Utc::now();

    let target: Option<chrono::DateTime<chrono::Utc>> =
        if raw.chars().all(|c| c.is_ascii_digit()) && !raw.is_empty() {
            let remaining: i64 = raw.parse().unwrap_or(0);
            Some(now + chrono::Duration::seconds(remaining))
        } else {
            let iso = if raw.contains('T') {
                raw.clone()
            } else {
                format!("{}Z", raw.replacen(' ', "T", 1).trim_end_matches('Z'))
            };
            chrono::DateTime::parse_from_rfc3339(&iso)
                .map(|d| d.with_timezone(&chrono::Utc))
                .ok()
        };

    match target {
        Some(t) => {
            let remaining = (t.timestamp() - now.timestamp()).max(0);
            (
                json!(t
                    .with_timezone(&chrono::Local)
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string()),
                json!(format_remaining(remaining)),
            )
        }
        None => (json!(raw), Value::Null),
    }
}

fn normalize_messages(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .enumerate()
        .map(|(index, m)| {
            let body = m
                .get("html_body")
                .and_then(|b| b.as_str())
                .or_else(|| m.get("text_body").and_then(|b| b.as_str()))
                .unwrap_or("");
            let (expires, _eh) = format_expires_data(m.get("expires_at").unwrap_or(&Value::Null));
            json!({
                "index": index + 1,
                "id": m.get("id").cloned().unwrap_or(Value::Null),
                "from": m.get("sender").cloned().unwrap_or(Value::Null),
                "fromName": m.get("sender_name").cloned().unwrap_or(Value::Null),
                "to": m.get("recipient").cloned().unwrap_or(Value::Null),
                "subject": m.get("subject").cloned().unwrap_or(Value::Null),
                "body": m.get("text_body").cloned().unwrap_or(Value::Null),
                "html": m.get("html_body").cloned().unwrap_or(Value::Null),
                "links": extract_links(body),
                "date": m.get("received_at").cloned().unwrap_or(Value::Null),
                "expires": expires,
            })
        })
        .collect()
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
    let action = match get("action").filter(|a| !a.trim().is_empty()) {
        Some(a) => a,
        None => return bad("Parameter 'action' wajib diisi (create|inbox|wait|auto|delete)"),
    };
    let max_wait = get("maxwait")
        .and_then(|m| m.parse::<u64>().ok())
        .unwrap_or(120);
    let token = get("token");

    if action == "create" {
        let hasil = match create_inbox().await {
            Ok(h) => h,
            Err(e) => return Json(json!({ "status": false, "message": e })).into_response(),
        };
        if hasil
            .get("success")
            .and_then(|s| s.as_bool())
            .unwrap_or(false)
        {
            let (expires, expires_human) = format_expires_data(
                hasil
                    .get("expires_in")
                    .or_else(|| hasil.get("expires_at"))
                    .unwrap_or(&Value::Null),
            );
            return Json(json!({
                "status": true,
                "data": {
                    "email": hasil.get("email").cloned().unwrap_or(Value::Null),
                    "token": hasil.get("access_token").cloned().unwrap_or(Value::Null),
                    "expires": expires,
                    "expires_human": expires_human,
                }
            }))
            .into_response();
        }
        return Json(json!({
            "status": false,
            "message": hasil.get("error").cloned().unwrap_or(Value::Null)
        }))
        .into_response();
    }

    if action == "inbox" {
        let token = match token.filter(|t| !t.trim().is_empty()) {
            Some(t) => t,
            None => return bad("Parameter 'token' wajib diisi (dari action=create)"),
        };
        let hasil = match get_inbox(&token).await {
            Ok(h) => h,
            Err(e) => return Json(json!({ "status": false, "message": e })).into_response(),
        };
        if hasil
            .get("success")
            .and_then(|s| s.as_bool())
            .unwrap_or(false)
        {
            let messages = normalize_messages(
                hasil
                    .get("messages")
                    .and_then(|m| m.as_array())
                    .map(|a| a.as_slice())
                    .unwrap_or(&[]),
            );
            let (expires, expires_human) = format_expires_data(
                hasil
                    .get("expires_at")
                    .or_else(|| hasil.get("expires_in"))
                    .unwrap_or(&Value::Null),
            );
            return Json(json!({
                "status": true,
                "data": {
                    "email": hasil.get("email").cloned().unwrap_or(Value::Null),
                    "expires": expires,
                    "expires_human": expires_human,
                    "total": messages.len(),
                    "messages": messages,
                }
            }))
            .into_response();
        }
        return Json(json!({ "status": false, "message": hasil.get("error").cloned().unwrap_or(Value::Null) })).into_response();
    }

    if action == "wait" {
        let token = match token.filter(|t| !t.trim().is_empty()) {
            Some(t) => t,
            None => return bad("Parameter 'token' wajib diisi (dari action=create)"),
        };
        return match wait_for_email(&token, max_wait).await {
            Some(hasil) => {
                let messages = normalize_messages(hasil.get("messages").and_then(|m| m.as_array()).map(|a| a.as_slice()).unwrap_or(&[]));
                let (expires, expires_human) =
                    format_expires_data(hasil.get("expires_at").or_else(|| hasil.get("expires_in")).unwrap_or(&Value::Null));
                Json(json!({
                    "status": true,
                    "data": {
                        "email": hasil.get("email").cloned().unwrap_or(Value::Null),
                        "expires": expires,
                        "expires_human": expires_human,
                        "total": messages.len(),
                        "messages": messages,
                    }
                }))
                .into_response()
            }
            None => Json(json!({ "status": false, "message": format!("Tidak ada email masuk dalam {max_wait} detik") })).into_response(),
        };
    }

    if action == "auto" {
        let buat = match create_inbox().await {
            Ok(b) => b,
            Err(e) => return Json(json!({ "status": false, "message": e })).into_response(),
        };
        if !buat
            .get("success")
            .and_then(|s| s.as_bool())
            .unwrap_or(false)
        {
            return Json(json!({ "status": false, "message": buat.get("error").cloned().unwrap_or(json!("Gagal buat inbox")) })).into_response();
        }
        let access_token = buat
            .get("access_token")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        return match wait_for_email(&access_token, max_wait).await {
            Some(hasil) => {
                let messages = normalize_messages(
                    hasil
                        .get("messages")
                        .and_then(|m| m.as_array())
                        .map(|a| a.as_slice())
                        .unwrap_or(&[]),
                );
                let (expires, expires_human) = format_expires_data(
                    hasil
                        .get("expires_at")
                        .or_else(|| hasil.get("expires_in"))
                        .unwrap_or(&Value::Null),
                );
                Json(json!({
                    "status": true,
                    "data": {
                        "email": hasil.get("email").cloned().unwrap_or(buat.get("email").cloned().unwrap_or(Value::Null)),
                        "token": access_token,
                        "expires": expires,
                        "expires_human": expires_human,
                        "total": messages.len(),
                        "messages": messages,
                    }
                }))
                .into_response()
            }
            None => Json(json!({
                "status": false,
                "message": format!("Tidak ada email masuk dalam {max_wait} detik"),
                "data": {
                    "email": buat.get("email").cloned().unwrap_or(Value::Null),
                    "token": access_token,
                }
            }))
            .into_response(),
        };
    }

    if action == "delete" {
        let token = match token.filter(|t| !t.trim().is_empty()) {
            Some(t) => t,
            None => return bad("Parameter 'token' wajib diisi (dari action=create)"),
        };
        let hasil = delete_inbox(&token).await.unwrap_or(json!({}));
        return Json(json!({
            "status": hasil.get("success").and_then(|s| s.as_bool()).unwrap_or(false),
            "data": hasil,
        }))
        .into_response();
    }

    bad("Action tidak valid. Gunakan: create, inbox, wait, auto, delete")
}

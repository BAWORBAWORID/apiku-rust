// tempamail — native conversion of api/tempmail/tempamail.js
// TempAMail.com webapp API (form-post based). UUID scraped from homepage,
// cached in-process; no session file needed (email_id is passed by the client).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

const API_HOST: &str = "https://api.tempamail.com";
const FALLBACK_UUID: &str = "1ccbf8ff-1ad7-426f-b00e-bc4db79dd558";

static CACHED_UUID: OnceLock<String> = OnceLock::new();

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_uuid() -> String {
    if let Ok(c) = client() {
        if let Ok(res) = c.get("https://tempamail.com/").send().await {
            if let Ok(text) = res.text().await {
                // uuid["']?\s*[:=]\s*["']([a-f0-9-]+)["'] — simple manual scan
                let lower = text.to_lowercase();
                if let Some(i) = lower.find("uuid") {
                    let seg = &text[i..(i + 120).min(text.len())];
                    for sep in [":", "="] {
                        if let Some(p) = seg.find(sep) {
                            let rest = seg[p + 1..].trim_start();
                            let rest = rest.trim_start_matches(|c| c == '"' || c == '\'');
                            let end = rest
                                .find(|c: char| !(c.is_ascii_hexdigit() || c == '-'))
                                .unwrap_or(0);
                            let cand = &rest[..end];
                            if cand.len() >= 8 {
                                return cand.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
    FALLBACK_UUID.to_string()
}

async fn get_uuid() -> String {
    if let Some(u) = CACHED_UUID.get() {
        return u.clone();
    }
    let u = fetch_uuid().await;
    let _ = CACHED_UUID.set(u.clone());
    u
}

async fn post_form(path: &str, form: &[(String, String)]) -> Result<Value, String> {
    let res = client()?
        .post(format!("{API_HOST}{path}"))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .form(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("parse error: {e}"))
}

async fn create_email(alias: &str, uuid: &str) -> Result<Value, String> {
    let j = post_form(
        "/webapp/email/custom",
        &[
            ("uuid".to_string(), uuid.to_string()),
            ("alias".to_string(), alias.to_string()),
            ("domain_id".to_string(), "2".to_string()),
        ],
    )
    .await?;
    Ok(json!({
        "email_id": j.pointer("/email/id").cloned().unwrap_or(Value::Null),
        "email": j.pointer("/email/address").cloned().unwrap_or(Value::Null),
        "alias": j.pointer("/email/alias").cloned().unwrap_or(Value::Null),
        "domain": j.pointer("/email/domain_name").cloned().unwrap_or(Value::Null),
    }))
}

async fn check_inbox(email_id: &str, uuid: &str) -> Result<Value, String> {
    let j = post_form(
        "/webapp/messages",
        &[
            ("uuid".to_string(), uuid.to_string()),
            ("selected_email_id".to_string(), email_id.to_string()),
            ("known_message_id".to_string(), "0".to_string()),
        ],
    )
    .await?;
    let email_id_num: i64 = email_id.parse().unwrap_or(0);
    let messages: Vec<Value> = j
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|m| m.get("email_id").and_then(|e| e.as_i64()) == Some(email_id_num))
                .map(|m| {
                    let from_raw = m.get("from").and_then(|f| f.as_str()).unwrap_or("");
                    let from: Value = serde_json::from_str(from_raw)
                        .unwrap_or(json!({ "name": from_raw, "address": from_raw }));
                    let body = m.get("body").and_then(|b| b.as_str()).unwrap_or("");
                    let cleaned = body
                        .replace("<div>", "\n")
                        .replace("<br>", "\n")
                        .replace("<br/>", "\n")
                        .replace("<br />", "\n");
                    let mut out = String::new();
                    let mut in_tag = false;
                    for c in cleaned.chars() {
                        match c {
                            '<' => in_tag = true,
                            '>' => in_tag = false,
                            c if !in_tag => out.push(c),
                            _ => {}
                        }
                    }
                    json!({
                        "id": m.get("id").cloned().unwrap_or(Value::Null),
                        "from": from,
                        "subject": m.get("subject").cloned().unwrap_or(Value::Null),
                        "body": out.trim(),
                        "created_at": m.get("created_at").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({ "email_id": email_id_num, "total": messages.len(), "messages": messages }))
}

fn rand_alias() -> String {
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    (0..10)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            CHARS[(seed as usize) % CHARS.len()] as char
        })
        .collect()
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
        Some(a) if ["create", "inbox"].contains(&a.as_str()) => a,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "message": "Parameter 'action' harus 'create' atau 'inbox'" }))).into_response(),
    };
    if action == "inbox" && get("email_id").filter(|e| !e.trim().is_empty()).is_none() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "message": "Parameter 'email_id' wajib diisi untuk action=inbox" }))).into_response();
    }

    let uuid = get_uuid().await;

    if action == "create" {
        let alias = get("alias")
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
            .unwrap_or_else(rand_alias);
        return match create_email(&alias, &uuid).await {
            Ok(result) => {
                let mut full = json!({ "status": true });
                if let Value::Object(map) = result {
                    for (k, v) in map {
                        full[k] = v;
                    }
                }
                Json(full).into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    let email_id = get("email_id").unwrap_or_default().trim().to_string();
    match check_inbox(&email_id, &uuid).await {
        Ok(result) => {
            let mut full = json!({ "status": true });
            if let Value::Object(map) = result {
                for (k, v) in map {
                    full[k] = v;
                }
            }
            Json(full).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "status": false, "message": e })),
        )
            .into_response(),
    }
}

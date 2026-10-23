// tempmailplus — native conversion of api/tempmail/tempmailplus.js
// tempmail.plus: create (random/custom, 9 domains), domains, inbox, message, delete, wait.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://tempmail.plus";
const DOMAINS: [&str; 9] = [
    "mailto.plus",
    "fexpost.com",
    "fexbox.org",
    "mailbox.in.ua",
    "rover.info",
    "chitthi.in",
    "fextemp.com",
    "any.pink",
    "merepost.com",
];

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

fn headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        "Accept",
        "application/json, text/plain, */*".parse().unwrap(),
    );
    h.insert("Referer", format!("{BASE_URL}/").parse().unwrap());
    h
}

fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
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

async fn get_inbox(email: &str, limit: i32) -> Result<Value, String> {
    let res = client()?
        .get(format!("{BASE_URL}/api/mails"))
        .query(&[("email", email), ("limit", &limit.to_string())])
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Gagal mengambil inbox (HTTP {})", res.status()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let list = data
        .get("mail_list")
        .and_then(|l| l.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(json!({
        "count": list.len(),
        "total": data.get("count").and_then(|c| c.as_i64()).unwrap_or(list.len() as i64),
        "messages": list.iter().map(|m| json!({
            "id": m.get("mail_id").cloned().unwrap_or(Value::Null),
            "from": m.get("from_mail").cloned().unwrap_or(Value::Null),
            "from_name": m.get("from_name").cloned().unwrap_or(Value::Null),
            "subject": m.get("subject").cloned().unwrap_or(Value::Null),
            "time": m.get("time").cloned().unwrap_or(Value::Null),
            "is_new": m.get("is_new").and_then(|v| v.as_bool()).unwrap_or(false),
            "attachments": m.get("attachment_count").and_then(|v| v.as_i64()).unwrap_or(0),
        })).collect::<Vec<_>>(),
    }))
}

async fn get_message(email: &str, mail_id: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!("{BASE_URL}/api/mails/{mail_id}"))
        .query(&[("email", email)])
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!(
            "Gagal membaca pesan {mail_id} (HTTP {})",
            res.status()
        ));
    }
    let d: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json!({
        "id": d.get("mail_id").cloned().unwrap_or(Value::Null),
        "subject": d.get("subject").cloned().unwrap_or(Value::Null),
        "from": d.get("from_mail").cloned().unwrap_or(Value::Null),
        "from_name": d.get("from_name").cloned().unwrap_or(Value::Null),
        "to": d.get("to").cloned().unwrap_or(Value::Null),
        "text": d.get("text").cloned().unwrap_or(Value::Null),
        "html": d.get("html").cloned().unwrap_or(Value::Null),
        "is_tls": d.get("is_tls").and_then(|v| v.as_bool()).unwrap_or(false),
        "message_id": d.get("message_id").cloned().unwrap_or(Value::Null),
    }))
}

async fn delete_message(email: &str, mail_id: &str) -> Result<bool, String> {
    let res = client()?
        .delete(format!("{BASE_URL}/api/mails/{mail_id}"))
        .query(&[("email", email)])
        .headers(headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let j: Value = res.json().await.unwrap_or(json!({}));
    Ok(j.get("result").and_then(|r| r.as_bool()).unwrap_or(false))
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
    let action = get("action")
        .unwrap_or_else(|| "create".to_string())
        .to_lowercase();

    if action == "domains" {
        return Json(json!({ "status": true, "total": DOMAINS.len(), "domains": DOMAINS }))
            .into_response();
    }

    if action == "create" || action == "generate" {
        let domain = get("domain")
            .unwrap_or_else(|| "mailto.plus".to_string())
            .to_lowercase();
        if !DOMAINS.contains(&domain.as_str()) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": format!("Domain tidak valid. Pilihan yang tersedia: {}", DOMAINS.join(", ")) })),
            )
                .into_response();
        }
        let username = match get("name") {
            Some(n) => n
                .to_lowercase()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.' || *c == '-')
                .collect(),
            None => random_string(8),
        };
        let email = format!("{username}@{domain}");
        return Json(json!({
            "status": true,
            "action": "create",
            "result": { "email": email, "username": username, "domain": domain }
        }))
        .into_response();
    }

    let email = match get("email").filter(|e| e.contains('@')) {
        Some(e) => e.trim().to_lowercase(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'email' valid wajib diisi untuk aksi ini" })),
            )
                .into_response()
        }
    };

    if action == "inbox" || action == "messages" {
        return match get_inbox(&email, 20).await {
            Ok(inbox) => Json(json!({
                "status": true,
                "action": "inbox",
                "email": email,
                "total": inbox.get("total").cloned().unwrap_or(json!(0)),
                "count": inbox.get("count").cloned().unwrap_or(json!(0)),
                "messages": inbox.get("messages").cloned().unwrap_or(json!([])),
            }))
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    if action == "message" || action == "read" || action == "detail" {
        let mail_id = get("id").or_else(|| get("mail_id"));
        let mail_id = match mail_id.filter(|i| !i.trim().is_empty()) {
            Some(i) => i,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "status": false, "message": "Parameter 'id' (mail ID) wajib diisi untuk membaca pesan" })),
                )
                    .into_response()
            }
        };
        return match get_message(&email, &mail_id).await {
            Ok(msg) => {
                Json(json!({ "status": true, "action": "message", "result": msg })).into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    if action == "delete" || action == "destroy" {
        let mail_id = get("id").or_else(|| get("mail_id"));
        let mail_id = match mail_id.filter(|i| !i.trim().is_empty()) {
            Some(i) => i,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "status": false, "message": "Parameter 'id' (mail ID) wajib diisi untuk menghapus pesan" })),
                )
                    .into_response()
            }
        };
        let success = delete_message(&email, &mail_id).await.unwrap_or(false);
        return Json(json!({
            "status": success,
            "action": "delete",
            "message": if success { "Pesan berhasil dihapus" } else { "Gagal menghapus pesan / pesan tidak ditemukan" }
        }))
        .into_response();
    }

    if action == "wait" {
        let max_wait = get("timeout")
            .and_then(|t| t.parse::<u64>().ok())
            .unwrap_or(60)
            .clamp(5, 180);
        // initial baseline then poll for new mail
        let initial = get_inbox(&email, 20).await.unwrap_or(json!({ "count": 0 }));
        let initial_count = initial.get("count").and_then(|c| c.as_i64()).unwrap_or(0);
        let mut incoming: Option<Value> = None;
        for _ in 0..(max_wait / 4) {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            if let Ok(current) = get_inbox(&email, 20).await {
                let count = current.get("count").and_then(|c| c.as_i64()).unwrap_or(0);
                if count > initial_count {
                    let latest = current.pointer("/messages/0").cloned();
                    if let Some(mut latest) = latest {
                        if let Some(id) = latest.get("id").and_then(|i| {
                            i.as_str()
                                .map(|s| s.to_string())
                                .or_else(|| i.as_i64().map(|n| n.to_string()))
                        }) {
                            if let Ok(detail) = get_message(&email, &id).await {
                                latest["detail"] = detail;
                            }
                        }
                        incoming = Some(latest);
                    }
                    break;
                }
            }
        }
        return match incoming {
            None => Json(json!({
                "status": false, "action": "wait",
                "message": format!("Tidak ada email baru masuk dalam {max_wait} detik"),
                "email": email
            }))
            .into_response(),
            Some(r) => {
                Json(json!({ "status": true, "action": "wait", "email": email, "result": r }))
                    .into_response()
            }
        };
    }

    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "message": "Action tidak valid. Gunakan: create, domains, inbox, message, delete, wait" })),
    )
        .into_response()
}

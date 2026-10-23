// maildropy — native conversion of api/tempmail/maildropy.js
// Maildropy (maildropy.com): create/custom email, inbox + OTP, message, status, delete.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "http://maildropy.com";
const WEB_BASE: &str = "https://maildropy.com";
const ACTIONS: [&str; 5] = ["create", "inbox", "message", "status", "delete"];

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
        .cookie_store(true)
        .build()
        .map_err(|e| e.to_string())
}

fn get_direct_url(email: &str) -> Value {
    if email.is_empty() {
        Value::Null
    } else {
        json!(format!("{WEB_BASE}/{email}"))
    }
}

fn extract_otp(subject: &str, body: &str) -> Option<String> {
    let text = format!("{subject}\n{body}");
    let lower = text.to_lowercase();
    let triggers = [
        "kode",
        "code",
        "otp",
        "verifikasi",
        "verification",
        "verify",
        "pin",
        "passcode",
        "one-time",
        "sekali pakai",
        "token",
        "authentication",
        "autentikasi",
    ];
    let negatives = [
        "invoice", "pesanan", "order", "total", "tagihan", "faktur", "resi", "nomor", "no.", "rp",
        "harga", "jumlah",
    ];
    let bytes = text.as_bytes();
    let mut otp: Option<String> = None;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            let len = j - i;
            if len >= 4 && len <= 8 {
                let before_start = lower[..i]
                    .char_indices()
                    .rev()
                    .take(80)
                    .last()
                    .map(|(ci, _)| ci)
                    .unwrap_or(0);
                let before = &lower[before_start..i];
                let after = &lower[j..(j + 40).min(lower.len())];
                let near = format!("{before} {after}");
                if i > 0 && bytes[i - 1] == b'#' || negatives.iter().any(|n| near.contains(n)) {
                    i = j;
                    continue;
                }
                if triggers.iter().any(|t| near.contains(t)) && (otp.is_none() || len == 6) {
                    otp = Some(text[i..j].to_string());
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    otp
}

async fn create_email(username: &str, domain: &str) -> Value {
    let clean_domain = if domain.trim().is_empty() {
        "maildropy.com".to_string()
    } else {
        domain.trim().to_lowercase()
    };
    let clean_user: String = username
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect();

    let c = match client() {
        Ok(c) => c,
        Err(e) => return json!({ "success": false, "error": e }),
    };

    if !clean_user.is_empty() {
        let custom_email = format!("{clean_user}@{clean_domain}");
        let res = c
            .post(format!("{BASE_URL}/wxapi/set-email"))
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
            .json(&json!({ "email": custom_email }))
            .send()
            .await;
        match res {
            Ok(r) => {
                let ok = r.status().is_success();
                let data: Value = r.json().await.unwrap_or(json!({}));
                let email = data
                    .get("email")
                    .and_then(|e| e.as_str())
                    .unwrap_or(&custom_email)
                    .to_string();
                json!({
                    "success": ok,
                    "email": email,
                    "domain": clean_domain,
                    "approved": data.get("approved").and_then(|a| a.as_bool()).unwrap_or(false),
                    "direct_url": get_direct_url(&email),
                })
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        }
    } else {
        let res = c
            .post(format!("{BASE_URL}/wxapi/generate"))
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
            .json(&json!({ "domain": clean_domain }))
            .send()
            .await;
        match res {
            Ok(r) => {
                let ok = r.status().is_success();
                let data: Value = r.json().await.unwrap_or(json!({}));
                let api_success = data
                    .get("success")
                    .and_then(|s| s.as_bool())
                    .unwrap_or(false);
                let email = data
                    .get("email")
                    .and_then(|e| e.as_str())
                    .map(|s| s.to_string());
                json!({
                    "success": ok && api_success,
                    "email": email.clone(),
                    "domain": data.get("domain").and_then(|d| d.as_str()).unwrap_or(&clean_domain),
                    "approved": data.get("approved").and_then(|a| a.as_bool()).unwrap_or(false),
                    "direct_url": email.as_deref().map(get_direct_url).unwrap_or(Value::Null),
                })
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        }
    }
}

async fn validate_status(email: &str) -> Value {
    let encoded = urlencoding::encode(email);
    let c = match client() {
        Ok(c) => c,
        Err(e) => return json!({ "success": false, "error": e }),
    };
    match c
        .get(format!("{BASE_URL}/wxapi/email-status/{encoded}"))
        .send()
        .await
    {
        Ok(r) => {
            let ok = r.status().is_success();
            let data: Value = r.json().await.unwrap_or(json!({}));
            let email_out = data
                .get("email")
                .and_then(|e| e.as_str())
                .unwrap_or(email)
                .to_string();
            json!({
                "success": ok,
                "email": email_out,
                "domain": data.get("domain").and_then(|d| d.as_str()).unwrap_or("maildropy.com"),
                "approved": data.get("approved").and_then(|a| a.as_bool()).unwrap_or(false),
                "status": data.get("status").and_then(|s| s.as_str()).unwrap_or("unknown"),
                "type": data.get("type").cloned().unwrap_or(Value::Null),
                "direct_url": get_direct_url(&email_out),
            })
        }
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

async fn fetch_inbox(email: &str) -> Value {
    let encoded = urlencoding::encode(email);
    let c = match client() {
        Ok(c) => c,
        Err(e) => return json!({ "success": false, "error": e }),
    };
    let data: Value = match c
        .get(format!("{BASE_URL}/wxapi/messages/{encoded}"))
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(json!({})),
        Err(e) => return json!({ "success": false, "error": e.to_string() }),
    };
    let raw_list = data
        .get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let messages: Vec<Value> = raw_list
        .iter()
        .map(|m| {
            let subject = m.get("subject").and_then(|s| s.as_str())
                .or_else(|| m.pointer("/header/subject").and_then(|s| s.as_str()))
                .unwrap_or("");
            let body = m.get("preview").and_then(|s| s.as_str())
                .or_else(|| m.get("text").and_then(|s| s.as_str()))
                .or_else(|| m.get("body").and_then(|s| s.as_str()))
                .unwrap_or("");
            json!({
                "id": m.get("id").or_else(|| m.get("_id")).or_else(|| m.get("messageId")).cloned().unwrap_or(Value::Null),
                "from": m.get("from").and_then(|s| s.as_str())
                    .or_else(|| m.pointer("/header/from").and_then(|s| s.as_str()))
                    .unwrap_or("Unknown"),
                "subject": subject,
                "date": m.get("date").and_then(|d| d.as_str())
                    .or_else(|| m.pointer("/header/date").and_then(|d| d.as_str()))
                    .map(|s| json!(s))
                    .unwrap_or(Value::Null),
                "otp": extract_otp(subject, body),
                "preview": body.chars().take(150).collect::<String>(),
                "raw": m.clone(),
            })
        })
        .collect();
    let email_out = data
        .get("email")
        .and_then(|e| e.as_str())
        .unwrap_or(email)
        .to_string();
    json!({
        "email": email_out,
        "exists": data.get("exists").and_then(|e| e.as_bool()).unwrap_or(false),
        "approved": data.get("approved").and_then(|a| a.as_bool()).unwrap_or(false),
        "count": data.get("count").and_then(|c| c.as_i64()).unwrap_or(messages.len() as i64),
        "unread": data.get("unread").and_then(|u| u.as_i64()).unwrap_or(0),
        "direct_url": get_direct_url(&email_out),
        "messages": messages,
    })
}

async fn wait_for_inbox(email: &str, max_seconds: u64) -> Value {
    let cap = max_seconds.min(60);
    let start = std::time::Instant::now();
    while (start.elapsed().as_secs() as u64) < cap {
        let inbox = fetch_inbox(email).await;
        let n = inbox
            .get("messages")
            .and_then(|m| m.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        if n > 0 {
            return inbox;
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
    fetch_inbox(email).await
}

async fn fetch_message(email: &str, message_id: &str) -> Value {
    let ee = urlencoding::encode(email);
    let ei = urlencoding::encode(message_id);
    let c = match client() {
        Ok(c) => c,
        Err(e) => return json!({ "error": e }),
    };
    let data: Value = match c
        .get(format!("{BASE_URL}/wxapi/message/{ee}/{ei}"))
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(json!({})),
        Err(e) => return json!({ "error": e.to_string() }),
    };
    let subject = data
        .get("subject")
        .and_then(|s| s.as_str())
        .or_else(|| data.pointer("/header/subject").and_then(|s| s.as_str()))
        .unwrap_or("");
    let text = data
        .get("text")
        .and_then(|s| s.as_str())
        .or_else(|| data.get("bodyText").and_then(|s| s.as_str()))
        .unwrap_or("");
    let html = data
        .get("html")
        .and_then(|s| s.as_str())
        .or_else(|| data.get("bodyHtml").and_then(|s| s.as_str()))
        .unwrap_or("");
    json!({
        "id": message_id,
        "email": email,
        "from": data.get("from").and_then(|s| s.as_str())
            .or_else(|| data.pointer("/header/from").and_then(|s| s.as_str()))
            .unwrap_or("Unknown"),
        "subject": subject,
        "date": data.get("date").and_then(|d| d.as_str())
            .or_else(|| data.pointer("/header/date").and_then(|d| d.as_str()))
            .map(|s| json!(s))
            .unwrap_or(Value::Null),
        "otp": extract_otp(subject, &format!("{text}\n{html}")),
        "text": text,
        "html": html,
        "direct_url": get_direct_url(email),
    })
}

async fn delete_mail(email: &str, message_id: Option<&str>) -> Value {
    let ee = urlencoding::encode(email);
    let c = match client() {
        Ok(c) => c,
        Err(e) => return json!({ "success": false, "error": e }),
    };
    let result = match message_id.filter(|m| !m.is_empty()) {
        Some(mid) => {
            let ei = urlencoding::encode(mid);
            match c
                .delete(format!("{BASE_URL}/wxapi/message/{ee}/{ei}"))
                .send()
                .await
            {
                Ok(r) => {
                    let ok = r.status().is_success();
                    json!({
                        "success": ok,
                        "target": format!("message_{mid}"),
                        "message": if ok { "Pesan berhasil dihapus" } else { "Gagal menghapus pesan" },
                    })
                }
                Err(e) => json!({ "success": false, "error": e.to_string() }),
            }
        }
        None => match c
            .delete(format!("{BASE_URL}/wxapi/inbox/{ee}"))
            .send()
            .await
        {
            Ok(r) => {
                let ok = r.status().is_success();
                json!({
                    "success": ok,
                    "target": "entire_inbox",
                    "message": if ok { "Seluruh inbox berhasil dibersihkan" } else { "Gagal membersihkan inbox" },
                })
            }
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
    };
    result
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
        .trim()
        .to_lowercase();

    if action == "create" || action == "generate" || action == "new" {
        let username = get("username").unwrap_or_default();
        let domain = get("domain").unwrap_or_else(|| "maildropy.com".to_string());
        let result = create_email(&username, &domain).await;
        return Json(json!({ "status": result.get("success").and_then(|s| s.as_bool()).unwrap_or(false), "result": result })).into_response();
    }

    if action == "inbox" || action == "messages" || action == "check" {
        let target = get("email")
            .map(|e| e.trim().to_lowercase())
            .unwrap_or_default();
        if target.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'email' wajib diisi untuk action=inbox (contoh: user@maildropy.com)" })),
            )
                .into_response();
        }
        let wait_seconds = get("wait").and_then(|w| w.parse::<u64>().ok()).unwrap_or(0);
        let result = if wait_seconds > 0 {
            wait_for_inbox(&target, wait_seconds).await
        } else {
            fetch_inbox(&target).await
        };
        return Json(json!({ "status": true, "result": result })).into_response();
    }

    if action == "message" || action == "detail" || action == "read" {
        let target = get("email")
            .map(|e| e.trim().to_lowercase())
            .unwrap_or_default();
        let msg_id = get("id")
            .or_else(|| get("messageId"))
            .map(|i| i.trim().to_string())
            .unwrap_or_default();
        if target.is_empty() || msg_id.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'email' dan 'id' pesan wajib diisi untuk action=message" })),
            )
                .into_response();
        }
        return Json(json!({ "status": true, "result": fetch_message(&target, &msg_id).await }))
            .into_response();
    }

    if action == "status" || action == "validate" {
        let target = get("email")
            .map(|e| e.trim().to_lowercase())
            .unwrap_or_default();
        if target.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'email' wajib diisi untuk action=status" })),
            )
                .into_response();
        }
        let result = validate_status(&target).await;
        return Json(json!({ "status": result.get("success").and_then(|s| s.as_bool()).unwrap_or(false), "result": result })).into_response();
    }

    if action == "delete" || action == "del" {
        let target = get("email")
            .map(|e| e.trim().to_lowercase())
            .unwrap_or_default();
        if target.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'email' wajib diisi untuk action=delete" })),
            )
                .into_response();
        }
        let result = delete_mail(&target, get("id").as_deref()).await;
        return Json(json!({ "status": result.get("success").and_then(|s| s.as_bool()).unwrap_or(false), "result": result })).into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "message": format!("Aksi tidak dikenal: '{action}'. Pilihan: {}", ACTIONS.join(", ")) })),
    )
        .into_response()
}

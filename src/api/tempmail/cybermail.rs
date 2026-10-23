// cybermail — native conversion of api/tempmail/cybermail.js
// CyberMail (cybermail.us): create email, inbox + OTP extract, message, domains, delete.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_BASE: &str = "https://api.cybermail.us";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const WORDLIST: [&str; 30] = [
    "cyber", "retro", "neon", "pixel", "hack", "code", "tech", "digital", "matrix", "quantum",
    "synth", "wave", "glow", "volt", "echo", "nova", "flux", "byte", "data", "core", "alpha",
    "beta", "gamma", "delta", "omega", "prime", "nexus", "vertex", "axis", "grid",
];

const FALLBACK_DOMAINS: [&str; 5] = [
    "cybermail.us",
    "cybermail.biz.id",
    "cybermail.my.id",
    "cyber-mail.site",
    "cybermail.web.id",
];

const ACTIONS: [&str; 5] = ["create", "inbox", "message", "domains", "delete"];

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
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
                let idx = text[i..].char_indices().next().map(|(r, _)| r).unwrap_or(0);
                let end = j;
                let before_start = lower
                    .char_indices()
                    .rev()
                    .skip_while(|(ci, _)| *ci >= i)
                    .take(80)
                    .last()
                    .map(|(ci, _)| ci)
                    .unwrap_or(0);
                let before = &lower[before_start..i];
                let after = &lower[end..(end + 40).min(lower.len())];
                let near = format!("{before} {after}");
                if i > 0 && bytes[i - 1] == b'#' {
                    i = j;
                    continue;
                }
                if negatives.iter().any(|n| near.contains(n)) {
                    i = j;
                    continue;
                }
                if triggers.iter().any(|t| near.contains(t)) && (otp.is_none() || len == 6) {
                    otp = Some(text[i..idx + len].to_string());
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    otp
}

async fn get_domains() -> Vec<String> {
    if let Ok(c) = client() {
        if let Ok(res) = c
            .get(format!("{API_BASE}/api/domains"))
                        .header("Accept", "application/json")
            .send()
            .await
        {
            if let Ok(j) = res.json::<Value>().await {
                if j.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
                    let verified: Vec<String> = j
                        .get("data")
                        .and_then(|d| d.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter(|d| {
                                    d.get("verified").and_then(|v| v.as_bool()).unwrap_or(false)
                                })
                                .filter_map(|d| {
                                    d.get("name")
                                        .and_then(|n| n.as_str())
                                        .map(|s| s.to_string())
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if !verified.is_empty() {
                        return verified;
                    }
                }
            }
        }
    }
    FALLBACK_DOMAINS.iter().map(|s| s.to_string()).collect()
}

async fn generate_email(custom_user: &str, custom_domain: &str) -> Value {
    let domains = get_domains().await;
    let mut domain = custom_domain.trim().to_lowercase();
    if domain.is_empty() || !domains.contains(&domain) {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as usize;
        domain = domains[seed % domains.len()].clone();
    }
    let cleaned: String = custom_user
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let username = if cleaned.is_empty() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as usize;
        format!("{}{}", WORDLIST[seed % WORDLIST.len()], seed % 999 + 1)
    } else {
        cleaned
    };
    let email = format!("{username}@{domain}");
    json!({
        "email": email,
        "username": username,
        "domain": domain,
        "available_domains": domains,
        "created_at": chrono::Utc::now().to_rfc3339(),
    })
}

async fn fetch_inbox_raw(email: &str) -> Result<Vec<Value>, String> {
    let res = client()?
        .get(format!(
            "{API_BASE}/api/inbox/{}",
            urlencoding::encode(email)
        ))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Gagal mengambil inbox: HTTP {}", res.status()));
    }
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    let raw = j
        .pointer("/data/emails")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(raw
        .iter()
        .map(|e| {
            let subject = e.get("subject").and_then(|s| s.as_str()).unwrap_or("");
            let body = e.get("body").and_then(|s| s.as_str()).unwrap_or("");
            json!({
                "id": e.get("id").cloned().unwrap_or(Value::Null),
                "from": e.get("from").cloned().unwrap_or(Value::Null),
                "subject": e.get("subject").cloned().unwrap_or(Value::Null),
                "otp": extract_otp(subject, body),
                "received_at": e.get("received_at").cloned().unwrap_or(Value::Null),
                "expires_in": e.get("expires_in").cloned().unwrap_or(Value::Null),
                "is_read": e.get("is_read").cloned().unwrap_or(Value::Null),
                "body": body,
                "html": e.get("html").cloned().unwrap_or(Value::Null),
            })
        })
        .collect())
}

async fn wait_for_inbox(email: &str, max_wait_seconds: u64) -> Vec<Value> {
    let max_wait = max_wait_seconds.clamp(5, 60);
    let start = std::time::Instant::now();
    while start.elapsed().as_secs() < max_wait {
        let emails = fetch_inbox_raw(email).await.unwrap_or_default();
        if !emails.is_empty() {
            return emails;
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
    Vec::new()
}

async fn fetch_message(email: &str, id: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!(
            "{API_BASE}/api/inbox/{}/{}",
            urlencoding::encode(email),
            urlencoding::encode(id)
        ))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() || !j.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        return Err(j
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or(&format!("Pesan ID \"{id}\" tidak ditemukan"))
            .to_string());
    }
    let e = j.get("data").cloned().unwrap_or(json!({}));
    let subject = e.get("subject").and_then(|s| s.as_str()).unwrap_or("");
    let body = e.get("body").and_then(|s| s.as_str()).unwrap_or("");
    Ok(json!({
        "id": e.get("id").cloned().unwrap_or(Value::Null),
        "from": e.get("from").cloned().unwrap_or(Value::Null),
        "subject": e.get("subject").cloned().unwrap_or(Value::Null),
        "otp": extract_otp(subject, body),
        "received_at": e.get("received_at").cloned().unwrap_or(Value::Null),
        "body": body,
        "html": e.get("html").cloned().unwrap_or(Value::Null),
    }))
}

async fn delete_mail(email: &str, id: Option<&str>) -> Value {
    let url = match id {
        Some(i) => format!(
            "{API_BASE}/api/inbox/{}/{}",
            urlencoding::encode(email),
            urlencoding::encode(i)
        ),
        None => format!("{API_BASE}/api/inbox/{}", urlencoding::encode(email)),
    };
    let res = client()
        .map(|c| c.delete(&url)            .header("Accept", "application/json").send())
        .ok();
    let (ok, msg) = match res {
        Some(fut) => match fut.await {
            Ok(r) => {
                let ok = r.status().is_success();
                let msg = r.json::<Value>().await.ok().and_then(|j| {
                    j.get("message")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                });
                (
                    ok,
                    msg.unwrap_or(if ok {
                        "Berhasil dihapus".into()
                    } else {
                        "Gagal menghapus".into()
                    }),
                )
            }
            Err(_) => (false, "Gagal menghapus".to_string()),
        },
        None => (false, "Gagal menghapus".to_string()),
    };
    json!({
        "success": ok,
        "target": id.map(|i| json!(format!("message_{i}"))).unwrap_or(json!("entire_inbox")),
        "message": msg,
    })
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

    // 1. Create
    if action == "create" || action == "generate" || action == "new" {
        let data = generate_email(
            get("username").as_deref().unwrap_or(""),
            get("domain").as_deref().unwrap_or(""),
        )
        .await;
        return Json(json!({ "status": true, "result": data })).into_response();
    }

    // 2. Inbox
    if action == "inbox" || action == "check" || action == "messages" {
        let target = get("email")
            .or_else(|| get("query"))
            .map(|e| e.trim().to_lowercase())
            .unwrap_or_default();
        if target.is_empty() || !target.contains('@') {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'email' valid wajib diisi untuk action=inbox" })),
            )
                .into_response();
        }
        let wait_seconds = get("wait").and_then(|w| w.parse::<u64>().ok()).unwrap_or(0);
        let emails = if wait_seconds > 0 {
            wait_for_inbox(&target, wait_seconds).await
        } else {
            fetch_inbox_raw(&target).await.unwrap_or_default()
        };
        return Json(
            json!({ "status": true, "email": target, "count": emails.len(), "result": emails }),
        )
        .into_response();
    }

    // 3. Message detail
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
        return match fetch_message(&target, &msg_id).await {
            Ok(data) => Json(json!({ "status": true, "result": data })).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    // 4. Domains
    if action == "domains" {
        let domains = get_domains().await;
        return Json(json!({ "status": true, "total": domains.len(), "result": domains }))
            .into_response();
    }

    // 5. Delete
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
        let data = delete_mail(&target, get("id").as_deref()).await;
        return Json(json!({ "status": data.get("success").and_then(|s| s.as_bool()).unwrap_or(false), "result": data })).into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "message": format!("Action '{action}' tidak valid. Pilihan: {}", ACTIONS.join(", ")) })),
    )
        .into_response()
}

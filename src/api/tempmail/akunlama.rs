// akunlama — native conversion of api/tempmail/akunlama.js
// akunlama.com list/getKey/getHtml API. Session state persisted to data/session/.
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

const BASE_URL: &str = "https://akunlama.com/api";
const DOMAIN: &str = "akunlama.com";
const MAX_AGE_MS: u64 = 60 * 60 * 1000;

const ADJECTIVES: [&str; 12] = [
    "happy", "sleepy", "clever", "swift", "brave", "calm", "wild", "gentle", "lucky", "proud",
    "cozy", "fuzzy",
];
const ANIMALS: [&str; 10] = [
    "kitten", "cat", "tiger", "lion", "panther", "cheetah", "lynx", "puma", "jaguar", "leopard",
];

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

fn rand_us(seed: &mut u64, max: usize) -> usize {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    (*seed as usize) % max
}

fn generate_random_name() -> String {
    let mut seed = now_ms();
    let adj = ADJECTIVES[rand_us(&mut seed, ADJECTIVES.len())];
    let animal = ANIMALS[rand_us(&mut seed, ANIMALS.len())];
    let num = rand_us(&mut seed, 900) + 100;
    format!("{adj}-{animal}-{num}")
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

async fn request_json(target_url: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120")
        .build()
        .map_err(|e| e.to_string())?;
    let text = client
        .get(target_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

fn clean_recipient(email_or_username: &str) -> String {
    email_or_username
        .trim()
        .trim_end_matches(DOMAIN)
        .trim_end_matches('@')
        .trim()
        .to_string()
}

fn strip_html(html: &str) -> String {
    let mut s = html.to_string();
    // remove style/script blocks crudely
    while let Some(start) = s.find("<style") {
        if let Some(rel) = s[start..].find("</style>") {
            s.replace_range(start..start + rel + 8, "");
        } else {
            break;
        }
    }
    while let Some(start) = s.find("<script") {
        if let Some(rel) = s[start..].find("</script>") {
            s.replace_range(start..start + rel + 9, "");
        } else {
            break;
        }
    }
    let s = s
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n\n")
        .replace("</div>", "\n");
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace('\r', "");
    // collapse 3+ newlines
    let mut collapsed = String::new();
    let mut nl = 0;
    for c in out.chars() {
        if c == '\n' {
            nl += 1;
            if nl <= 2 {
                collapsed.push(c);
            }
        } else {
            nl = 0;
            collapsed.push(c);
        }
    }
    collapsed.trim().to_string()
}

fn extract_otp(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    let lower = text.to_lowercase();
    let triggers = ["otp", "code", "verification", "kode", "verifikasi"];
    // labeled: (otp|code|...)[\s:=#-]+digits
    let chars: Vec<char> = text.chars().collect();
    let bytes = text.as_bytes();
    let _ = chars;
    let mut best: Option<String> = None;
    for trigger in triggers {
        let t = match lower.find(trigger) {
            Some(i) => i,
            None => continue,
        };
        // scan forward for separator run then digits
        let rest = &text[t + trigger.len()..];
        let trimmed = rest.trim_start_matches(|c: char| " :=#-\n\t".contains(c));
        let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 4 && digits.len() <= 8 {
            return Some(digits);
        }
    }
    // standalone 4-8 digit number (not a year)
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            let candidate = &text[i..j];
            let year_like = (candidate == "19"
                || candidate.starts_with("19")
                    && candidate.len() == 4
                    && candidate
                        .parse::<u32>()
                        .map(|n| (1900..=1999).contains(&n))
                        .unwrap_or(false))
                || (candidate.len() == 4
                    && candidate
                        .parse::<u32>()
                        .map(|n| (2000..=2099).contains(&n))
                        .unwrap_or(false)
                    && candidate.starts_with("20"));
            if !year_like {
                best = Some(candidate.to_string());
                break;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    best
}

fn extract_links(html: &str) -> Vec<String> {
    let mut links = Vec::new();
    let bytes = html.as_bytes();
    let mut i = 0;
    while i + 6 <= bytes.len() {
        if &html[i..i + 6] == "href=\"" || &html[i..i + 6] == "href='" {
            let start = i + 6;
            let quote = bytes[i + 5];
            if let Some(end) = html[start..].find(quote as char) {
                let url = html[start..start + end].replace("&amp;", "&");
                if url.starts_with("http://") || url.starts_with("https://") {
                    if !links.contains(&url) {
                        links.push(url);
                    }
                }
                i = start + end + 1;
                continue;
            }
        }
        i += 1;
    }
    links
}

fn parse_timestamp(ts: Option<u64>) -> Value {
    match ts {
        Some(t) => {
            let millis = if t > 100_000_000_000 { t } else { t * 1000 };
            chrono::DateTime::from_timestamp_millis(millis as i64)
                .map(|d| json!(d.to_rfc3339()))
                .unwrap_or(Value::Null)
        }
        None => Value::Null,
    }
}

async fn list_inbox(username: &str) -> Vec<Value> {
    let recipient = clean_recipient(username);
    let res = request_json(&format!(
        "{BASE_URL}/list?recipient={}",
        urlencoding::encode(&recipient)
    ))
    .await
    .unwrap_or(Value::Null);
    res.as_array().cloned().unwrap_or_default()
}

async fn get_email_detail(region: &str, key: &str) -> Value {
    let meta_url = format!(
        "{BASE_URL}/getKey?region={}&key={}",
        urlencoding::encode(region),
        urlencoding::encode(key)
    );
    let html_url = format!(
        "{BASE_URL}/getHtml?region={}&key={}",
        urlencoding::encode(region),
        urlencoding::encode(key)
    );
    let (meta_fut, html_fut) = (request_json(&meta_url), request_json(&html_url));
    let (meta, html) = tokio::join!(meta_fut, html_fut);
    let raw_html = match html {
        Ok(Value::String(s)) => s,
        Ok(other) => other.to_string(),
        Err(_) => String::new(),
    };
    let text_content = strip_html(&raw_html);
    let links = extract_links(&raw_html);
    let possible_otp = extract_otp(&text_content);
    json!({
        "meta": meta.unwrap_or(Value::Null),
        "html": raw_html,
        "text": text_content,
        "links": links,
        "possibleOtp": possible_otp,
    })
}

async fn create_mail(session_id: &str, custom_user: Option<&str>) -> Value {
    let username = match custom_user.map(|u| u.trim()).filter(|u| !u.is_empty()) {
        Some(u) => clean_recipient(u),
        None => generate_random_name(),
    };
    let expires_at = now_ms() + MAX_AGE_MS;
    save_session(
        &format!("akunlama_{session_id}.json"),
        &json!({
            "email": format!("{username}@{DOMAIN}"),
            "username": username,
            "seenMessages": [],
            "createdAt": now_ms(),
            "expiresAt": expires_at,
        }),
    );
    json!({
        "email": format!("{username}@{DOMAIN}"),
        "username": username,
        "domain": DOMAIN,
        "inboxCount": 0,
        "createdAt": now_ms(),
        "expiresAt": expires_at,
        "timeRemaining": MAX_AGE_MS,
        "timeRemainingHuman": format_time_remaining(MAX_AGE_MS as i64),
        "note": "Email akan otomatis expired setelah 60 menit",
    })
}

fn check_session(session_id: &str) -> Result<Value, String> {
    let s =
        load_session(&format!("akunlama_{session_id}.json")).ok_or("Session tidak ditemukan")?;
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    if now_ms() > expires_at {
        remove_session(&format!("akunlama_{session_id}.json"));
        return Err("Email sementara telah kedaluwarsa (maksimal 60 menit)".to_string());
    }
    Ok(s)
}

async fn check_inbox(session_id: &str) -> Result<Value, String> {
    let s = check_session(session_id)?;
    let username = s
        .get("username")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let email = s
        .get("email")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let created = s.get("createdAt").cloned().unwrap_or(Value::Null);
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);

    let messages = list_inbox(&username).await;
    let formatted: Vec<Value> = messages
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            json!({
                "index": idx + 1,
                "id": m.pointer("/storage/key").cloned().unwrap_or(Value::Null),
                "region": m.pointer("/storage/region").and_then(|r| r.as_str()).unwrap_or("us"),
                "from": m.pointer("/message/headers/from").or_else(|| m.get("sender")).cloned().unwrap_or(Value::Null),
                "subject": m.pointer("/message/headers/subject").or_else(|| m.get("preview")).cloned().unwrap_or(json!("(No Subject)")),
                "date": parse_timestamp(m.get("timestamp").and_then(|t| t.as_u64())),
            })
        })
        .collect();
    let seen: Vec<Value> = messages
        .iter()
        .filter_map(|m| m.pointer("/storage/key").cloned())
        .collect();
    save_session(
        &format!("akunlama_{session_id}.json"),
        &json!({
            "email": email,
            "username": username,
            "seenMessages": seen,
            "createdAt": created,
            "expiresAt": expires_at,
        }),
    );

    Ok(json!({
        "email": email,
        "total": formatted.len(),
        "messages": formatted,
        "createdAt": created,
        "expiresAt": expires_at,
        "timeRemaining": expires_at.saturating_sub(now_ms()),
        "timeRemainingHuman": format_time_remaining(expires_at as i64 - now_ms() as i64),
    }))
}

fn format_from(detail: &Value, fallback: Value) -> Value {
    let meta = detail.get("meta").cloned().unwrap_or(Value::Null);
    let name = meta.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let addr = meta
        .get("emailAddress")
        .and_then(|a| a.as_str())
        .unwrap_or("");
    if !name.is_empty() && !addr.is_empty() {
        json!(format!("{name} <{addr}>"))
    } else if !addr.is_empty() {
        json!(addr)
    } else {
        fallback
    }
}

async fn read_message(session_id: &str, index_or_key: &str) -> Result<Value, String> {
    let s = check_session(session_id)?;
    let username = s
        .get("username")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let email = s
        .get("email")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();

    let messages = list_inbox(&username).await;
    if messages.is_empty() {
        return Err(format!("Mailbox {email} is empty"));
    }
    let mut selected: Option<(usize, Value)> = None;
    if let Ok(parsed) = index_or_key.parse::<usize>() {
        if parsed > 0 && parsed <= messages.len() {
            selected = Some((parsed, messages[parsed - 1].clone()));
        }
    }
    if selected.is_none() {
        if let Some(found) = messages
            .iter()
            .enumerate()
            .find(|(_, m)| m.pointer("/storage/key").and_then(|k| k.as_str()) == Some(index_or_key))
        {
            selected = Some((found.0 + 1, found.1.clone()));
        }
    }
    let (target_index, sel) = selected.ok_or_else(|| {
        format!(
            "Message '{index_or_key}' not found. Available index: 1..{}",
            messages.len()
        )
    })?;

    let region = sel
        .pointer("/storage/region")
        .and_then(|r| r.as_str())
        .unwrap_or("us")
        .to_string();
    let key = sel
        .pointer("/storage/key")
        .and_then(|k| k.as_str())
        .unwrap_or("")
        .to_string();
    let detail = get_email_detail(&region, &key).await;

    Ok(json!({
        "email": email,
        "data": {
            "index": target_index,
            "id": key,
            "region": region,
            "from": format_from(&detail, Value::Null),
            "to": detail.pointer("/meta/recipients").cloned().unwrap_or(json!(email)),
            "subject": detail.pointer("/meta/subject").cloned().unwrap_or(json!("(No Subject)")),
            "date": detail.pointer("/meta/Date").cloned().unwrap_or(parse_timestamp(sel.get("timestamp").and_then(|t| t.as_u64()))),
            "otp": detail.get("possibleOtp").cloned().unwrap_or(Value::Null),
            "links": detail.get("links").cloned().unwrap_or(json!([])),
            "text": detail.get("text").cloned().unwrap_or(Value::Null),
            "html": detail.get("html").cloned().unwrap_or(Value::Null),
        }
    }))
}

async fn dump_messages(session_id: &str) -> Result<Value, String> {
    let s = check_session(session_id)?;
    let username = s
        .get("username")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let email = s
        .get("email")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();

    let list = list_inbox(&username).await;
    let mut full_data: Vec<Value> = Vec::new();
    for (i, item) in list.iter().enumerate() {
        let region = item
            .pointer("/storage/region")
            .and_then(|r| r.as_str())
            .unwrap_or("us")
            .to_string();
        let key = item
            .pointer("/storage/key")
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string();
        if key.is_empty() {
            continue;
        }
        let detail = get_email_detail(&region, &key).await;
        full_data.push(json!({
            "index": i + 1,
            "id": key,
            "region": region,
            "from": format_from(&detail, item.pointer("/message/headers/from").cloned().unwrap_or(Value::Null)),
            "to": detail.pointer("/meta/recipients").cloned().unwrap_or(json!(email)),
            "subject": detail.pointer("/meta/subject").cloned()
                .or_else(|| item.pointer("/message/headers/subject").cloned())
                .or_else(|| item.get("preview").cloned())
                .unwrap_or(json!("(No Subject)")),
            "date": detail.pointer("/meta/Date").cloned().unwrap_or(parse_timestamp(item.get("timestamp").and_then(|t| t.as_u64()))),
            "otp": detail.get("possibleOtp").cloned().unwrap_or(Value::Null),
            "links": detail.get("links").cloned().unwrap_or(json!([])),
            "text": detail.get("text").cloned().unwrap_or(Value::Null),
            "html": detail.get("html").cloned().unwrap_or(Value::Null),
        }));
    }
    Ok(json!({ "email": email, "total": full_data.len(), "messages": full_data }))
}

async fn monitor_mail(session_id: &str) -> Result<Value, String> {
    let s = check_session(session_id)?;
    let username = s
        .get("username")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let email = s
        .get("email")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let created = s.get("createdAt").cloned().unwrap_or(Value::Null);
    let expires_at = s.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0);
    let seen: Vec<Value> = s
        .get("seenMessages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let messages = list_inbox(&username).await;
    let mut new_messages: Vec<Value> = Vec::new();
    let mut new_seen = seen.clone();
    for msg in &messages {
        let key = msg
            .pointer("/storage/key")
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string();
        if !key.is_empty() && !new_seen.contains(&json!(key)) {
            new_seen.push(json!(key));
            let region = msg
                .pointer("/storage/region")
                .and_then(|r| r.as_str())
                .unwrap_or("us")
                .to_string();
            let detail = get_email_detail(&region, &key).await;
            new_messages.push(json!({
                "id": key,
                "region": region,
                "from": format_from(&detail, msg.pointer("/message/headers/from").cloned().unwrap_or(Value::Null)),
                "subject": detail.pointer("/meta/subject").cloned()
                    .or_else(|| msg.pointer("/message/headers/subject").cloned())
                    .or_else(|| msg.get("preview").cloned())
                    .unwrap_or(json!("(No Subject)")),
                "links": detail.get("links").cloned().unwrap_or(json!([])),
                "otp": detail.get("possibleOtp").cloned().unwrap_or(Value::Null),
                "text": detail.get("text").cloned().unwrap_or(Value::Null),
                "html": detail.get("html").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    save_session(
        &format!("akunlama_{session_id}.json"),
        &json!({
            "email": email,
            "username": username,
            "seenMessages": new_seen,
            "createdAt": created,
            "expiresAt": expires_at,
        }),
    );
    Ok(json!({ "email": email, "newMessages": new_messages, "inboxCount": messages.len() }))
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
    let session_id = match get("sessionId").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'sessionId' wajib diisi dan harus string", "code": "MISSING_SESSION_ID" })),
            )
                .into_response()
        }
    };
    let action = match get("action") {
        Some(a) if ["create", "inbox", "read", "dump", "monitor"].contains(&a.as_str()) => a,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "status": false, "message": "Parameter 'action' harus 'create', 'inbox', 'read', 'dump', atau 'monitor'", "code": "INVALID_ACTION" })),
            )
                .into_response()
        }
    };

    let result: Result<Value, String> = match action.as_str() {
        "create" => Ok(create_mail(&session_id, get("user").as_deref()).await),
        "inbox" => check_inbox(&session_id).await,
        "read" => match get("messageId").filter(|m| !m.trim().is_empty()) {
            Some(mid) => read_message(&session_id, mid.trim()).await,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "status": false, "message": "Parameter 'messageId' wajib diisi untuk action=read (index 1..n atau key pesan)", "code": "MISSING_MESSAGE_ID" })),
                )
                    .into_response()
            }
        },
        "dump" => dump_messages(&session_id).await,
        _ => monitor_mail(&session_id).await,
    };

    match result {
        Ok(r) => Json(json!({
            "status": true,
            "action": action,
            "sessionId": session_id,
            "result": r,
            "processingTimeMs": start.elapsed().as_millis(),
        }))
        .into_response(),
        Err(e) => {
            let (status, code, message) = if e.contains("Session tidak ditemukan") {
                (
                    StatusCode::NOT_FOUND,
                    "SESSION_NOT_FOUND",
                    "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create"
                        .to_string(),
                )
            } else if e.contains("kedaluwarsa") {
                (StatusCode::GONE, "EMAIL_EXPIRED", "Email sementara telah kedaluwarsa (maksimal 60 menit). Buat email baru dengan action=create".to_string())
            } else if e.contains("not found") || e.contains("is empty") {
                (StatusCode::NOT_FOUND, "MESSAGE_NOT_FOUND", e)
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, "AKUNLAMA_ERROR", e)
            };
            (
                status,
                Json(json!({
                    "status": false,
                    "message": message,
                    "code": code,
                    "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                })),
            )
                .into_response()
        }
    }
}

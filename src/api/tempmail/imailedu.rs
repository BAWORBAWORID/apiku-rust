// imailedu — native conversion of api/tempmail/imailedu.js
// imail.edu.vn Livewire tempmail (create / inbox / domains). Session cookies persisted
// to data/session/imailedu_<email>.json (30-minute TTL).
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

const BASE_URL: &str = "https://imail.edu.vn";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const SESSION_TTL_MS: u64 = 30 * 60 * 1000;

const AVAILABLE_DOMAINS: [&str; 12] = [
    "imail.edu.vn",
    "gddp2018.edu.vn",
    "mailo.edu.pl",
    "nik.edu.pl",
    "apple.edu.pl",
    "itmo.edu.pl",
    "mailer.edu.pl",
    "jakarta.io.vn",
    "newdelhi.io.vn",
    "mailer.io.vn",
    "newyork.io.vn",
    "dulieu.io.vn",
];

fn session_path(name: &str) -> PathBuf {
    let dir = PathBuf::from("data/session");
    let _ = fs::create_dir_all(&dir);
    dir.join(name)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn save_cookie(email: &str, session: &str) {
    let key = email.to_lowercase();
    let _ = fs::write(
        session_path(&format!("imailedu_{key}.json")),
        json!({ "session": session, "expiresAt": now_ms() + SESSION_TTL_MS }).to_string(),
    );
}

fn get_cookie(email: &str) -> Option<String> {
    let key = email.to_lowercase();
    let raw = fs::read_to_string(session_path(&format!("imailedu_{key}.json"))).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    if now_ms() < v.get("expiresAt").and_then(|e| e.as_u64()).unwrap_or(0) {
        v.get("session")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
    } else {
        let _ = fs::remove_file(session_path(&format!("imailedu_{key}.json")));
        None
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())
}

fn parse_cookie_headers(res: &reqwest::Response) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for v in res.headers().get_all("set-cookie") {
        if let Ok(s) = v.to_str() {
            let first = s.split(';').next().unwrap_or("");
            if let Some(eq) = first.find('=') {
                let (k, val) = (first[..eq].trim(), first[eq + 1..].trim());
                let kl = k.to_lowercase();
                if !k.is_empty()
                    && !val.is_empty()
                    && !matches!(kl.as_str(), "path" | "expires" | "max-age" | "samesite")
                {
                    out.push((k.to_string(), val.to_string()));
                }
            }
        }
    }
    out
}

fn build_cookie_string(cookies: &[(String, String)]) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn extract_livewire_component(html: &str, component_name: &str) -> Option<Value> {
    let marker = "wire:initial-data=\"";
    let mut idx = 0;
    while let Some(pos) = html[idx..].find(marker) {
        let abs = idx + pos + marker.len();
        let end = html[abs..].find('"')?;
        let raw = html[abs..abs + end].replace("&quot;", "\"");
        idx = abs + end;
        if let Ok(d) = serde_json::from_str::<Value>(&raw) {
            if d.pointer("/fingerprint/name").and_then(|n| n.as_str()) == Some(component_name) {
                return Some(d);
            }
        }
    }
    None
}

async fn create_email(
    custom_user: Option<&str>,
    custom_domain: Option<&str>,
) -> Result<Value, String> {
    let c = client()?;
    let r1 = c.get(BASE_URL).send().await.map_err(|e| e.to_string())?;
    if !r1.status().is_success() {
        return Err(format!(
            "Gagal menghubungi server imail.edu.vn (HTTP {})",
            r1.status()
        ));
    }
    let mut cookie_map = parse_cookie_headers(&r1);
    let html = r1.text().await.map_err(|e| e.to_string())?;

    let csrf = html
        .find("<meta name=\"csrf-token\" content=\"")
        .and_then(|i| {
            let start = i + 33;
            html[start..]
                .find('"')
                .map(|e| html[start..start + e].to_string())
        })
        .or_else(|| {
            html.find("name=\"_token\"").and_then(|i| {
                let seg = &html[i..];
                let m = "value=\"";
                seg.find(m).and_then(|j| {
                    let start = j + m.len();
                    seg[start..]
                        .find('"')
                        .map(|e| seg[start..start + e].to_string())
                })
            })
        });
    let component = extract_livewire_component(&html, "frontend.actions");
    if component.is_none() || csrf.is_none() {
        return Err("Gagal menginisialisasi komponen Livewire dari imail.edu.vn".to_string());
    }
    let component = component.unwrap();
    let csrf = csrf.unwrap();

    let mut seed = now_ms();
    let user = match custom_user.map(|u| u.trim()).filter(|u| !u.is_empty()) {
        Some(u) => u.to_string(),
        None => {
            // random base36-ish, like Math.random().toString(36).substring(2,10)
            const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
            (0..8)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    CHARS[(seed as usize) % CHARS.len()] as char
                })
                .collect()
        }
    };
    let mut domain = custom_domain
        .map(|d| d.trim().to_string())
        .unwrap_or_default();
    if domain.is_empty() || !AVAILABLE_DOMAINS.contains(&domain.as_str()) {
        use std::time::{SystemTime, UNIX_EPOCH};
        let s = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as usize;
        domain = AVAILABLE_DOMAINS[s % AVAILABLE_DOMAINS.len()].to_string();
    }

    let payload = json!({
        "fingerprint": component.get("fingerprint").cloned().unwrap_or(json!({})),
        "serverMemo": component.get("serverMemo").cloned().unwrap_or(json!({})),
        "updates": [
            { "type": "syncInput", "payload": { "id": "u1", "name": "user", "value": user } },
            { "type": "syncInput", "payload": { "id": "u2", "name": "domain", "value": domain } },
            { "type": "callMethod", "payload": { "id": "test1", "method": "create", "params": [] } },
        ],
    });

    let r2 = c
        .post(format!("{BASE_URL}/livewire/message/frontend.actions"))
                    .header("Content-Type", "application/json")
                    .header("X-Livewire", "true")
        .header("X-CSRF-TOKEN", &csrf)
        .header("Cookie", build_cookie_string(&cookie_map))
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r2.status().is_success() {
        return Err(format!(
            "Gagal membuat email melalui Livewire (HTTP {})",
            r2.status()
        ));
    }
    cookie_map.extend(parse_cookie_headers(&r2));
    let res_data: Value = r2.json().await.map_err(|e| e.to_string())?;
    let email = res_data
        .pointer("/serverMemo/data/email")
        .and_then(|e| e.as_str())
        .map(|s| s.to_string())
        .unwrap_or(format!("{user}@{domain}"));
    let full_session = build_cookie_string(&cookie_map);
    save_cookie(&email, &full_session);

    Ok(json!({
        "email": email,
        "user": user,
        "domain": domain,
        "session": full_session,
        "token": cookie_map.iter().find(|(k, _)| k == "_session").map(|(_, v)| v.clone()),
    }))
}

async fn check_inbox(session_string: &str) -> Result<Value, String> {
    if session_string.is_empty() {
        return Err("Parameter 'session' wajib disertakan untuk mengecek inbox".to_string());
    }
    let cookie_str = if session_string.contains('=') {
        session_string.to_string()
    } else {
        format!("_session={session_string}")
    };
    let c = client()?;
    let r = c
        .get(format!("{BASE_URL}/mailbox"))
        .header("Cookie", cookie_str)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!(
            "Gagal memuat kotak masuk dari server imail.edu.vn (HTTP {})",
            r.status()
        ));
    }
    let html = r.text().await.map_err(|e| e.to_string())?;
    let component = extract_livewire_component(&html, "frontend.app")
        .ok_or("Gagal memuat pesan dari sesi yang diberikan atau sesi telah kedaluwarsa.")?;
    let data = component
        .pointer("/serverMemo/data")
        .cloned()
        .ok_or("Gagal memuat pesan dari sesi yang diberikan atau sesi telah kedaluwarsa.")?;
    let empty = Vec::new();
    let messages = data
        .get("messages")
        .and_then(|m| m.as_array())
        .unwrap_or(&empty);

    Ok(json!({
        "email": data.get("email").cloned().unwrap_or(Value::Null),
        "total": messages.len(),
        "messages": messages.iter().map(|msg| json!({
            "id": msg.get("id").or_else(|| msg.get("uid")).cloned().unwrap_or(Value::Null),
            "from": msg.get("from").or_else(|| msg.get("sender")).cloned().unwrap_or(json!("Unknown")),
            "subject": msg.get("subject").and_then(|s| if s.is_null() { None } else { Some(json!(s)) }).unwrap_or(json!("(No Subject)")),
            "date": msg.get("date").or_else(|| msg.get("created_at")).and_then(|d| if d.is_null() { None } else { Some(json!(d)) }).unwrap_or(json!(chrono::Utc::now().to_rfc3339())),
            "body": msg.get("body").or_else(|| msg.get("content")).or_else(|| msg.get("text")).cloned().unwrap_or(Value::Null),
        })).collect::<Vec<_>>(),
    }))
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
        return Json(json!({ "status": true, "action": "domains", "total": AVAILABLE_DOMAINS.len(), "result": AVAILABLE_DOMAINS }))
            .into_response();
    }

    if action == "create" {
        let custom_user = get("sessionId")
            .or_else(|| get("name"))
            .or_else(|| get("username"));
        let custom_domain = get("domain");
        return match create_email(custom_user.as_deref(), custom_domain.as_deref()).await {
            Ok(result) => {
                let user = result
                    .get("user")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string();
                let domain = result
                    .get("domain")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string();
                Json(json!({
                    "status": true,
                    "action": "create",
                    "sessionId": user,
                    "result": {
                        "email": result.get("email").cloned().unwrap_or(Value::Null),
                        "username": user,
                        "domain": domain,
                        "expiresIn": "30 Menit (Otomatis tersimpan di memori lokal untuk cek inbox)",
                        "session": result.get("session").cloned().unwrap_or(Value::Null),
                        "note": format!("Untuk mengecek inbox, cukup gunakan action=inbox&sessionId={user}&domain={domain} atau action=inbox&sessionId={user}"),
                    }
                }))
                .into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    if action == "inbox" {
        let sess = get("session")
            .or_else(|| get("token"))
            .or_else(|| get("cookie"));
        let identifier = get("sessionId")
            .or_else(|| get("email"))
            .or_else(|| get("name"))
            .or_else(|| get("username"));

        let sess = match sess {
            Some(s) if !s.is_empty() => Some(s),
            _ => match identifier.as_deref() {
                Some(ident) => {
                    let mut found = get_cookie(ident);
                    if found.is_none() && !ident.contains('@') {
                        found = get_cookie(&format!(
                            "{}@{}",
                            ident,
                            get("domain").unwrap_or_else(|| "imail.edu.vn".to_string())
                        ));
                    }
                    found
                }
                None => None,
            },
        };

        let sess = match sess {
            Some(s) => s,
            None => {
                let msg = match &identifier {
                    Some(id) => format!("Session untuk '{id}' tidak ditemukan di memori lokal atau telah kedaluwarsa (> 30 menit). Silakan buat email baru terlebih dahulu dengan action=create."),
                    None => "Parameter 'sessionId' (atau 'email' / 'session') wajib disertakan untuk mengecek inbox.".to_string(),
                };
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "status": false, "message": msg })),
                )
                    .into_response();
            }
        };

        return match check_inbox(&sess).await {
            Ok(result) => Json(json!({
                "status": true,
                "action": "inbox",
                "sessionId": identifier.unwrap_or_else(|| result.get("email").and_then(|e| e.as_str()).unwrap_or("local_cookie").to_string()),
                "result": result,
            }))
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "message": "Action tidak valid. Gunakan: create / inbox / domains" })),
    )
        .into_response()
}

// freetempmail — native conversion of api/tempmail/freetempmail.js
// free-temp-mail.eu.org (Livewire 3). Session (cookie+email) persisted to data/session/.
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

const BASE_URL: &str = "https://free-temp-mail.eu.org";
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

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())
}

fn collect_cookies(res: &reqwest::Response) -> String {
    let mut out: Vec<String> = Vec::new();
    for v in res.headers().get_all("set-cookie") {
        if let Ok(s) = v.to_str() {
            if let Some(first) = s.split(';').next() {
                if !first.trim().is_empty() {
                    out.push(first.trim().to_string());
                }
            }
        }
    }
    out.join("; ")
}

async fn create_email() -> Result<(String, String, String), String> {
    let c = client()?;
    // 1. homepage: csrf + initial livewire snapshot + cookies
    let init = c
        .get(BASE_URL)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let init_cookies = collect_cookies(&init);
    let html = init.text().await.map_err(|e| e.to_string())?;

    let csrf = html
        .find("<meta name=\"csrf-token\" content=\"")
        .and_then(|i| {
            let start = i + 33;
            html[start..]
                .find('"')
                .map(|e| html[start..start + e].to_string())
        })
        .unwrap_or_default();

    // wire:snapshot="..." ... wire:id="..."
    let snapshot = find_snapshot_pair(&html).ok_or_else(|| {
        "Gagal mengambil komponen Livewire awal dari server free-temp-mail.eu.org".to_string()
    })?;
    let raw_snapshot = snapshot.replace("&quot;", "\"");

    // 2. call deleteEmail to make a fresh random email
    let payload = json!({
        "_token": csrf,
        "components": [{
            "snapshot": raw_snapshot,
            "updates": {},
            "calls": [{ "path": "", "method": "deleteEmail", "params": [] }],
        }]
    });
    let create = c
        .post(format!("{BASE_URL}/livewire/update"))
                    .header("Content-Type", "application/json")
        .header("X-CSRF-TOKEN", &csrf)
                    .header("X-Livewire", "true")
        .header("Cookie", &init_cookies)
        .header("Origin", BASE_URL)
        .header("Referer", format!("{BASE_URL}/"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let updated_cookies = {
        let ck = collect_cookies(&create);
        if ck.is_empty() {
            init_cookies.clone()
        } else {
            ck
        }
    };
    let data: Value = create.json().await.map_err(|e| e.to_string())?;
    let comp = data
        .pointer("/components/0")
        .cloned()
        .ok_or("Gagal mendapatkan respons email acak dari server free-temp-mail.eu.org")?;
    let snap_str = comp
        .get("snapshot")
        .and_then(|s| s.as_str())
        .ok_or("Gagal mendapatkan respons email acak dari server free-temp-mail.eu.org")?;
    let parsed: Value = serde_json::from_str(snap_str).map_err(|e| e.to_string())?;
    let email_created = parsed
        .pointer("/data/email")
        .and_then(|e| e.as_str())
        .ok_or("Alamat email tidak ditemukan dalam respons komponen")?
        .to_string();

    Ok((email_created, updated_cookies, csrf))
}

fn find_snapshot_pair(html: &str) -> Option<String> {
    let marker = "wire:snapshot=\"";
    let idx = html.find(marker)?;
    let start = idx + marker.len();
    let end = html[start..].find('"')?;
    let _ = html[start..start + end].find("wire:id");
    Some(html[start..start + end].to_string())
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
                Json(json!({ "status": false, "message": "Parameter 'sessionId' wajib diisi", "code": "MISSING_SESSION_ID" })),
            )
                .into_response()
        }
    };
    let action = get("action")
        .unwrap_or_else(|| "create".to_string())
        .to_lowercase();

    if action == "create" {
        return match create_email().await {
            Ok((email, cookie, csrf)) => {
                save_session(
                    &format!("fmail_{session_id}.json"),
                    &json!({ "cookie": cookie, "email": email, "csrfToken": csrf, "createdAt": start.elapsed().as_millis() as u64 + std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64 }),
                );
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                Json(json!({
                    "status": true,
                    "action": "create",
                    "sessionId": session_id,
                    "result": { "email": email, "sessionId": session_id, "expiresIn": "24 hours" },
                    "timestamp": now_ms,
                    "processingTimeMs": start.elapsed().as_millis(),
                }))
                .into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "status": false,
                    "message": e,
                    "code": "FMAIL_ERROR",
                    "metadata": { "processingTimeMs": start.elapsed().as_millis() }
                })),
            )
                .into_response(),
        };
    }

    if action == "inbox" || action == "check" {
        let sess = match load_session(&format!("fmail_{session_id}.json")) {
            Some(s) => s,
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({
                        "status": false,
                        "message": "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
                        "code": "SESSION_NOT_FOUND",
                    })),
                )
                    .into_response()
            }
        };
        let cookie = sess
            .get("cookie")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let stored_email = sess
            .get("email")
            .and_then(|e| e.as_str())
            .unwrap_or("")
            .to_string();

        let c = match client() {
            Ok(c) => c,
            Err(e) => return internal_err(&e.to_string(), &start),
        };
        let res = match c
            .get(format!("{BASE_URL}/mailbox"))
            .header("Cookie", &cookie)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return internal_err(&e.to_string(), &start),
        };
        let refreshed = collect_cookies(&res);
        let html = match res.text().await {
            Ok(h) => h,
            Err(e) => return internal_err(&e.to_string(), &start),
        };
        if !refreshed.is_empty() {
            let mut s2 = sess.clone();
            s2["cookie"] = json!(refreshed);
            save_session(&format!("fmail_{session_id}.json"), &s2);
        }

        // scan all wire:snapshot="..." attributes
        let mut messages_list: Value = json!([]);
        let mut current_email = stored_email;
        let marker = "wire:snapshot=\"";
        let mut idx = 0;
        while let Some(pos) = html[idx..].find(marker) {
            let abs = idx + pos + marker.len();
            let end = match html[abs..].find('"') {
                Some(e) => abs + e,
                None => break,
            };
            let raw = html[abs..end].replace("&quot;", "\"");
            idx = end;
            if let Ok(snap) = serde_json::from_str::<Value>(&raw) {
                if snap.pointer("/memo/name").and_then(|n| n.as_str()) == Some("frontend.app") {
                    if let Some(e) = snap.pointer("/data/email").and_then(|e| e.as_str()) {
                        current_email = e.to_string();
                    }
                    let msgs = snap.pointer("/data/messages");
                    if let Some(arr) = msgs.and_then(|m| m.as_array()) {
                        if arr.len() == 1 && arr[0].is_array() {
                            messages_list = arr[0].clone();
                        } else if !arr.is_empty() {
                            messages_list = json!(arr);
                        }
                    }
                }
            }
        }

        let count = messages_list.as_array().map(|a| a.len()).unwrap_or(0);
        return Json(json!({
            "status": true,
            "action": "inbox",
            "sessionId": session_id,
            "result": { "email": current_email, "count": count, "messages": messages_list },
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64,
            "processingTimeMs": start.elapsed().as_millis(),
        }))
        .into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        Json(json!({
            "status": false,
            "message": format!("Aksi '{action}' tidak valid. Gunakan action=create atau action=inbox."),
            "code": "INVALID_ACTION",
        })),
    )
        .into_response()
}

fn internal_err(e: &str, start: &std::time::Instant) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "status": false,
            "message": e,
            "code": "FMAIL_ERROR",
            "metadata": { "processingTimeMs": start.elapsed().as_millis() }
        })),
    )
        .into_response()
}

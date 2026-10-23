// tmailor — native conversion of api/tempmail/tmailor.js
// tmailor.com API. The Node version launched Puppeteer to read localStorage for the
// auto-generated email; pure HTTP cannot mint a fresh browser-side email, so
// action=create is not reproducible natively. inbox/custom/domains/delete are
// converted: the client supplies email+token (from create on the Node side or the
// site), session tokens persisted to data/session/.
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

const HOST: &str = "https://tmailor.com";
const EXPIRY_MS: u64 = 20 * 60 * 60 * 1000;

fn session_path(name: &str) -> PathBuf {
    let dir = PathBuf::from("data/session");
    let _ = fs::create_dir_all(&dir);
    dir.join(name)
}

fn load_token(email: &str) -> Option<Value> {
    let raw = fs::read_to_string(session_path(&format!(
        "tmailor_{}.json",
        email.to_lowercase()
    )))
    .ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let created = v.get("created").and_then(|c| c.as_u64()).unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    if now.saturating_sub(created) > EXPIRY_MS {
        let _ = fs::remove_file(session_path(&format!(
            "tmailor_{}.json",
            email.to_lowercase()
        )));
        return None;
    }
    Some(v)
}

fn save_token(email: &str, accesstoken: &str, fb_token: &str, curent_token: &str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let _ = fs::write(
        session_path(&format!("tmailor_{}.json", email.to_lowercase())),
        json!({ "accesstoken": accesstoken, "fbToken": fb_token, "curentToken": curent_token, "created": now }).to_string(),
    );
}

async fn api(payload: &Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{HOST}/api"))
                    .header("Content-Type", "application/json")
        .header("Origin", HOST)
        .header("Referer", format!("{HOST}/id/"))
        .json(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json::<Value>()
        .await
        .map_err(|_| "API error".to_string())
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
        None => {
            return bad(
                "Parameter 'action' wajib diisi (create / inbox / custom / domains / delete)",
            )
        }
    };

    if action == "create" {
        // The Node implementation relied on Puppeteer/localStorage. Without a
        // browser engine there is no way to mint a fresh browser-session email.
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "status": false, "message": "action=create butuh browser engine (Node versi memakai Puppeteer)" })),
        )
            .into_response();
    }

    if action == "inbox" {
        let email = match get("email").filter(|e| !e.trim().is_empty()) {
            Some(e) => e.trim().to_string(),
            None => return bad("Parameter 'email' wajib untuk inbox"),
        };
        // token param wins; otherwise look up the persisted session
        let s = match get("token") {
            Some(t) if !t.trim().is_empty() => json!({
                "accesstoken": t,
                "fbToken": get("fbToken").unwrap_or_default(),
                "curentToken": get("curentToken").unwrap_or_default(),
            }),
            _ => match load_token(&email) {
                Some(s) => s,
                None => return bad(
                    "Email tidak ditemukan. Buat email dulu via action=create dari endpoint ini.",
                ),
            },
        };
        let accesstoken = s
            .get("accesstoken")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let fb_token = s
            .get("fbToken")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let curent_token = s
            .get("curentToken")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let payload = json!({
            "action": "listinbox",
            "listToken": { &email: accesstoken },
            "listID": { &email: "" },
            "fbToken": fb_token,
            "curentToken": curent_token,
        });
        let r = match api(&payload).await {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "status": false, "message": e })),
                )
                    .into_response()
            }
        };
        if r.get("msg").and_then(|m| m.as_str()) == Some("ok") {
            if let Some(d) = r.pointer(
                &format!(
                    "/data/{}",
                    serde_json::to_string(&email).unwrap_or_default()
                )
                .trim_matches('"'),
            ) {
                let empty_map = serde_json::Map::new();
                let msgs = d
                    .get("data")
                    .and_then(|x| x.as_object())
                    .unwrap_or(&empty_map);
                let pesan: Vec<Value> = msgs
                    .values()
                    .map(|m| {
                        let receive_time = m.get("receive_time").and_then(|t| t.as_i64());
                        json!({
                            "id": m.get("id").cloned().unwrap_or(Value::Null),
                            "dari": m.get("sender_name").or_else(|| m.get("sender_email")).cloned().unwrap_or(json!("")),
                            "subjek": m.get("subject").and_then(|s| if s.is_null() { None } else { Some(json!(s)) }).unwrap_or(json!("(kosong)")),
                            "waktu": receive_time.and_then(|t| chrono::DateTime::from_timestamp(t, 0)).map(|dt| json!(dt.to_rfc3339())).unwrap_or(json!("")),
                            "body": m.get("body_html").or_else(|| m.get("body_text")).cloned().unwrap_or(json!("")),
                        })
                    })
                    .collect();
                return Json(json!({
                    "status": true,
                    "action": "inbox",
                    "result": {
                        "email": email,
                        "total": pesan.len(),
                        "messages": pesan,
                        "expired": d.get("dead").and_then(|x| x.as_bool()).unwrap_or(false),
                    }
                }))
                .into_response();
            }
        }
        return Json(json!({
            "status": true,
            "action": "inbox",
            "result": { "email": email, "total": 0, "messages": [] }
        }))
        .into_response();
    }

    if action == "domains" {
        let r = match api(&json!({ "action": "newemail", "list_domain": 1 })).await {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "status": false, "message": e })),
                )
                    .into_response()
            }
        };
        if let Some(list) = r.get("data").and_then(|d| d.as_array()) {
            return Json(json!({
                "status": true,
                "action": "domains",
                "result": list.iter().map(|d| json!({
                    "name": d.get("domain_name").cloned().unwrap_or(Value::Null),
                    "token": d.get("domain_token").cloned().unwrap_or(Value::Null),
                })).collect::<Vec<_>>()
            }))
            .into_response();
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "status": false, "message": "Gagal mengambil daftar domain" })),
        )
            .into_response();
    }

    if action == "custom" {
        let custom_name = match get("nama").filter(|n| !n.trim().is_empty()) {
            Some(n) => n,
            None => return bad("Parameter 'nama' wajib untuk custom"),
        };
        let domain = get("domain").unwrap_or_else(|| "1".to_string());
        let r = match api(&json!({
            "action": "newemail",
            "newemail_mode": "custom",
            "choose_domain": domain,
            "custom_name": custom_name,
        }))
        .await
        {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "status": false, "message": e })),
                )
                    .into_response()
            }
        };
        if let (Some(email), Some(token)) = (
            r.get("email").and_then(|e| e.as_str()),
            r.get("accesstoken").and_then(|t| t.as_str()),
        ) {
            save_token(email, token, "", "");
            return Json(json!({
                "status": true,
                "action": "custom",
                "result": { "email": email, "token": token }
            }))
            .into_response();
        }
        if r.get("msg").and_then(|m| m.as_str()) == Some("erroremail") {
            let desc = match r.get("desc").and_then(|d| d.as_str()) {
                Some("name_taken") => "Nama sudah dipakai".to_string(),
                Some(other) => other.to_string(),
                None => "erroremail".to_string(),
            };
            return bad(&desc);
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "status": false, "message": "Gagal membuat email custom" })),
        )
            .into_response();
    }

    if action == "delete" {
        let email = match get("email").filter(|e| !e.trim().is_empty()) {
            Some(e) => e.trim().to_string(),
            None => return bad("Parameter 'email' wajib untuk delete"),
        };
        let _ = fs::remove_file(session_path(&format!(
            "tmailor_{}.json",
            email.to_lowercase()
        )));
        return Json(json!({
            "status": true,
            "action": "delete",
            "result": { "email": email, "message": "Email dihapus dari sesi" }
        }))
        .into_response();
    }

    bad("action tidak valid. Gunakan: create / inbox / custom / domains / delete")
}

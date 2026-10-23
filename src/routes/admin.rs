use axum::{
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSession {
    pub session_id: String,
    pub username: String,
    pub role: String,
}

pub fn find_session_dir() -> PathBuf {
    let candidates = [
        "/home/agentuser/apiku/data/sessions",
        "/home/agentuser/apiku/apiku-rs/data/sessions",
        "./data/sessions",
        "../data/sessions",
    ];

    for candidate in &candidates {
        let p = Path::new(candidate);
        if p.exists() && p.is_dir() {
            return p.to_path_buf();
        }
    }

    PathBuf::from("data/sessions")
}

pub fn extract_session_id(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix("apiku.sid=") {
            let decoded = urlencoding::decode(val).unwrap_or(std::borrow::Cow::Borrowed(val));
            let raw = if let Some(stripped) = decoded.strip_prefix("s:") {
                stripped
            } else {
                &decoded
            };
            let id = raw.split('.').next().unwrap_or(raw);
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

pub fn get_admin_session(headers: &HeaderMap) -> Option<AdminSession> {
    let session_id = extract_session_id(headers)?;
    let candidates = [
        "/home/agentuser/apiku/apiku-rs/data/sessions",
        "/home/agentuser/apiku/data/sessions",
        "./data/sessions",
        "../data/sessions",
    ];

    let mut found_path = None;
    for dir in &candidates {
        let p = Path::new(dir).join(format!("{}.json", session_id));
        if p.exists() {
            found_path = Some(p);
            break;
        }
    }
    let file_path = found_path?;

    let content = std::fs::read_to_string(&file_path).ok()?;
    let mut data = serde_json::from_str::<Value>(&content).ok()?;

    let is_logged_in = data.get("adminLoggedIn").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_logged_in {
        return None;
    }

    let now = chrono::Utc::now();
    let mut expired = false;

    if let Some(exp_str) = data.get("cookie").and_then(|c| c.get("expires")).and_then(|e| e.as_str()) {
        if let Ok(exp_dt) = chrono::DateTime::parse_from_rfc3339(exp_str) {
            let exp_utc = exp_dt.with_timezone(&chrono::Utc);
            if exp_utc < now {
                expired = true;
            }
        }
    }

    if expired {
        return None;
    }

    let username = data.get("adminUser")
        .and_then(|v| v.as_str())
        .unwrap_or("admin")
        .to_string();
    let role = data.get("adminRole")
        .and_then(|v| v.as_str())
        .unwrap_or("superadmin")
        .to_string();

    // Auto-extend session rolling expiry 30 hari ke depan ("jadi ga perlu login terus")
    let new_expires = (now + chrono::Duration::days(30)).to_rfc3339();
    let now_ts = now.timestamp_millis();

    if let Some(obj) = data.as_object_mut() {
        obj.insert("__lastAccess".to_string(), json!(now_ts));
        if let Some(cookie_obj) = obj.get_mut("cookie").and_then(|c| c.as_object_mut()) {
            cookie_obj.insert("expires".to_string(), json!(new_expires));
            cookie_obj.insert("originalMaxAge".to_string(), json!(30i64 * 86400 * 1000));
        }
        let serialized = serde_json::to_string(obj).unwrap_or_default();
        let _ = std::fs::write(&file_path, &serialized);

        // Sync ke kedua folder (apiku-rs/data/sessions & apiku/data/sessions)
        for dir in &candidates {
            let target = Path::new(dir).join(format!("{}.json", session_id));
            if target != file_path && Path::new(dir).exists() {
                let _ = std::fs::write(&target, &serialized);
            }
        }
    }

    Some(AdminSession {
        session_id,
        username,
        role,
    })
}

// GET /admin & GET /admin/login
pub async fn login_page(headers: HeaderMap) -> Response {
    if get_admin_session(&headers).is_some() {
        return Redirect::to("/admin/dashboard").into_response();
    }

    let pub_dir = crate::routes::public::find_public_dir();
    let file = pub_dir.join("admin/login.html");
    if let Ok(content) = std::fs::read_to_string(file) {
        Html(content).into_response()
    } else {
        (StatusCode::NOT_FOUND, "admin/login.html not found").into_response()
    }
}

// GET /admin/dashboard
pub async fn dashboard_page(headers: HeaderMap) -> Response {
    if get_admin_session(&headers).is_none() {
        return Redirect::to("/admin/login").into_response();
    }

    let pub_dir = crate::routes::public::find_public_dir();
    let file = pub_dir.join("admin/dashboard.html");
    if let Ok(content) = std::fs::read_to_string(file) {
        Html(content).into_response()
    } else {
        (StatusCode::NOT_FOUND, "admin/dashboard.html not found").into_response()
    }
}

// GET /admin/api/me
pub async fn admin_me(headers: HeaderMap) -> Response {
    if let Some(session) = get_admin_session(&headers) {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            Json(json!({
                "success": true,
                "user": {
                    "username": session.username,
                    "role": session.role
                }
            })).to_string(),
        ).into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json")],
            Json(json!({
                "success": false,
                "error": "Not authenticated"
            })).to_string(),
        ).into_response()
    }
}

// POST /admin/api/logout
pub async fn admin_logout(headers: HeaderMap) -> Response {
    if let Some(sid) = extract_session_id(&headers) {
        let candidates = [
            "/home/agentuser/apiku/apiku-rs/data/sessions",
            "/home/agentuser/apiku/data/sessions",
            "./data/sessions",
            "../data/sessions",
        ];
        for dir in &candidates {
            let file_path = Path::new(dir).join(format!("{}.json", sid));
            if file_path.exists() {
                let _ = std::fs::remove_file(file_path);
            }
        }
    }

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::SET_COOKIE, "apiku.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax"),
        ],
        Json(json!({
            "success": true,
            "message": "Logged out"
        })).to_string(),
    ).into_response()
}

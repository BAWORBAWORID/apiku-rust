// XMZ Bypass — native conversion of api/bypass/xmz.js
// Unlock XMZ-protected links with token + optional 4-digit PIN.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn extract_token(input: &str) -> Option<String> {
    let s = input.trim();
    if s.contains("xmz-unlock.zone.id/") {
        let idx = s.find("xmz-unlock.zone.id/")?;
        let rest = &s[idx + "xmz-unlock.zone.id/".len()..];
        let token = rest.split(['?', '#']).next().unwrap_or(rest);
        return Some(token.trim_matches('/').to_string());
    }
    Some(s.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
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
    let raw_input = get("url").or_else(|| get("link")).or_else(|| get("token"));
    let raw_input = match raw_input {
        Some(v) if !v.trim().is_empty() => v,
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "[!] Masukkan parameter 'url' atau 'token'"
            })))
            .into_response()
        }
    };
    let token = match extract_token(&raw_input) {
        Some(t) if !t.is_empty() => t,
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "[!] Token XMZ Unlock tidak valid"
            })))
            .into_response()
        }
    };
    let pin = get("pin")
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());

    let client = match client() {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e
            })))
            .into_response()
        }
    };

    if let Some(pin) = pin {
        if !regex::Regex::new(r"^\d{4}$").unwrap().is_match(&pin) {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "[!] PIN harus berupa 4 digit angka"
            })))
            .into_response();
        }
        let resp = client
            .post("https://xmz-unlock.zone.id/api")
                        .header("Content-Type", "application/json")
                        .header("User-Agent", "Mozilla/5.0")
            .body(json!({ "type": "unlock", "token": token, "pin": pin }).to_string())
            .send()
            .await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                    "status": false, "message": e.to_string()
                })))
                .into_response()
            }
        };
        let status = resp.status().as_u16();
        let data: Value = resp.json().await.unwrap_or(json!({}));
        if status == 200 && data.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
            let url = data.get("url").cloned().unwrap_or(Value::Null);
            return Json(json!({
                "status": true,
                "result": url,
                "data": {
                    "name": data.get("name").cloned().unwrap_or(json!("Protected Link")),
                    "unlocked_url": data.get("url"),
                    "pin": pin,
                    "token": token,
                }
            }))
            .into_response();
        }
        let status_code = StatusCode::from_u16(if status >= 400 { status } else { 400 })
            .unwrap_or(StatusCode::BAD_REQUEST);
        return (
            status_code,
            Json(json!({
                "status": false,
                "message": data.get("error").cloned().unwrap_or(json!("PIN salah atau gagal membuka link")),
            })),
        )
            .into_response();
    }

    // no pin: fetch metadata
    let resp = client
        .post("https://xmz-unlock.zone.id/api")
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0")
        .body(json!({ "type": "meta", "token": token }).to_string())
        .send()
        .await;
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e.to_string()
            })))
            .into_response()
        }
    };
    let status = resp.status().as_u16();
    let data: Value = resp.json().await.unwrap_or(json!({}));
    if status == 200 && data.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
        return Json(json!({
            "status": true,
            "message": "Link terdeteksi terkunci. Masukkan parameter 'pin' untuk membuka URL tujuan.",
            "data": {
                "name": data.get("name").cloned().unwrap_or(json!("Protected Link")),
                "locked": true,
                "token": token,
            }
        }))
        .into_response();
    }
    let status_code = StatusCode::from_u16(if status >= 400 { status } else { 400 })
        .unwrap_or(StatusCode::BAD_REQUEST);
    (
        status_code,
        Json(json!({
            "status": false,
            "message": data.get("error").cloned().unwrap_or(json!("Link atau token XMZ Unlock tidak ditemukan / tidak valid")),
        })),
    )
        .into_response()
}

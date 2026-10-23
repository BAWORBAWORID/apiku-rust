// onesec_mail — native conversion of api/tempmail/onesec-mail.js
// Stateless mail.tm wrapper: create / inbox / message / delete via token.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://api.mail.tm";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

async fn get_active_domain() -> String {
    if let Ok(c) = client() {
        if let Ok(res) = c
            .get(format!("{BASE_URL}/domains?page=1"))
                        .header("Accept", "application/json")
            .send()
            .await
        {
            if let Ok(j) = res.json::<Value>().await {
                if let Some(list) = j.as_array() {
                    if let Some(d) = list
                        .iter()
                        .find(|d| d.get("isActive").and_then(|a| a.as_bool()).unwrap_or(false))
                    {
                        if let Some(dom) = d.get("domain").and_then(|x| x.as_str()) {
                            return dom.to_string();
                        }
                    }
                    if let Some(first) = list.first() {
                        if let Some(dom) = first.get("domain").and_then(|x| x.as_str()) {
                            return dom.to_string();
                        }
                    }
                }
            }
        }
    }
    "uberip.com".to_string()
}

async fn create_account(username: Option<&str>) -> Result<Value, String> {
    let domain = get_active_domain().await;
    let local_part = username.map(|s| s.to_string()).unwrap_or_else(|| {
        use std::time::{SystemTime, UNIX_EPOCH};
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        format!("user{:x}{:04x}", t, (t % 0xffff) as u32)
    });
    let address = format!("{local_part}@{domain}");
    let password = "temp123456";

    let c = client()?;
    let res = c
        .post(format!("{BASE_URL}/accounts"))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
        .json(&json!({ "address": address, "password": password }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if !data.get("id").is_some() {
        return Err(data
            .get("message")
            .or_else(|| data.get("detail"))
            .and_then(|m| m.as_str())
            .unwrap_or("create failed")
            .to_string());
    }

    let token_res = c
        .post(format!("{BASE_URL}/token"))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
        .json(&json!({ "address": address, "password": password }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let token_data: Value = token_res.json().await.map_err(|e| e.to_string())?;
    let token = token_data
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Token request failed".to_string())?;

    Ok(json!({
        "email": address,
        "password": password,
        "token": token,
        "domain": domain,
        "id": data.get("id").cloned().unwrap_or(Value::Null),
    }))
}

async fn get_inbox(token: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!("{BASE_URL}/messages"))
        .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
}

async fn get_message(token: &str, id: &str) -> Result<Value, String> {
    let res = client()?
        .get(format!("{BASE_URL}/messages/{id}"))
        .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
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
    let now = || chrono::Utc::now().to_rfc3339();
    let action = match get("action") {
        Some(a) if !a.trim().is_empty() => a,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "status": false,
                    "error": "Parameter 'action' wajib: create, inbox, delete, message",
                    "example": { "create": "?action=create&username=custom", "inbox": "?action=inbox&token=xxx" }
                })),
            )
                .into_response()
        }
    };

    if action == "create" {
        return match create_account(get("username").as_deref()).await {
            Ok(result) => Json(json!({
                "status": true,
                "result": result,
                "message": "Email created. Save token for inbox/delete.",
                "timestamp": now()
            }))
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "error": e, "timestamp": now() })),
            )
                .into_response(),
        };
    }

    let token = match get("token") {
        Some(t) if !t.trim().is_empty() => t,
        _ => return (
            StatusCode::BAD_REQUEST,
            Json(
                json!({ "status": false, "error": format!("Token wajib untuk action: {action}") }),
            ),
        )
            .into_response(),
    };

    if action == "inbox" {
        return match get_inbox(&token).await {
            Ok(messages) => {
                let count = messages.as_array().map(|a| a.len()).unwrap_or(0);
                Json(json!({
                    "status": true,
                    "result": { "count": count, "messages": messages },
                    "timestamp": now()
                }))
                .into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "error": e, "timestamp": now() })),
            )
                .into_response(),
        };
    }

    if action == "message" {
        let id =
            match get("id").filter(|s| !s.trim().is_empty()) {
                Some(i) => i,
                None => return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "status": false, "error": "Parameter 'id' wajib untuk message" })),
                )
                    .into_response(),
            };
        return match get_message(&token, &id).await {
            Ok(msg) => {
                Json(json!({ "status": true, "result": msg, "timestamp": now() })).into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "error": e, "timestamp": now() })),
            )
                .into_response(),
        };
    }

    if action == "delete" {
        let ok = if let Ok(c) = client() {
            c.delete(format!("{BASE_URL}/accounts/me"))
                .header("Authorization", format!("Bearer {token}"))
                .header("Accept", "application/json")
                .send()
                .await
                .map(|res| res.status().is_success())
                .unwrap_or(false)
        } else {
            false
        };
        let _ = ok; // upstream ignores failure of delete (Node returns ok regardless of res.ok)
        return Json(json!({ "status": true, "message": "Account deleted", "timestamp": now() }))
            .into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "status": false, "error": format!("Action tidak valid: {action}") })),
    )
        .into_response()
}

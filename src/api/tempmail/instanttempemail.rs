// instanttempemail — native conversion of api/tempmail/instanttempemail.js
// instanttempemail.com public Next.js API. Mailbox keyed by token (UUID).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://instanttempemail.com";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

async fn call(path: &str, method: reqwest::Method) -> Result<Value, (Option<u16>, String)> {
    let res = client()
        .map_err(|e| (None, e))?
        .request(method, format!("{BASE}{path}"))
                    .header("Accept", "application/json")
        .header("Referer", format!("{BASE}/"))
        .send()
        .await
        .map_err(|e| (None, e.to_string()))?;
    let status = res.status().as_u16();
    let text = res
        .text()
        .await
        .map_err(|e| (Some(status), e.to_string()))?;
    let data: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
        let m = text
            .split("<h1>")
            .nth(1)
            .and_then(|s| s.split("</h1>").next())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| text.chars().take(200).collect());
        json!({ "error": m })
    });
    if !(200..300).contains(&status) {
        let msg = data
            .get("error")
            .or_else(|| data.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or(&format!("HTTP {status}"))
            .to_string();
        return Err((Some(status), msg));
    }
    Ok(data)
}

async fn create_mailbox() -> Result<Value, (Option<u16>, String)> {
    let box_ = call("/api/create", reqwest::Method::POST).await?;
    if box_.get("address").is_none() || box_.get("token").is_none() {
        return Err((None, "Respons /api/create tidak lengkap".to_string()));
    }
    Ok(box_)
}

async fn get_inbox(token: &str) -> Result<Value, (Option<u16>, String)> {
    call(
        &format!("/api/inbox/{}", urlencoding::encode(token)),
        reqwest::Method::GET,
    )
    .await
}

async fn watch_inbox(token: &str, seconds: u64) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(seconds);
    let mut last = Value::Null;
    while std::time::Instant::now() < deadline {
        match get_inbox(token).await {
            Ok(v) => {
                last = v.clone();
                let n = v
                    .get("emails")
                    .and_then(|e| e.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if n > 0 {
                    return last;
                }
            }
            Err((Some(404), _)) => return json!({ "error": "Mailbox sudah expired" }),
            Err(_) => {}
        }
        tokio::time::sleep(std::time::Duration::from_millis(5000)).await;
    }
    last
}

fn summarize(mails: &Value) -> Vec<Value> {
    mails
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    let raw = m
                        .get("text")
                        .or_else(|| m.get("body"))
                        .or_else(|| m.get("html"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    let preview: String = raw
                        .split('<')
                        .map(|s| s.split('>').next_back().unwrap_or(""))
                        .collect::<Vec<_>>()
                        .join(" ")
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .chars()
                        .take(300)
                        .collect();
                    json!({
                        "id": m.get("id").cloned().unwrap_or(Value::Null),
                        "from": m.get("from").or_else(|| m.get("sender")).cloned().unwrap_or(Value::Null),
                        "subject": m.get("subject").cloned().unwrap_or(Value::Null),
                        "date": m.get("date").or_else(|| m.get("receivedAt")).or_else(|| m.get("createdAt")).cloned().unwrap_or(Value::Null),
                        "preview": preview,
                        "attachments": m.get("attachments").and_then(|a| a.as_array()).map(|a| a.len()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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
    let start = std::time::Instant::now();
    let actions = ["create", "inbox", "watch", "demo", "read", "delete"];
    let action = get("action").unwrap_or_else(|| "create".to_string());
    if !actions.contains(&action.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": format!("Parameter 'action' harus salah satu dari: {}", actions.join(", ")),
                "code": "INVALID_ACTION"
            })),
        )
            .into_response();
    }

    if ["inbox", "watch", "read", "delete"].contains(&action.as_str()) && get("token").is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": format!("Parameter 'token' wajib diisi untuk action '{action}'. Token didapat dari action=create."),
                "code": "MISSING_TOKEN"
            })),
        )
            .into_response();
    }
    if action == "read" && get("messageId").is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "status": false, "message": "Parameter 'messageId' wajib diisi untuk action 'read'", "code": "MISSING_MESSAGE_ID" })),
        )
            .into_response();
    }

    let wait = get("wait")
        .and_then(|w| w.parse::<u64>().ok())
        .unwrap_or(120);
    let token = get("token").unwrap_or_default();
    let msg_id = get("messageId").unwrap_or_default();

    let result: Result<Value, (Option<u16>, String)> = match action.as_str() {
        "create" => create_mailbox().await,
        "inbox" => get_inbox(&token).await,
        "watch" => Ok(watch_inbox(&token, wait).await),
        "read" => {
            call(
                &format!(
                    "/api/inbox/{}/read/{}",
                    urlencoding::encode(&token),
                    urlencoding::encode(&msg_id)
                ),
                reqwest::Method::POST,
            )
            .await
        }
        "delete" => {
            call(
                &format!("/api/delete/{}", urlencoding::encode(&token)),
                reqwest::Method::POST,
            )
            .await
        }
        "demo" => match create_mailbox().await {
            Ok(box_) => {
                let inbox = watch_inbox(
                    box_.get("token").and_then(|t| t.as_str()).unwrap_or(""),
                    wait,
                )
                .await;
                let mut b = box_;
                b["inbox"] = inbox;
                Ok(b)
            }
            Err(e) => Err(e),
        },
        _ => unreachable!(),
    };

    match result {
        Ok(r) => Json(json!({
            "status": true,
            "action": action,
            "result": r,
            "responseTime": format!("{}ms", start.elapsed().as_millis())
        }))
        .into_response(),
        Err((status, msg)) => {
            let http = if status == Some(404) {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_GATEWAY
            };
            (
                http,
                Json(json!({
                    "status": false,
                    "action": action,
                    "message": msg,
                    "code": if status == Some(404) { "MAILBOX_EXPIRED" } else { "UPSTREAM_ERROR" },
                    "responseTime": format!("{}ms", start.elapsed().as_millis())
                })),
            )
                .into_response()
        }
    }
}

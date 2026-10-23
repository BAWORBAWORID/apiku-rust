// temptf — native conversion of api/tempmail/temptf.js
// temp.tf: generate alias email (gmail/outlook/hotmail/high.edu.pl pool) & cek inbox.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://temp.tf";
const PROVIDERS: [&str; 4] = ["gmail", "outlook", "hotmail", "high.edu.pl"];

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("Referer", format!("{BASE_URL}/").parse().unwrap());
    h.insert("Origin", BASE_URL.parse().unwrap());
    h.insert(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            .parse()
            .unwrap(),
    );
    h
}

fn is_truthy(v: Option<&String>) -> bool {
    matches!(
        v.map(|s| s.as_str()),
        Some("true") | Some("1") | Some("yes") | Some("True")
    )
}

async fn generate_email(providers: &str, dot: bool, plus: bool) -> Result<Value, String> {
    let list: Vec<String> = providers
        .split(',')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| PROVIDERS.contains(&p.as_str()))
        .collect();
    if list.is_empty() {
        return Err(format!(
            "Provider tidak valid. Pilihan: {}",
            PROVIDERS.join(", ")
        ));
    }
    let query = [
        ("providers", list.join(",")),
        ("dot", if dot { "1".into() } else { "0".into() }),
        ("plus", if plus { "1".into() } else { "0".into() }),
    ];
    let res = client()?
        .get(format!("{BASE_URL}/api/account"))
        .query(&query)
        .headers(base_headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status == 429 {
        return Err("Rate limited, coba lagi beberapa saat lagi.".to_string());
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(data
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or(&format!("Gagal generate email (HTTP {status})"))
            .to_string());
    }
    let email = data
        .get("email")
        .and_then(|e| e.as_str())
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    if email.is_empty() {
        return Err("Tidak ada alamat email yang dikembalikan.".to_string());
    }
    let domain = email.split('@').nth(1).unwrap_or("").to_string();
    Ok(json!({ "status": true, "email": email, "providers": query[0].1, "domain": domain }))
}

fn normalize_message(m: &Value) -> Value {
    let body = m
        .get("body")
        .and_then(|b| b.as_str())
        .unwrap_or("")
        .to_string();
    let preview: String = body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect();
    let links: Vec<&str> = body
        .split(|c: char| c == '"' || c == '\'' || c == '<' || c == '>' || c.is_whitespace())
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        .collect();
    let attachments: Vec<Value> = m
        .get("attachments")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .map(|a| {
                    let email_ref = m
                        .get("to")
                        .or_else(|| m.get("email"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("");
                    let mid = m.get("id").map(|i| i.to_string()).unwrap_or_default();
                    let url = a
                        .get("id")
                        .map(|aid| {
                            format!(
                                "{}/api/attachment?email={}&messageId={}&attachmentId={}",
                                BASE_URL,
                                urlencoding::encode(email_ref),
                                urlencoding::encode(mid.trim_matches('"')),
                                urlencoding::encode(&aid.to_string().trim_matches('"').to_string())
                            )
                        })
                        .unwrap_or_default();
                    json!({
                        "id": a.get("id").cloned().unwrap_or(Value::Null),
                        "name": a.get("name").cloned().unwrap_or(Value::Null),
                        "contentType": a.get("contentType").cloned().unwrap_or(Value::Null),
                        "size": a.get("size").cloned().unwrap_or(Value::Null),
                        "url": url,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "id": m.get("id").cloned().unwrap_or(Value::Null),
        "date": m.get("date").cloned().unwrap_or(Value::Null),
        "subject": m.get("subject").cloned().unwrap_or(Value::Null),
        "from": m.get("from").cloned().unwrap_or(Value::Null),
        "preview": if preview.is_empty() { Value::Null } else { json!(preview) },
        "body": if body.is_empty() { Value::Null } else { json!(body) },
        "bodyContentType": m.get("bodyContentType").cloned().unwrap_or(Value::Null),
        "isHtml": m.get("bodyContentType").and_then(|b| b.as_str()) == Some("html"),
        "links": links,
        "attachments": attachments,
    })
}

async fn check_inbox(email: &str, wait: bool) -> Result<Value, String> {
    let addr = email.trim().to_lowercase();
    if !addr.contains('@') {
        return Err("Alamat email tidak valid.".to_string());
    }
    let res = client()?
        .post(format!("{BASE_URL}/api/check"))
        .headers(base_headers())
                    .header("Content-Type", "application/json")
        .json(&json!({ "email": addr, "wait": wait }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status == 429 {
        return Err("Rate limited, coba lagi beberapa saat lagi.".to_string());
    }
    if status != 200 {
        return Err(format!("Gagal cek inbox (HTTP {status})"));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let items = if data.is_array() {
        data
    } else {
        data.get("data").cloned().unwrap_or(json!([]))
    };
    let empty = Vec::new();
    let list = items.as_array().unwrap_or(&empty);
    Ok(json!({
        "status": true,
        "email": addr,
        "total": list.len(),
        "messages": list.iter().map(normalize_message).collect::<Vec<_>>(),
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
    let action = get("action").unwrap_or_else(|| "create".to_string());

    if action == "inbox" {
        let email = match get("email").filter(|e| e.contains('@')) {
            Some(e) => e,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "status": false, "message": "Parameter 'email' wajib diisi untuk action=inbox" })),
                )
                    .into_response()
            }
        };
        return match check_inbox(&email, is_truthy(get("wait").as_ref())).await {
            Ok(r) => Json(r).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    // default: create
    let providers = get("providers").unwrap_or_else(|| "high.edu.pl".to_string());
    let plus = match get("plus") {
        None => true,
        Some(_) => is_truthy(get("plus").as_ref()),
    };
    match generate_email(&providers, is_truthy(get("dot").as_ref()), plus).await {
        Ok(r) => Json(r).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "status": false, "message": e })),
        )
            .into_response(),
    }
}

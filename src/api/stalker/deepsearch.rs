// Deep Search Stalker — native conversion of api/stalker/deepsearch.js
// Begamob deep-search API with guest login + refresh-token session cache.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use reqwest::header;

const API: &str = "https://chat-ai.begamob.com";
const APP_VERSION: &str = "1.5.5";
const APP_BUNDLE: &str = "com.chat.chatai.chatbot.aichatbot";
const UA: &str = "okhttp/4.12.0";

fn base_headers() -> Vec<(&'static str, String)> {
    vec![
        ("x-app-version", APP_VERSION.into()),
        ("x-app-bundle-id", APP_BUNDLE.into()),
        ("x-os", "android".into()),
        ("Content-Type", "application/json; charset=UTF-8".into()),
        ("User-Agent", UA.into()),
    ]
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn random_device_id() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

fn decode_exp(token: &str) -> u64 {
    let Some(p) = token.split('.').nth(1) else { return 0 };
    let p = p.replace('-', "+").replace('_', "/");
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(p)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default();
    serde_json::from_str::<Value>(&decoded)
        .ok()
        .and_then(|v| v.get("exp").and_then(|e| e.as_u64()))
        .map(|e| e * 1000)
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone)]
struct Session {
    device_id: String,
    access_token: String,
    refresh_token: String,
}

static CACHED_SESSION: Mutex<Option<Session>> = Mutex::new(None);

async fn login(device_id: &str) -> Result<(String, String), String> {
    let c = client()?;
    let res = c
        .post(format!("{}/api/v1/auth/login", API))
        .headers({
            let mut hm = reqwest::header::HeaderMap::new();
            for (k, v) in base_headers() {
                if let (Ok(name), Ok(val)) = (
                    reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                    reqwest::header::HeaderValue::from_str(&v),
                ) {
                    hm.insert(name, val);
                }
            }
            hm
        })
        .json(&json!({ "deviceId": device_id, "type": "guest" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    if !j.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        return Err(format!("Login gagal: {}", j));
    }
    let d = j.get("data").cloned().unwrap_or(json!({}));
    Ok((
        d.get("accessToken").and_then(|a| a.as_str()).unwrap_or("").to_string(),
        d.get("refreshToken").and_then(|a| a.as_str()).unwrap_or("").to_string(),
    ))
}

async fn refresh_access_token(session: &Session) -> Result<(String, String), String> {
    let c = client()?;
    let mut hm = reqwest::header::HeaderMap::new();
    for (k, v) in base_headers() {
        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(&v),
        ) {
            hm.insert(name, val);
        }
    }
    let res = c
        .post(format!("{}/api/v1/auth/refresh-token", API))
        .headers(hm)
        .json(&json!({ "refreshToken": session.refresh_token, "deviceId": session.device_id, "type": "guest" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    if !j.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        return Err(format!("Refresh gagal: {}", j));
    }
    let d = j.get("data").cloned().unwrap_or(json!({}));
    Ok((
        d.get("accessToken").and_then(|a| a.as_str()).unwrap_or("").to_string(),
        d.get("refreshToken").and_then(|a| a.as_str()).unwrap_or("").to_string(),
    ))
}

async fn ensure_session() -> Result<Session, String> {
    if let Ok(guard) = CACHED_SESSION.lock() {
        if let Some(s) = guard.as_ref() {
            if !s.access_token.is_empty() && !s.refresh_token.is_empty() && decode_exp(&s.access_token) > now_ms() + 60_000 {
                return Ok(s.clone());
            }
        }
    }
    let device_id = CACHED_SESSION
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.device_id.clone()))
        .unwrap_or_else(random_device_id);
    let (access, refresh) = login(&device_id).await?;
    let s = Session { device_id, access_token: access, refresh_token: refresh };
    if let Ok(mut g) = CACHED_SESSION.lock() {
        *g = Some(s.clone());
    }
    Ok(s)
}

async fn get_access_token(session: &mut Session) -> Result<String, String> {
    if !session.access_token.is_empty() && decode_exp(&session.access_token) > now_ms() + 60_000 {
        return Ok(session.access_token.clone());
    }
    if let Ok((access, refresh)) = refresh_access_token(session).await {
        session.access_token = access.clone();
        if !refresh.is_empty() {
            session.refresh_token = refresh;
        }
        if let Ok(mut g) = CACHED_SESSION.lock() {
            *g = Some(session.clone());
        }
        return Ok(access);
    }
    let (access, refresh) = login(&session.device_id).await?;
    session.access_token = access.clone();
    session.refresh_token = refresh;
    if let Ok(mut g) = CACHED_SESSION.lock() {
        *g = Some(session.clone());
    }
    Ok(access)
}

fn build_headers(token: &str, device_id: &str) -> Vec<(String, String)> {
    vec![
        ("Authorization".into(), format!("Bearer {}", token)),
        ("User-Authorization".into(), token.to_string()),
        (
            "user-header".into(),
            format!("bundleId:{}/versionApp:{}/OS:Android/osVersion:35/userId:/deviceId:{}", APP_BUNDLE, APP_VERSION, device_id),
        ),
        ("language-code".into(), "en".into()),
        ("x-adjust-id".into(), String::new()),
        ("x-app-version".into(), APP_VERSION.into()),
        ("x-app-bundle-id".into(), APP_BUNDLE.into()),
        ("x-os".into(), "android".into()),
        ("Content-Type".into(), "application/json; charset=UTF-8".into()),
        ("User-Agent".into(), UA.into()),
    ]
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
    let name = query
        .get("name")
        .cloned()
        .or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
        });
    let clean_name = match name {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'name' wajib diisi",
                "example": {
                    "GET": "/api/stalker/deepsearch?name=jokowi",
                    "POST": { "name": "jokowi" },
                },
            })))
            .into_response()
        }
    };

    let mut session = match ensure_session().await {
        Ok(s) => s,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": e,
                "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) },
            })))
            .into_response()
        }
    };
    let token = match get_access_token(&mut session).await {
        Ok(t) => t,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": e,
                "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) },
            })))
            .into_response()
        }
    };

    let c = match client() {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e })))
                .into_response()
        }
    };
    let mut req = c
        .post(format!("{}/api/v2/deep-search/person/find?limit=10", API))
        .json(&json!({ "platform": "android", "name": clean_name }));
    for (k, v) in build_headers(&token, &session.device_id) {
        req = req.header(&k, &v);
    }
    let result: Value = match req.send().await {
        Ok(r) => r.json().await.unwrap_or(json!({})),
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false,
                "message": e.to_string(),
                "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) },
            })))
            .into_response()
        }
    };

    if !result.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": "Upstream API error",
            "raw": result,
            "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) },
        })))
        .into_response();
    }

    let people: Vec<Value> = result
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| {
                    json!({
                        "name": p.get("name").cloned().unwrap_or(Value::Null),
                        "career": p.pointer("/demographics/career").cloned().unwrap_or(Value::Null),
                        "source": p.pointer("/information/primary_source").cloned().unwrap_or(Value::Null),
                        "demographics": p.get("demographics").cloned().unwrap_or(Value::Null),
                        "information": p.get("information").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Json(json!({
        "status": true,
        "total": people.len(),
        "query": clean_name,
        "results": people,
        "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) },
    })).into_response()

}

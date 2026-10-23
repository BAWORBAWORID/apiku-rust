// HCNsec Chat Completions — native conversion of api/v3/chat/completions.js
// Transparent proxy to api.hcnsec.cn. API keys round-robin; read from
// HCNSEC_API_KEYS env (comma-separated), falling back to the keys the JS file
// shipped with (kept here for behavioral parity with api/v3/chat/completions.js).
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

const UPSTREAM: &str = "https://api.hcnsec.cn/v1/chat/completions";

static KEYS: &[&str] = &[
    "sk-AI0sbKeiPRXt6SthQ4:GQ6ATrF2",
    "sk-N8IOA1G8D0KDYCDTZ6:9Lwj9h8",
    "sk-IqBVo4A4Yp8MZTr4N1w2XnKDGv",
    "sk-yvzPMtR6GCIzATnwWrFDXGRwtM",
    "sk-R6qsfY4F0vBBIC0A9Hbc1Qg7T5",
    "sk-KnmXh7SPwUp8s1XmFdktWQltbj",
    "sk-ajN6jSGFViO7anUuwMmyccMKsA",
    "sk-QwvlfrIRa7KPBbXq4k8Gc4fIf",
    "sk-xJztPCwKqWLYk6XsfeUdmysTYO",
    "sk-lTsH8k8v9S4EPdcbIEm9e4Ke5X",
];

static KEY_INDEX: AtomicUsize = AtomicUsize::new(0);

fn key_list() -> Vec<String> {
    if let Ok(env_keys) = std::env::var("HCNSEC_API_KEYS") {
        let keys: Vec<String> = env_keys
            .split(',')
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
            .collect();
        if !keys.is_empty() {
            return keys;
        }
    }
    KEYS.iter().map(|s| s.to_string()).collect()
}

fn get_api_key() -> String {
    let keys = key_list();
    let i = KEY_INDEX.fetch_add(1, Ordering::Relaxed) % keys.len();
    keys[i].clone()
}

pub async fn handler(
    Query(_query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let api_key = get_api_key();
    let payload = body.map(|Json(b)| b).unwrap_or(serde_json::json!({}));

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": { "message": e.to_string() } })),
            )
                .into_response()
        }
    };

    let resp = client
        .post(UPSTREAM)
                    .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .body(payload.to_string())
        .send()
        .await;

    match resp {
        Ok(resp) => {
            let status =
                axum::http::StatusCode::from_u16(resp.status().as_u16()).unwrap_or(axum::http::StatusCode::BAD_GATEWAY);
            let data = resp.text().await.unwrap_or_default();
            let mut r = axum::response::Response::builder().status(status);
            r = r.header("Content-Type", "application/json");
            r = r.header(
                "X-Upstream-Key",
                format!("{}...", &api_key[..api_key.len().min(12)]),
            );
            r.body(axum::body::Body::from(data)).unwrap().into_response()
        }
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "message": e.to_string() } })),
        )
            .into_response(),
    }
}

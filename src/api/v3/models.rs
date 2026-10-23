use serde_json::json;
use serde_json::Value;
// HCNsec Models — native conversion of api/v3/models.js
// Transparent GET proxy to api.hcnsec.cn/v1/models with round-robin API key.
use axum::{response::{IntoResponse, Response}, Json};
use std::sync::atomic::{AtomicUsize, Ordering};

const UPSTREAM: &str = "https://api.hcnsec.cn/v1/models";

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

fn get_api_key() -> String {
    let keys: Vec<String> = std::env::var("HCNSEC_API_KEYS")
        .map(|s| {
            s.split(',')
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let keys = if keys.is_empty() {
        KEYS.iter().map(|s| s.to_string()).collect()
    } else {
        keys
    };
    let i = KEY_INDEX.fetch_add(1, Ordering::Relaxed) % keys.len();
    keys[i].clone()
}

pub async fn handler() -> Response {
    let api_key = get_api_key();
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
    match client
        .get(UPSTREAM)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(resp) => {
            let status = axum::http::StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(axum::http::StatusCode::BAD_GATEWAY);
            let data = resp.text().await.unwrap_or_default();
            axum::response::Response::builder()
                .status(status)
                            .header("Content-Type", "application/json")
                .body(axum::body::Body::from(data))
                .unwrap()
                .into_response()
        }
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "message": e.to_string() } })),
        )
            .into_response(),
    }
}

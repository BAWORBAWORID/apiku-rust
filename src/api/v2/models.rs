// Router Models V2 — native conversion of api/v2/models.js
// Lists models from router.zyvor.my.id, mapping provider like the JS version.
use axum::{response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};

const ROUTER_MODELS_URL: &str = "https://router.zyvor.my.id/v1/models";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const KNOWN_PROVIDERS: &[&str] = &[
    "deepseek", "gemini", "claude", "gpt", "glm", "qwen", "nemotron",
    "mistral", "llama", "kimi", "minimax", "mimo", "grok", "nova",
    "flux", "stable", "sdxl", "sarvam", "seed", "north", "nex",
    "sensenova", "step", "typhoon", "villanova", "wai", "whisper",
    "riva", "plamo", "jina", "sea-lion", "l3", "l3.3", "laguna",
    "leanstral", "ling", "longcat", "majicmix", "manta", "muse",
    "mn-violet", "ntr-mix", "or-", "prefect-pony", "quiet-goodnight",
    "qwen-sea-lion", "qwen2.5", "qwen3", "qwq", "realistic-vision",
    "rev-animated", "swamponyxl", "swe-1", "text-embedding", "tunix",
    "villanova", "zen",
];

fn extract_provider(model_id: &str) -> String {
    for p in ["zen/", "antigravity/", "openai/", "tokenrouter/", "srouter/"] {
        if model_id.starts_with(p) {
            return p.trim_end_matches('/').to_string();
        }
    }
    let parts: Vec<&str> = model_id.split('/').collect();
    if parts.len() >= 2 {
        let model_name = parts[1..].join("/");
        for k in KNOWN_PROVIDERS {
            if model_name.starts_with(k) {
                return k.to_string();
            }
        }
        return model_name
            .split('-')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or("router")
            .to_string();
    }
    "router".to_string()
}

fn simplify_id(full_id: &str) -> String {
    let parts: Vec<&str> = full_id.split('/').collect();
    if parts.len() >= 2 {
        parts[1..].join("/")
    } else {
        full_id.to_string()
    }
}

pub async fn handler() -> Response {
    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": { "message": e.to_string() } })),
            )
                .into_response()
        }
    };

    let res = client.get(ROUTER_MODELS_URL).send().await;
    let router_data: Value = match res {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(e) => {
                return (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": { "message": e.to_string() } })),
                )
                    .into_response()
            }
        },
        Ok(r) => {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": { "message": format!("Router HTTP {}", r.status()) } })),
            )
                .into_response()
        }
        Err(e) => {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": { "message": e.to_string() } })),
            )
                .into_response()
        }
    };

    let Some(arr) = router_data.get("data").and_then(|d| d.as_array()) else {
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": { "message": "Invalid router response format" } })),
        )
            .into_response();
    };

    let data: Vec<Value> = arr
        .iter()
        .map(|m| {
            let full_id = m.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let custom = m.get("custom").and_then(|c| c.as_bool()).unwrap_or(false);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            json!({
                "id": if custom { Value::String(full_id.to_string()) } else { Value::String(simplify_id(full_id)) },
                "object": m.get("object").cloned().unwrap_or(json!("model")),
                "created": m.get("created").cloned().unwrap_or(json!(now)),
                "owned_by": if custom {
                    m.get("owned_by").cloned().unwrap_or(json!("custom"))
                } else {
                    Value::String(extract_provider(full_id))
                },
            })
        })
        .collect();

    Json(json!({ "object": "list", "data": data })).into_response()
}

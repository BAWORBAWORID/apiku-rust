// HF DeepSeek Chat Completions — native conversion of api/v1/chat/completions.js
// OpenAI-compatible proxy to HuggingFace DeepSeek endpoint. Plain JSON (no SSE).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const HF_ENDPOINT: &str = "https://q5dh1rfszfym23hj.us-east-2.aws.endpoints.huggingface.cloud/v1/chat/completions";
const HF_MODEL: &str = "deepseek-ai/DeepSeek-V4-Flash-0731";

pub async fn handler(
    Query(_query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let body = body.map(|Json(b)| b).unwrap_or_else(|| json!({}));
    let model = body
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or(HF_MODEL)
        .to_string();
    let messages = body.get("messages").cloned();

    let messages = match messages {
        Some(Value::Array(arr)) if !arr.is_empty() => Value::Array(arr),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "error": { "message": "Parameter 'messages' wajib diisi (array tidak kosong)" }
            })))
            .into_response()
        }
    };

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "error": { "message": e.to_string() }
            })))
            .into_response()
        }
    };

    match client
        .post(HF_ENDPOINT)
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer not-needed")
        .body(json!({ "model": model, "messages": messages }).to_string())
        .send()
        .await
    {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let data: Value = resp.json().await.unwrap_or(json!({}));
            (status, Json(data)).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": { "message": e.to_string() } })),
        )
            .into_response(),
    }
}

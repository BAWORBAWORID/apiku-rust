// Router Chat Completions V2 — native conversion of api/v2/chat/completions.js
// OpenAI-compatible proxy to router.zyvor.my.id; supports SSE streaming passthrough.
use axum::{
    body::Body,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const ROUTER_ENDPOINT: &str = "https://router.zyvor.my.id/v1/chat/completions";

pub async fn handler(
    Query(_query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let body = body.map(|Json(b)| b).unwrap_or_else(|| json!({}));

    let model = match body.get("model").and_then(|m| m.as_str()) {
        Some(m) if !m.is_empty() => m.to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "error": { "message": "Parameter 'model' wajib diisi" }
            })))
            .into_response()
        }
    };
    let messages = match body.get("messages") {
        Some(Value::Array(arr)) if !arr.is_empty() => Value::Array(arr.clone()),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "error": { "message": "Parameter 'messages' wajib diisi (array tidak kosong)" }
            })))
            .into_response()
        }
    };

    let stream = body.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
    let forward = json!({
        "model": model,
        "messages": messages,
        "temperature": body.get("temperature").cloned().unwrap_or(json!(0.7)),
        "max_tokens": body.get("max_tokens").cloned().unwrap_or(Value::Null),
        "stream": stream,
        "top_p": body.get("top_p").cloned().unwrap_or(json!(1)),
        "frequency_penalty": body.get("frequency_penalty").cloned().unwrap_or(json!(0)),
        "presence_penalty": body.get("presence_penalty").cloned().unwrap_or(json!(0)),
    });

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

    let resp = client
        .post(ROUTER_ENDPOINT)
                    .header("Content-Type", "application/json")
        .body(forward.to_string())
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "error": { "message": e.to_string() }
            })))
            .into_response()
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    if stream {
        let byte_stream = resp.bytes_stream();
        return Response::builder()
            .status(status)
                        .header("Content-Type", "text/event-stream")
                        .header("Cache-Control", "no-cache")
                        .header("Connection", "keep-alive")
            .body(Body::from_stream(byte_stream))
            .unwrap()
            .into_response();
    }

    let data: Value = resp.json().await.unwrap_or(json!({}));
    (status, Json(data)).into_response()
}

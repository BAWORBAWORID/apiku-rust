use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const API_BASE: &str = "https://tutorgpt.io";
const CHAT_ENDPOINT: &str = "/api/v1/chat/stream";
const DEFAULT_MODEL: &str = "gpt-5.6-luna";

#[derive(Debug, Deserialize)]
pub struct TutorGptParams {
    pub text: Option<String>,
    pub session: Option<String>,
    pub model: Option<String>,
    pub tone: Option<String>,
    pub length: Option<String>,
}

pub async fn handler(
    Query(query): Query<TutorGptParams>,
    body: Option<Json<TutorGptParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let message = params.text.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let tone = params.tone.unwrap_or_else(|| "default".to_string());
    let length = params.length.unwrap_or_else(|| "moderate".to_string());
    let conv_id = params.session.unwrap_or_else(|| {
        format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
            rand::random::<u32>(),
            rand::random::<u16>(),
            rand::random::<u16>() & 0x0fff,
            rand::random::<u16>() & 0x3fff | 0x8000,
            rand::random::<u64>() & 0xffffffffffff,
        )
    });

    if message.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "message": &message,
        "language": "auto",
        "model": &model,
        "tone": &tone,
        "length": &length,
        "conversation_id": &conv_id,
        "image_urls": [],
        "chat_mode": "standard"
    });

    let res = client
        .post(format!("{}{}", API_BASE, CHAT_ENDPOINT))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json, text/event-stream")
        .header("Origin", API_BASE)
        .header("Referer", format!("{}/", API_BASE))
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut answer = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data:") {
                    continue;
                }
                let data_str = trimmed.trim_start_matches("data:").trim();
                if data_str.is_empty() || data_str == "[DONE]" {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(content) = val.get("content").and_then(|c| c.as_str()) {
                        answer.push_str(content);
                    } else if let Some(delta) = val.pointer("/choices/0/delta/content").and_then(|d| d.as_str()) {
                        answer.push_str(delta);
                    }
                }
            }

            if answer.is_empty() {
                answer = body_str.trim().to_string();
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": answer.trim(),
                    "conversation_id": conv_id,
                    "model": model
                })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": e.to_string()
            })),
        ),
    }
}

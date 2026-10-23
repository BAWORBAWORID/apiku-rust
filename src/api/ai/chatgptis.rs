use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

const BASE_URL: &str = "https://chatgptis.org";

#[derive(Debug, Deserialize)]
pub struct ChatGptisParams {
    pub message: Option<String>,
    pub model: Option<String>,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Serialize)]
struct ChatGptisPayload<'a> {
    messages: Vec<ChatMessage<'a>>,
    model: &'a str,
}

pub async fn handler(
    Query(query): Query<ChatGptisParams>,
    body: Option<Json<ChatGptisParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let message = params.message.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "gpt".to_string()).to_lowercase();
    let conversation_id = params.conversation_id;

    let available = ["gpt", "claude", "gemini", "grok", "deepseek", "qwen", "kimi", "perplexity"];
    if !available.contains(&model.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": format!("Model tidak tersedia. Pilihan: {}", available.join(", "))
            })),
        );
    }

    if message.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'message' wajib"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = ChatGptisPayload {
        messages: vec![ChatMessage {
            role: "user",
            content: &message,
        }],
        model: &model,
    };

    let res = client
        .post(format!("{}/api/chat", BASE_URL))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Zyvor/1.0")
        .header("Referer", format!("{}/chat", BASE_URL))
        .header("Origin", BASE_URL)
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let text = resp.text().await.unwrap_or_default();
            let model_label = match model.as_str() {
                "gpt" => "GPT",
                "claude" => "Claude",
                "gemini" => "Gemini",
                "grok" => "Grok",
                "deepseek" => "DeepSeek",
                "qwen" => "Qwen",
                "kimi" => "Kimi",
                "perplexity" => "Perplexity",
                _ => &model,
            };

            let conv_id = conversation_id.unwrap_or_else(|| {
                format!("conv-{}", chrono::Utc::now().timestamp_millis())
            });

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": {
                        "text": text.trim(),
                        "model": model_label,
                        "conversation_id": conv_id
                    }
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct ChatAiParams {
    pub teks: Option<String>,
    pub model: Option<String>,
    pub session: Option<String>,
}

pub async fn handler(
    Query(query): Query<ChatAiParams>,
    body: Option<Json<ChatAiParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.teks.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "chatgpt".to_string()).to_lowercase();

    if prompt.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let resolved_model = match model.as_str() {
        "chatgpt" => "openai",
        "claude" => "claude",
        "gemini" => "gemini",
        "deepseek" => "deepseek",
        "qwen" => "qwen",
        _ => "openai",
    };

    let encoded = urlencoding::encode(&prompt);
    let url = format!("https://text.pollinations.ai/{}?model={}", encoded, resolved_model);

    let res = client
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0")
        .send()
        .await;

    match res {
        Ok(resp) => {
            let answer = resp.text().await.unwrap_or_default();
            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "model": model,
                    "result": answer.trim(),
                    "provider": "chatai.org"
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

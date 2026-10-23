use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct NoteGptParams {
    pub message: Option<String>,
    pub model: Option<String>,
    pub conversation_id: Option<String>,
}

pub async fn handler(
    Query(query): Query<NoteGptParams>,
    body: Option<Json<NoteGptParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let message = params.message.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "gpt-4o-mini".to_string());
    let conv_id = params.conversation_id.unwrap_or_else(|| {
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
                "message": "Parameter 'message' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let encoded = urlencoding::encode(&message);
    let url = format!("https://text.pollinations.ai/{}?model=openai", encoded);

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
                    "conversation_id": conv_id,
                    "result": answer.trim()
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

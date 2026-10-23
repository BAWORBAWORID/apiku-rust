use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

const API_URL: &str = "https://rough-mouse-ae3c.musharaf-h-abid.workers.dev/chat";

#[derive(Debug, Deserialize)]
pub struct VoidChatParams {
    pub text: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct WorkerPayload<'a> {
    message: &'a str,
}

#[derive(Debug, Deserialize)]
struct WorkerResponse {
    answer: Option<String>,
}

pub async fn handler(
    Query(query): Query<VoidChatParams>,
    body: Option<Json<VoidChatParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let text = params.text.unwrap_or_default().trim().to_string();
    let model = params
        .model
        .unwrap_or_else(|| "deepseek/deepseek-chat-v3-0324".to_string());

    if text.is_empty() {
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

    let res = client
        .post(API_URL)
                    .header("Content-Type", "application/json")
        .json(&WorkerPayload { message: &text })
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<WorkerResponse>().await {
                (
                    StatusCode::OK,
                    Json(json!({
                        "status": true,
                        "result": data.answer.unwrap_or_default(),
                        "model": model
                    })),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal memproses response dari VoidChat"
                    })),
                )
            }
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE_URL: &str = "https://app.helvast.com";

#[derive(Debug, Deserialize)]
pub struct IslamiParams {
    pub teks: Option<String>,
    pub session: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HelvastResponse {
    reply: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    has_answer: Option<bool>,
    confidence: Option<f64>,
    semantic_search_used: Option<bool>,
}

pub async fn handler(
    Query(query): Query<IslamiParams>,
    body: Option<Json<IslamiParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let message = params.teks.unwrap_or_default().trim().to_string();
    let session_id = params.session.unwrap_or_else(|| {
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
                "message": "Parameter 'teks' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "message": &message,
        "userId": 1,
        "workspaceId": 2,
        "sessionId": &session_id,
        "history": [{ "role": "user", "text": &message }],
        "browserLanguage": "id"
    });

    let res = client
        .post(format!("{}/api/chat", BASE_URL))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("Origin", BASE_URL)
        .header("Referer", format!("{}/", BASE_URL))
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<HelvastResponse>().await {
                if let Some(reply) = data.reply {
                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": true,
                            "result": {
                                "sessionId": data.session_id.unwrap_or(session_id),
                                "message": message,
                                "reply": reply,
                                "has_answer": data.has_answer,
                                "confidence": data.confidence,
                                "semantic_search_used": data.semantic_search_used
                            }
                        })),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "status": false,
                            "message": "Response tidak valid dari Helvast"
                        })),
                    )
                }
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal membaca format JSON dari Islami AI"
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct NoTrackParams {
    pub text: Option<String>,
    pub session_id: Option<String>,
}

pub async fn handler(
    Query(query): Query<NoTrackParams>,
    body: Option<Json<NoTrackParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let text = params.text.unwrap_or_default().trim().to_string();
    let session_id = params.session_id.unwrap_or_else(|| "notrack-default".to_string());

    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter text wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "user_input": &text,
        "mode": "usual",
        "model": "C",
        "persona": "normal",
        "max_turns": 6,
        "chat_id": null,
        "attachments": [],
        "regenerate": false,
        "edit": false,
        "edit_mid": null
    });

    let res = client
        .post("https://notrack.ai/api/dispatch")
                    .header("Accept", "*/*")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://notrack.ai")
                    .header("Referer", "https://notrack.ai/chat")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut final_answer = String::new();
            let mut returned_chat_id = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data: ") {
                    continue;
                }
                let data_str = &trimmed[6..].trim();
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
                        if t == "chat_meta" {
                            if let Some(cid) = v.get("chat_id").and_then(|c| c.as_str()) {
                                returned_chat_id = cid.to_string();
                            }
                        } else if t == "delta" {
                            if let Some(chunk) = v.get("chunk").and_then(|c| c.as_str()) {
                                final_answer.push_str(chunk);
                            }
                        }
                    }
                }
            }

            if final_answer.is_empty() {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "status": false,
                        "message": "Tidak ada respons dari AI"
                    })),
                );
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": {
                        "answer": final_answer,
                        "chatId": returned_chat_id,
                        "sessionId": session_id
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct Gpt5Params {
    pub teks: Option<String>,
    pub model: Option<String>,
}

pub async fn handler(
    Query(query): Query<Gpt5Params>,
    body: Option<Json<Gpt5Params>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "openai/gpt-5.4".to_string());

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        .cookie_store(true)
        
        .build()
        .unwrap_or_default();

    let user_agent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

    // 1. Init cookies
    let _ = client
        .get("https://chat.chatex.ai/en")
        .header("User-Agent", user_agent)
                    .header("Accept", "text/html")
        .send()
        .await;

    // 2. Fingerprint
    let fpid: String = (0..16)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect();

    let _ = client
        .post("https://chat.chatex.ai/api/v/fingerprint")
        .header("User-Agent", user_agent)
                    .header("Origin", "https://chat.chatex.ai")
                    .header("Referer", "https://chat.chatex.ai/en")
        .json(&json!({
            "fpid": fpid,
            "confidence": 0.4,
            "version": "5.0.1"
        }))
        .send()
        .await;

    // 3. Chat request
    let chat_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );
    let message_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let chat_payload = json!({
        "id": chat_id,
        "message": {
            "role": "user",
            "parts": [{ "type": "text", "text": &teks }],
            "id": message_id
        },
        "selectedChatModel": &model,
        "selectedVisibilityType": "private",
        "webSearchEnabled": false,
        "imageGenerationEnabled": false,
        "isExistingChat": false
    });

    let res = client
        .post("https://chat.chatex.ai/api/chat")
        .header("User-Agent", user_agent)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .header("Origin", "https://chat.chatex.ai")
                    .header("Referer", "https://chat.chatex.ai/en")
        .json(&chat_payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut text = String::new();
            let mut used_model = model.clone();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data: ") {
                    continue;
                }
                let data_str = &trimmed[6..].trim();
                if *data_str == "[DONE]" {
                    continue;
                }
                if let Ok(ev) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(t) = ev.get("type").and_then(|t| t.as_str()) {
                        if t == "text-delta" {
                            if let Some(delta) = ev.get("delta").and_then(|d| d.as_str()) {
                                text.push_str(delta);
                            }
                        } else if t == "data-usage" {
                            if let Some(mid) = ev.pointer("/data/modelId").and_then(|m| m.as_str()) {
                                used_model = mid.to_string();
                            }
                        }
                    }
                }
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "input": teks,
                    "model": used_model,
                    "result": text.trim(),
                    "timestamp": chrono::Utc::now().timestamp_millis()
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

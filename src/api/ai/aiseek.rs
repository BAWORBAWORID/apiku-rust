use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const APP_ID: &str = "ai-seek";
const PKG: &str = "ai.chatbot.ask.chat.deep.seek.assistant.search.free";
const VER: &str = "2.9.4-26071777";

#[derive(Debug, Deserialize)]
pub struct AiSeekParams {
    pub message: Option<String>,
    pub model: Option<String>,
    pub session_id: Option<String>,
}

fn generate_random_hex(len: usize) -> String {
    (0..len)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect::<String>()[..len]
        .to_string()
}

pub async fn handler(
    Query(query): Query<AiSeekParams>,
    body: Option<Json<AiSeekParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.message.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "deepseek/deepseek-chat".to_string());
    let session_id = params.session_id.unwrap_or_else(|| {
        format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
            rand::random::<u32>(),
            rand::random::<u16>(),
            rand::random::<u16>() & 0x0fff,
            rand::random::<u16>() & 0x3fff | 0x8000,
            rand::random::<u64>() & 0xffffffffffff,
        )
    });

    if prompt.is_empty() {
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

    let aid = generate_random_hex(16);
    let sec = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    // 1. Get Secret Token
    let token_res = client
        .post("https://saas.castbox.fm/auth/api/v1/tokens/provider/secret")
                    .header("User-Agent", "Zyvor/1.0")
                    .header("Content-Type", "application/json")
        .header("x-app-id", APP_ID)
        .json(&json!({ "secret": sec }))
        .send()
        .await;

    let token = match token_res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                data.pointer("/data/token").and_then(|t| t.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let Some(token) = token else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": "Gagal autentikasi ke Castbox/AISeek"
            })),
        );
    };

    let dev_info = format!("appIdentifier={};appVersion={};deviceType=android;deviceCountry=ID;appCountry=id;local=id_ID;language=id;timezone=Asia/Makassar;brand=Infinix;model=Infinix%20X6833B;androidId={}", PKG, VER, aid);

    // 2. Chat Send
    let user_msg_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );
    let ai_msg_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let chat_payload = json!({
        "sessionId": session_id,
        "userMessageId": user_msg_id,
        "aiMessageId": ai_msg_id,
        "model": model,
        "text": prompt,
        "restrictedType": "FREE_USER",
        "sessionType": "NORMAL",
        "imageS3Keys": []
    });

    let res = client
        .post("https://ai-seek.thebetter.ai/v4/chat/send")
                    .header("Accept", "text/event-stream")
                    .header("Content-Type", "application/json")
        .header("x-app-id", APP_ID)
        .header("x-device-info", &dev_info)
        .header("x-access-token", &token)
                    .header("User-Agent", "Zyvor/1.0")
        .json(&chat_payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut text = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data:") {
                    continue;
                }
                let data_str = trimmed.trim_start_matches("data:").trim();
                if data_str.is_empty() || data_str == "[DONE]" {
                    continue;
                }
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(c) = p.get("content").and_then(|c| c.as_str()) {
                        text.push_str(c);
                    }
                }
            }

            if text.is_empty() {
                text = body_str.trim().to_string();
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": {
                        "response": text.trim(),
                        "model": model,
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

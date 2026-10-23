use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};

const API_BASE: &str = "https://aga-api.aichatting.net";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PUBLIC_KEY_PEM: &str = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB\n-----END PUBLIC KEY-----";

#[derive(Debug, Deserialize)]
pub struct AiChattingParams {
    pub text: Option<String>,
    pub model: Option<String>,
    pub session: Option<String>,
}

fn generate_visitor_token() -> Option<String> {
    let mut rng = rand::thread_rng();
    let id_chars: String = (0..15)
        .map(|_| {
            let hex = "0123456789abcdef";
            let idx = rand::random::<usize>() % hex.len();
            hex.chars().nth(idx).unwrap()
        })
        .collect();
    let id = format!("e{}", id_chars);

    let public_key = RsaPublicKey::from_public_key_pem(PUBLIC_KEY_PEM).ok()?;
    let enc_bytes = public_key.encrypt(&mut rng, Pkcs1v15Encrypt, id.as_bytes()).ok()?;
    Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &enc_bytes))
}

pub async fn handler(
    Query(query): Query<AiChattingParams>,
    body: Option<Json<AiChattingParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let text = params.text.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "gpt-5.6-luna".to_string());

    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })),
        );
    }

    let Some(v_token) = generate_visitor_token() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": "Gagal generate visitor token"
            })),
        );
    };

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    // 1. Create conversation
    let conv_res = client
        .post(format!("{}/aigc/chat/record/conversation/create", API_BASE))
        .header("User-Agent", UA)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream,application/json")
                    .header("source", "web")
                    .header("lang", "en")
        .header("vToken", &v_token)
        .json(&json!({ "roleId": 0 }))
        .send()
        .await;

    let conv_id = match conv_res {
        Ok(resp) => {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                v.pointer("/data/conversationId").and_then(|id| {
                    if let Some(n) = id.as_i64() {
                        Some(n.to_string())
                    } else {
                        id.as_str().map(|s| s.to_string())
                    }
                })
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let conv_id = conv_id.unwrap_or_else(|| format!("{}", rand::random::<u32>() % 90000000 + 10000000));

    // 2. Ask AI Stream
    let ask_payload = json!({
        "spaceHandle": true,
        "roleId": 0,
        "conversationId": conv_id,
        "model": &model,
        "messages": [
            { "role": "user", "content": &text }
        ]
    });

    let res = client
        .post(format!("{}/aigc/chat/v2/askai/stream", API_BASE))
        .header("User-Agent", UA)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream,application/json")
                    .header("source", "web")
                    .header("lang", "en")
        .header("vToken", &v_token)
        .json(&ask_payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut reply = String::new();

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
                        reply.push_str(content);
                    }
                }
            }

            if reply.is_empty() {
                reply = body_str.trim().to_string();
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": reply.trim(),
                    "model": model,
                    "session": conv_id
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

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

const API: &str = "https://aga-api.aichatting.net/aigc/chat/v2/professional/stream";
const MODEL: &str = "gpt-4o-mini";
const PUBLIC_KEY_PEM: &str = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB\n-----END PUBLIC KEY-----";

#[derive(Debug, Deserialize)]
pub struct Gpt4oMiniParams {
    pub teks: Option<String>,
    pub image: Option<String>,
    pub session: Option<String>,
}

fn encrypt_visitor_id(visitor_id: &str) -> Option<String> {
    let mut rng = rand::thread_rng();
    let public_key = RsaPublicKey::from_public_key_pem(PUBLIC_KEY_PEM).ok()?;
    let enc_bytes = public_key.encrypt(&mut rng, Pkcs1v15Encrypt, visitor_id.as_bytes()).ok()?;
    Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &enc_bytes))
}

pub async fn handler(
    Query(query): Query<Gpt4oMiniParams>,
    body: Option<Json<Gpt4oMiniParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi"
            })),
        );
    }

    let visitor_id: String = (0..16)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect();

    let Some(v_token) = encrypt_visitor_id(&visitor_id) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": "Gagal generate visitor token"
            })),
        );
    };

    let conv_id = rand::random::<u32>() % 90000000 + 10000000;

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let user_agent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";

    let payload = json!({
        "conversationId": conv_id,
        "model": MODEL,
        "messages": [
            { "role": "user", "content": &teks }
        ],
        "spaceHandle": true,
        "scene": "chat"
    });

    let res = client
        .post(API)
        .header("User-Agent", user_agent)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream,application/json")
                    .header("source", "web")
                    .header("lang", "en")
        .header("vToken", &v_token)
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
                    "input": teks,
                    "model": MODEL,
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

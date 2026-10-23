use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use sha1::{Digest, Sha1};

const BASE_URL: &str = "https://api.aichatbotassistant.top";
const BUNDLE_ID: &str = "com.chatassistant.aichatbot.gp";
const SIGN_SALT: &str = "t6KeG6aKR5pm65oWn5aqS6LWE57O757ufS2V2aW4uWWFuZw";
const AES_KEY: &[u8; 16] = b"V7PbuImUgSzpo4Hx";
const AES_IV: &[u8; 16] = b"yc0q2icx1oq4lijm";

#[derive(Debug, Deserialize)]
pub struct CloudAiParams {
    pub teks: Option<String>,
    #[serde(rename = "needSearch")]
    pub need_search: Option<i32>,
    #[serde(rename = "conversationId")]
    pub conversation_id: Option<String>,
}

fn encrypt_aes_128_cbc(data: &[u8]) -> Option<String> {
    use cbc::cipher::{block_padding::Pkcs7, BlockModeEncrypt, KeyIvInit};
    type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

    let mut buf = vec![0u8; data.len() + 16];
    buf[..data.len()].copy_from_slice(data);

    let encryptor = Aes128CbcEnc::new(AES_KEY.into(), AES_IV.into());
    let ct = encryptor
        .encrypt_padded::<Pkcs7>(&mut buf, data.len())
        .ok()?;

    Some(hex::encode(ct).to_uppercase())
}

pub async fn handler(
    Query(query): Query<CloudAiParams>,
    body: Option<Json<CloudAiParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let question = params.teks.unwrap_or_default().trim().to_string();
    let conv_id = params.conversation_id.unwrap_or_default();
    let need_search = params.need_search.unwrap_or(0);

    if question.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Question is required."
            })),
        );
    }

    let device_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    // 1. Register device
    let _ = client
        .post(format!("{}/mb/createNewUser", BASE_URL))
                    .header("User-Agent", "Neo/1.0")
        .header("DeviceId", &device_id)
                    .header("AppVersion", "1.0.2")
                    .header("Content-Type", "application/json;charset=UTF-8")
        .header("BundleId", BUNDLE_ID)
        .json(&json!({
            "deviceMac": &device_id,
            "bundleId": BUNDLE_ID,
            "bundleVersion": "1.0.2"
        }))
        .send()
        .await;

    // 2. Prepare payload and sign
    let timestamp = chrono::Utc::now().timestamp();
    let nonce: String = (0..16)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect();
    let model = "BOLATU:claude-haiku-4-5-20251001";

    let qs = format!(
        "aiVersion={}&bundle={}&conversationId={}&deviceMac={}&nonce={}&question={}&timestamp={}",
        model, BUNDLE_ID, conv_id, device_id, nonce, question, timestamp
    );

    let mut hasher = Sha1::new();
    hasher.update(format!("{}{}", qs, SIGN_SALT));
    let signature = hex::encode(hasher.finalize());

    let full_data = json!({
        "question": question,
        "conversationId": conv_id,
        "needSearch": need_search,
        "bundle": BUNDLE_ID,
        "deviceMac": device_id,
        "timestamp": timestamp,
        "nonce": nonce,
        "aiVersion": model,
        "userName": "Anonim",
        "signature": signature
    });

    let encrypted = encrypt_aes_128_cbc(full_data.to_string().as_bytes()).unwrap_or_default();

    let res = client
        .post(format!("{}/common/sse/chat", BASE_URL))
                    .header("User-Agent", "Neo/1.0")
        .header("DeviceId", &device_id)
                    .header("AppVersion", "1.0.2")
                    .header("Content-Type", "application/json")
        .header("BundleId", BUNDLE_ID)
        .json(&json!({
            "bundle": BUNDLE_ID,
            "security": encrypted
        }))
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut text = String::new();
            let mut returned_conv_id = conv_id.clone();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if trimmed == "data: [DONE]" {
                    break;
                }
                if trimmed.starts_with("data: ") {
                    let d = &trimmed[6..].trim();
                    if let Ok(p) = serde_json::from_str::<serde_json::Value>(d) {
                        if let Some(ans) = p.pointer("/data/answer").and_then(|a| a.as_str()) {
                            text.push_str(ans);
                        }
                        if let Some(cid) = p.pointer("/data/conversation_id").and_then(|c| c.as_str()) {
                            returned_conv_id = cid.to_string();
                        }
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
                    "result": text.trim(),
                    "conversationId": returned_conv_id,
                    "deviceId": device_id
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

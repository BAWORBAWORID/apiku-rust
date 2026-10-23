use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE: &str = "https://android.chat.openai.com/backend-anon";
const UA: &str = "ChatGPT/1.2026.181 (Android 16; Neo/1.0; build 2222222)";
const DEVICE_TIER: &str = "upper_mid";

#[derive(Debug, Deserialize)]
pub struct ChatGptParams {
    pub teks: Option<String>,
    pub session: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RequirementsResponse {
    token: Option<String>,
}

fn clean_special_tags(text: &str) -> String {
    let re_entity = regex::Regex::new(r"\x{e200}entity\x{e202}([^\x{e201}]+)\x{e201}").unwrap();
    let cleaned = re_entity.replace_all(text, |caps: &regex::Captures| {
        if let Some(m) = caps.get(1) {
            if let Ok(arr) = serde_json::from_str::<serde_json::Value>(m.as_str()) {
                if let Some(s) = arr.get(1).or_else(|| arr.get(0)).and_then(|v| v.as_str()) {
                    return s.to_string();
                }
            }
        }
        "".to_string()
    });

    let re_clean = regex::Regex::new(r"\x{e200}[^\x{e201}]*\x{e201}").unwrap();
    re_clean.replace_all(&cleaned, "").trim().to_string()
}

pub async fn handler(
    Query(query): Query<ChatGptParams>,
    body: Option<Json<ChatGptParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();
    let session_id = params.session;

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi"
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
        .cookie_store(true)
        
        .build()
        .unwrap_or_default();

    // 1. Requirements
    let req_res = client
        .post(format!("{}/sentinel/chat-requirements", BASE))
        .header("User-Agent", UA)
                    .header("OAI-Package-Name", "com.openai.chatgpt")
                    .header("OAI-Client-Type", "android")
        .header("OAI-Device-Id", &device_id)
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8")
        .header("X-Device-Tier", DEVICE_TIER)
                    .header("X-OpenAI-Target-Path", "/backend-anon/sentinel/chat-requirements")
                    .header("ChatGPT-Account-Id", "default")
                    .header("ChatGPT-Residency-Region", "no_constraint")
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .await;

    let oai_token = match req_res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<RequirementsResponse>().await {
                data.token
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let oai_sc = oai_token.map(|t| format!("oai-sc=0{};", t)).unwrap_or_default();

    // 2. Conversation
    let current_msg_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let conv_payload = json!({
        "action": "next",
        "messages": [{
            "id": current_msg_id,
            "author": { "role": "user" },
            "content": { "content_type": "text", "parts": [&teks] },
            "status": "finished_successfully",
            "recipient": "all"
        }],
        "model": "auto",
        "history_and_training_disabled": false,
        "fork_from_shared_post": false,
        "enable_message_followups": true,
        "force_use_sse": true,
        "force_use_search": null,
        "force_paragen": false,
        "supported_encodings": ["v1"],
        "supports_buffering": true,
        "timezone": "Asia/Makassar",
        "timezone_offset_min": -480,
        "system_hints": [],
        "is_onboarding_conversation": false,
        "no_auth_ad_preferences": { "personalization_enabled": true, "history_enabled": true },
        "client_prepare_state": "none",
        "stream": true
    });

    let res = client
        .post(format!("{}/f/conversation", BASE))
        .header("User-Agent", UA)
                    .header("OAI-Package-Name", "com.openai.chatgpt")
                    .header("OAI-Client-Type", "android")
        .header("OAI-Device-Id", &device_id)
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8")
        .header("X-Device-Tier", DEVICE_TIER)
                    .header("X-OpenAI-Target-Path", "/backend-anon/f/conversation")
                    .header("ChatGPT-Account-Id", "default")
                    .header("ChatGPT-Residency-Region", "no_constraint")
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
        .header("Cookie", &oai_sc)
                    .header("Origin", "https://chatgpt.com")
                    .header("Referer", "https://chatgpt.com/")
        .json(&conv_payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut final_text = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data: ") || trimmed == "data: [DONE]" {
                    continue;
                }
                let data_str = &trimmed[6..].trim();
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(parts) = v.pointer("/v/message/content/parts").and_then(|p| p.as_array()) {
                        if let Some(first) = parts.get(0).and_then(|f| f.as_str()) {
                            final_text = first.to_string();
                        }
                    } else if let Some(delta) = v.pointer("/choices/0/delta/content").and_then(|d| d.as_str()) {
                        final_text.push_str(delta);
                    }
                }
            }

            let clean_result = clean_special_tags(&final_text);
            let display_text = if clean_result.is_empty() {
                "Halo! Ada yang bisa saya bantu?".to_string()
            } else {
                clean_result
            };

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "input": teks,
                    "result": display_text,
                    "session_id": session_id
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

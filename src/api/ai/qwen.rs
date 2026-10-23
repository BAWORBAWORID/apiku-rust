use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE_HEADERS: &[(&str, &str)] = &[
    ("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"),
    ("Accept-Language", "id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6"),
    ("sec-ch-ua", "\"Chromium\";v=\"139\", \"Not;A=Brand\";v=\"99\""),
    ("sec-ch-ua-mobile", "?1"),
    ("sec-ch-ua-platform", "\"Android\""),
];

const UMID: &str = "T2gA0mRGd-Nvxy5nhKezRG4el_l-L6JAzrBjEmPO3PH6tCB11ptPmUbqqPkK3CpEWH0=";
const CNA: &str = "ylxMIe27ME0CAX2kC7MMZtMd";
const BL_UID: &str = "ChmR5q03mmLm5vht59Xh6C8wz0Xg";
const SCA: &str = "daf1f517";

#[derive(Debug, Deserialize)]
pub struct QwenParams {
    pub teks: Option<String>,
    pub model: Option<String>,
}

pub async fn handler(
    Query(query): Query<QwenParams>,
    body: Option<Json<QwenParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.teks.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "qwen3.7-plus".to_string());

    if prompt.is_empty() {
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

    // 1. Get Session / Cookie
    let _ = client
        .get("https://chat.qwen.ai")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36")
                    .header("Referer", "https://qwen.ai/")
        .header("Cookie", format!("cna={}; sca={}; _bl_uid={}; qwen-theme=dark", CNA, SCA, BL_UID))
        .send()
        .await;

    // 2. Create Chat
    let req_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let new_chat_payload = json!({
        "title": "New Chat",
        "models": [&model],
        "chat_mode": "guest",
        "chat_type": "t2t",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "project_id": ""
    });

    let new_chat_res = client
        .post("https://chat.qwen.ai/api/v2/chats/new")
                    .header("Content-Type", "application/json")
                    .header("Version", "0.2.66")
                    .header("source", "h5")
                    .header("bx-v", "2.5.36")
        .header("bx-umidtoken", UMID)
        .header("X-Request-Id", &req_id)
                    .header("Origin", "https://chat.qwen.ai")
                    .header("Referer", "https://chat.qwen.ai/c/new-chat")
        .header("Cookie", format!("cna={}; sca={}; _bl_uid={}; qwen-theme=dark", CNA, SCA, BL_UID))
        .json(&new_chat_payload)
        .send()
        .await;

    let chat_id = match new_chat_res {
        Ok(resp) => {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                v.pointer("/data/id").and_then(|id| id.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let chat_id = chat_id.unwrap_or_else(|| {
        format!("{:08x}{:08x}", rand::random::<u32>(), rand::random::<u32>())
    });

    // 3. Completions
    let msg_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let comp_payload = json!({
        "stream": true,
        "version": "2.1",
        "incremental_output": true,
        "chat_id": chat_id,
        "chat_mode": "guest",
        "model": &model,
        "parent_id": null,
        "messages": [
            {
                "fid": msg_id,
                "parentId": null,
                "childrenIds": [],
                "role": "user",
                "content": &prompt,
                "user_action": "chat",
                "files": [],
                "timestamp": chrono::Utc::now().timestamp(),
                "models": [&model],
                "chat_type": "t2t",
                "feature_config": {
                    "thinking_enabled": false,
                    "output_schema": "phase"
                },
                "extra": { "meta": { "subChatType": "t2t" } },
                "sub_chat_type": "t2t"
            }
        ],
        "timestamp": chrono::Utc::now().timestamp_millis()
    });

    let res = client
        .post(format!("https://chat.qwen.ai/api/v2/chat/completions?chat_id={}", chat_id))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Version", "0.2.66")
                    .header("source", "h5")
                    .header("bx-v", "2.5.36")
        .header("bx-umidtoken", UMID)
        .header("X-Request-Id", &req_id)
                    .header("Origin", "https://chat.qwen.ai")
                    .header("Referer", "https://chat.qwen.ai/c/guest")
        .header("Cookie", format!("cna={}; sca={}; _bl_uid={}; qwen-theme=dark", CNA, SCA, BL_UID))
        .json(&comp_payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut text = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data: ") {
                    continue;
                }
                let data_str = &trimmed[6..].trim();
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(data_str) {
                    let delta = j.pointer("/choices/0/delta");
                    if let Some(content) = delta.and_then(|d| d.get("content")).and_then(|c| c.as_str()) {
                        text.push_str(content);
                    }
                }
            }

            if text.is_empty() {
                text = "Mohon maaf, upstream Qwen sedang sibuk. Silakan coba kembali sesaat lagi.".to_string();
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": text.trim()
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

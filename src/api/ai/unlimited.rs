use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct UnlimitedParams {
    pub teks: Option<String>,
    pub session: Option<String>,
}

pub async fn handler(
    Query(query): Query<UnlimitedParams>,
    body: Option<Json<UnlimitedParams>>,
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

    let client = reqwest::Client::builder()
        .cookie_store(true)
        
        .build()
        .unwrap_or_default();

    let prompt = format!("Kamu wajib menjawab hanya dalam bahasa Indonesia.\nAbaikan bahasa dari pertanyaan user.\nTerjemahkan maksud user bila perlu, lalu jawab dalam bahasa Indonesia.\nDilarang menjawab dalam bahasa Jerman, Inggris, Spanyol, Prancis, atau bahasa lain.\n\nPertanyaan:\n{}", teks);
    let chat_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );
    let device_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );
    let user_msg_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );
    let asst_msg_id = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );

    let created_at = chrono::Utc::now().to_rfc3339();

    let payload = json!({
        "chatId": chat_id,
        "messages": [
            { "id": user_msg_id, "role": "user", "content": &prompt, "parts": [{ "type": "text", "text": &prompt }], "createdAt": &created_at },
            { "id": asst_msg_id, "role": "assistant", "content": "", "parts": [{ "type": "text", "text": "" }], "createdAt": &created_at }
        ],
        "selectedChatModel": "chat-model-reasoning",
        "selectedCharacter": null,
        "selectedStory": null,
        "deviceId": device_id,
        "locale": "id"
    });

    let res = client
        .post("https://app.unlimitedai.chat/api/chat")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36")
                    .header("Content-Type", "application/json")
                    .header("x-next-intl-locale", "id")
                    .header("Accept", "*/*")
                    .header("Origin", "https://app.unlimitedai.chat")
                    .header("Referer", "https://app.unlimitedai.chat/id")
        .header("Cookie", format!("NEXT_LOCALE=id; u_device_id={}; home_chat_id={}", device_id, chat_id))
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut answer = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(delta) = val.get("delta").and_then(|d| d.as_str()) {
                        answer.push_str(delta);
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
                    "data": {
                        "chatId": chat_id,
                        "input": teks,
                        "result": answer.trim(),
                        "session_id": session_id
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

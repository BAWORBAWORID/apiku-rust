use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const API_KEY: &str = "AIzaSyBQLxwsoGGyo0DOI-P8IdRWDAE401me8E8";

#[derive(Debug, Deserialize)]
pub struct LunaParams {
    pub teks: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LunaSession {
    #[serde(rename = "localId")]
    local_id: Option<String>,
    #[serde(rename = "idToken")]
    id_token: Option<String>,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
}

pub async fn handler(
    Query(query): Query<LunaParams>,
    body: Option<Json<LunaParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.teks.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "gpt-5.6-luna".to_string());

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
        
        .build()
        .unwrap_or_default();

    // Load data/luna.json
    let session_paths = [
        "data/luna.json",
        "../data/luna.json",
        "/home/agentuser/apiku/data/luna.json",
    ];

    let mut session_data = None;
    for sp in &session_paths {
        if let Ok(raw) = std::fs::read_to_string(sp) {
            if let Ok(sess) = serde_json::from_str::<LunaSession>(&raw) {
                session_data = Some(sess);
                break;
            }
        }
    }

    let Some(mut sess) = session_data else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": "Session luna.json tidak ditemukan"
            })),
        );
    };

    // Refresh token if present
    if let Some(ref rt) = sess.refresh_token {
        let refresh_body = format!("grant_type=refresh_token&refresh_token={}", urlencoding::encode(rt));
        let refresh_res = client
            .post(format!("https://securetoken.googleapis.com/v1/token?key={}", API_KEY))
                        .header("Content-Type", "application/x-www-form-urlencoded")
            .body(refresh_body)
            .send()
            .await;

        if let Ok(resp) = refresh_res {
            if let Ok(refreshed) = resp.json::<serde_json::Value>().await {
                if let Some(new_token) = refreshed.get("id_token").and_then(|t| t.as_str()) {
                    sess.id_token = Some(new_token.to_string());
                }
            }
        }
    }

    let id_token = sess.id_token.unwrap_or_default();
    let local_id = sess.local_id.unwrap_or_default();

    let chat_payload = json!({
        "messages": [{ "role": "user", "content": &prompt }],
        "model": &model,
        "stream": false
    });

    let res = client
        .post("https://api.chatbotapp.ai/api/chat")
                    .header("Content-Type", "application/json")
        .header("X_User_Id", &local_id)
        .header("X-User-Id", &local_id)
        .header("X_Token", &id_token)
        .header("X-Token", &id_token)
                    .header("X_Platform", "web")
                    .header("X-Platform", "web")
                    .header("Origin", "https://chat.chatbotapp.ai")
                    .header("Referer", "https://chat.chatbotapp.ai/")
        .json(&chat_payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body_str) {
                let answer = parsed
                    .pointer("/choices/0/message/content")
                    .or_else(|| parsed.get("content"))
                    .or_else(|| parsed.get("text"))
                    .and_then(|c| c.as_str())
                    .unwrap_or(&body_str);

                (
                    StatusCode::OK,
                    Json(json!({
                        "status": true,
                        "model": model,
                        "result": answer.trim()
                    })),
                )
            } else {
                (
                    StatusCode::OK,
                    Json(json!({
                        "status": true,
                        "model": model,
                        "result": body_str.trim()
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

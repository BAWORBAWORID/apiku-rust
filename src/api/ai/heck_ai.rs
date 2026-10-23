use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct HeckParams {
    pub text: Option<String>,
    pub model: Option<String>,
    pub session: Option<String>,
    pub search: Option<bool>,
    #[serde(rename = "deepThink")]
    pub deep_think: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct CreateSessionResponse {
    id: Option<String>,
}

pub async fn handler(
    Query(query): Query<HeckParams>,
    body: Option<Json<HeckParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.text.unwrap_or_default().trim().to_string();
    let model_req = params.model.unwrap_or_else(|| "gpt-5.4-mini".to_string());
    let search = params.search.unwrap_or(false);
    let deep_think = params.deep_think.unwrap_or(false);

    if prompt.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })),
        );
    }

    let resolved_model = match model_req.as_str() {
        "deepseek-v4-flash" => "deepseek/deepseek-v4-flash",
        "deepseek-v4-pro" => "deepseek/deepseek-v4-pro",
        "tencent-hy3-preview" => "tencent/hunyuan-t1-preview",
        "qwen-3.7-plus" => "qwen/qwen3-235b-a22b",
        "step-3.7-flash" => "stepfun/step-3-mini",
        "gemini-3.1-flash-lite" => "google/gemini-2.5-flash-lite-preview-06-17",
        "gemini-3.0-flash" => "google/gemini-2.0-flash-001",
        "gpt-5.4-mini" => "openai/gpt-5.4-mini",
        other => other,
    };

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let user_agent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

    // 1. Create Session
    let session_res = client
        .post("https://api.heckai.weight-wave.com/api/ha/v1/session/create")
                    .header("authority", "api.heckai.weight-wave.com")
                    .header("origin", "https://heck.ai")
                    .header("referer", "https://heck.ai/")
        .header("user-agent", user_agent)
                    .header("content-type", "application/json")
        .json(&json!({ "title": &prompt }))
        .send()
        .await;

    let session_id = match session_res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<CreateSessionResponse>().await {
                data.id
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let session_id = session_id.unwrap_or_else(|| {
        format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
            rand::random::<u32>(),
            rand::random::<u16>(),
            rand::random::<u16>() & 0x0fff,
            rand::random::<u16>() & 0x3fff | 0x8000,
            rand::random::<u64>() & 0xffffffffffff,
        )
    });

    // 2. Chat
    let endpoint = if search {
        "https://api.heckai.weight-wave.com/api/ha/v1/search"
    } else {
        "https://api.heckai.weight-wave.com/api/ha/v1/chat"
    };

    let mut chat_payload = json!({
        "model": resolved_model,
        "question": &prompt,
        "language": "English",
        "sessionId": session_id,
        "previousQuestion": null,
        "previousAnswer": null
    });

    if deep_think {
        chat_payload["deepThink"] = json!(true);
    }

    let chat_res = client
        .post(endpoint)
                    .header("authority", "api.heckai.weight-wave.com")
                    .header("origin", "https://heck.ai")
                    .header("referer", "https://heck.ai/")
        .header("user-agent", user_agent)
                    .header("content-type", "application/json")
        .json(&chat_payload)
        .send()
        .await;

    match chat_res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut answer = String::new();
            let mut reason = String::new();
            let mut collecting_answer = false;
            let mut collecting_reason = false;

            for line in body_str.lines() {
                if !line.starts_with("data: ") {
                    continue;
                }
                let val = &line[6..];
                if val == "[ANSWER_START]" {
                    collecting_answer = true;
                    continue;
                }
                if val == "[ANSWER_DONE]" {
                    collecting_answer = false;
                    continue;
                }
                if val == "[REASON_START]" {
                    collecting_reason = true;
                    continue;
                }
                if val == "[REASON_DONE]" {
                    collecting_reason = false;
                    continue;
                }
                if collecting_answer {
                    answer.push_str(val);
                }
                if collecting_reason {
                    reason.push_str(val);
                }
            }

            if answer.is_empty() {
                answer = body_str.trim().to_string();
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": {
                        "answer": answer.trim(),
                        "reasoning": if reason.is_empty() { None } else { Some(reason.trim()) },
                        "model": resolved_model,
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

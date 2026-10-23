use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct DeepseekParams {
    pub teks: Option<String>,
}

pub async fn handler(
    Query(query): Query<DeepseekParams>,
    body: Option<Json<DeepseekParams>>,
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

    let csrf_token: String = (0..32)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect::<String>()[..40]
        .to_string();

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "model": "deepseek/deepseek-v3.2",
        "messages": [{ "role": "user", "content": &teks }]
    });

    let res = client
        .post("https://deep-seek.ai/api/chat")
                    .header("Content-Type", "application/json")
        .header("X-CSRF-TOKEN", csrf_token)
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut full_response = String::new();
            let mut model_used = "deepseek/deepseek-v3.2-20251201".to_string();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with(": OPENROUTER") || !trimmed.starts_with("data: ") {
                    continue;
                }
                let data_str = &trimmed[6..].trim();
                if *data_str == "[DONE]" {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(delta) = val.pointer("/choices/0/delta/content").and_then(|c| c.as_str()) {
                        full_response.push_str(delta);
                    }
                    if let Some(m) = val.get("model").and_then(|m| m.as_str()) {
                        model_used = m.to_string();
                    }
                }
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "model": model_used,
                    "input": teks,
                    "result": full_response.trim()
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct QwenCoderParams {
    pub teks: Option<String>,
}

pub async fn handler(
    Query(query): Query<QwenCoderParams>,
    body: Option<Json<QwenCoderParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi",
                "example": {
                    "GET": "/api/ai/qwen-coder-v2?teks=Buatkan%20fungsi%20sorting",
                    "POST": { "teks": "Buatkan fungsi sorting" }
                }
            })),
        );
    }

    let user_id = format!("user_{}_{:x}", chrono::Utc::now().timestamp_millis(), rand::random::<u32>());
    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "messages": [{ "role": "user", "content": &teks }],
        "model": "qwen3-coder",
        "stream": true,
        "lang": "en"
    });

    let res = client
        .post("https://api.free.ai/v1/chat/")
                    .header("Content-Type", "application/json")
        .header("X-User-Id", user_id)
                    .header("User-Agent", "Mozilla/5.0")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut full_answer = String::new();
            let mut model_used = "qwen3-coder".to_string();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("data: ") {
                    continue;
                }
                let data_str = &trimmed[6..].trim();
                if *data_str == "[DONE]" {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data_str) {
                    if let Some(delta) = val.pointer("/choices/0/delta/content").and_then(|c| c.as_str()) {
                        full_answer.push_str(delta);
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
                    "input": teks,
                    "model": model_used,
                    "result": full_answer.trim()
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

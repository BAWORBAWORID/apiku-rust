use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct FeelBetterParams {
    pub teks: Option<String>,
    pub session: Option<String>,
}

pub async fn handler(
    Query(query): Query<FeelBetterParams>,
    body: Option<Json<FeelBetterParams>>,
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

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let memory_id = format!("safe-owl-{}", rand::random::<u16>() % 9000 + 1000);

    let system_message = "Kamu adalah asisten AI yang dibuat oleh Zyyvor. Ikuti bahasa yang digunakan user dalam percakapan. Jika user memakai bahasa Indonesia, jawab dalam bahasa Indonesia yang natural, santai, jelas, dan mudah dipahami. Jangan tiba-tiba pindah bahasa kecuali user memintanya. Jika user bertanya siapa pembuatmu, penciptamu, developermu, atau siapa yang membuatmu, jawab bahwa pembuatmu adalah Zyyvor.";

    let payload = json!({
        "messages": [
            { "role": "system", "content": system_message },
            { "role": "assistant", "content": "Hi, I'm FeelBetterBot — I'm here to listen and help you carry whatever feels heavy, without judgment." },
            { "role": "user", "content": &teks }
        ],
        "memoryId": memory_id,
        "mode": "chat",
        "stream": false
    });

    let res = client
        .post("https://feelbetterbot.com/api/chat")
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut answer = String::new();

            for line in body_str.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("data:") {
                    let d = trimmed.trim_start_matches("data:").trim();
                    if d.is_empty() || d == "[DONE]" {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(d) {
                        if let Some(c) = val.get("content").and_then(|c| c.as_str()) {
                            answer.push_str(c);
                        } else if let Some(c) = val.pointer("/choices/0/delta/content").and_then(|c| c.as_str()) {
                            answer.push_str(c);
                        }
                    } else {
                        answer.push_str(d);
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE: &str = "https://chat.motiftech.io";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct MotifParams {
    pub prompt: Option<String>,
    pub level: Option<String>,
    #[serde(rename = "conversationId")]
    pub conversation_id: Option<String>,
}

pub async fn handler(
    Query(query): Query<MotifParams>,
    body: Option<Json<MotifParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.prompt.unwrap_or_default().trim().to_string();
    let level = params.level.unwrap_or_else(|| "small".to_string());
    let conv_id = params.conversation_id.unwrap_or_else(|| {
        format!("01{:X}", rand::random::<u128>() >> 32)
    });

    if prompt.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'prompt' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        .cookie_store(true)
        
        .build()
        .unwrap_or_default();

    // Read next-action from data/motif.json
    let session_paths = [
        "data/motif.json",
        "../data/motif.json",
        "/home/agentuser/apiku/data/motif.json",
    ];

    let mut next_action = "4035a4be8a411a01d27ea9fac6492821a1077564f6".to_string();
    for sp in &session_paths {
        if let Ok(raw) = std::fs::read_to_string(sp) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(na) = val.get("nextAction").and_then(|a| a.as_str()) {
                    next_action = na.to_string();
                    break;
                }
            }
        }
    }

    let init_body = json!([
        {
            "attachments": [],
            "conversationId": &conv_id,
            "documentIds": [],
            "id": format!("01{:X}", rand::random::<u128>() >> 32),
            "language": "id",
            "message": &prompt,
            "modelLevel": &level,
            "persona": null,
            "reasoningEffort": "medium",
            "templateId": null,
            "timezone": "Asia/Jakarta",
            "uiLocale": "id"
        }
    ]);

    let res = client
        .post(format!("{}/chat", BASE))
                    .header("Accept", "text/x-component")
                    .header("Content-Type", "text/plain;charset=UTF-8")
        .header("next-action", &next_action)
                    .header("next-router-state-tree", "%5B%22%22%2C%7B%22children%22%3A%5B%22(model)%22%2C%7B%22children%22%3A%5B%22chat%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D")
        .header("Referer", format!("{}/chat", BASE))
        .header("User-Agent", UA)
        .body(init_body.to_string())
        .send()
        .await;

    if let Ok(resp) = res {
        let text = resp.text().await.unwrap_or_default();
        let mut final_url = None;
        let mut final_body = None;

        for line in text.lines() {
            if let Some(pos) = line.find(":{") {
                let json_slice = &line[pos + 1..];
                if let Ok(obj) = serde_json::from_str::<serde_json::Value>(json_slice) {
                    if let (Some(u), Some(b)) = (obj.get("url"), obj.get("body")) {
                        final_url = u.as_str().map(|s| s.to_string());
                        final_body = Some(b.clone());
                        break;
                    }
                }
            }
        }

        if let (Some(u), Some(b)) = (final_url, final_body) {
            let stream_res = client
                .post(&u)
                            .header("Content-Type", "application/json")
                            .header("Accept", "text/event-stream")
                .header("User-Agent", UA)
                .json(&b)
                .send()
                .await;

            if let Ok(s_resp) = stream_res {
                let s_text = s_resp.text().await.unwrap_or_default();
                let mut answer = String::new();
                for line in s_text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("data:") {
                        let d = trimmed.trim_start_matches("data:").trim();
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(d) {
                            if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                                answer.push_str(t);
                            }
                        }
                    }
                }

                if !answer.is_empty() {
                    return (
                        StatusCode::OK,
                        Json(json!({
                            "status": true,
                            "result": {
                                "prompt": prompt,
                                "level": level,
                                "conversationId": conv_id,
                                "response": answer.trim()
                            }
                        })),
                    );
                }
            }
        }
    }

    // High availability fallback using Pollinations
    let encoded = urlencoding::encode(&prompt);
    let fallback_res = client
        .get(format!("https://text.pollinations.ai/{}?model=openai", encoded))
        .header("User-Agent", UA)
        .send()
        .await;

    let ans = match fallback_res {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => format!("Error: {}", e),
    };

    (
        StatusCode::OK,
        Json(json!({
            "status": true,
            "result": {
                "prompt": prompt,
                "level": level,
                "conversationId": conv_id,
                "response": ans.trim()
            }
        })),
    )
}

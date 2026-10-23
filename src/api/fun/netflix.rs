use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;
use crate::state::AppState;

const ENDPOINT: &str = "https://token-netflix.vercel.app/api/generate";

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    let client = &state.client;
    let res = client
        .post(ENDPOINT)
                    .header("Content-Type", "application/json")
        .json(&json!({ "count": 1, "stream": false }))
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(tokens) = data.get("data").and_then(|v| v.as_array()) {
                    if let Some(item) = tokens.first() {
                        let token_str = item.get("token").and_then(|v| v.as_str()).unwrap_or("");
                        let result = json!({
                            "id": item.get("id"),
                            "index": item.get("index"),
                            "success": item.get("success"),
                            "token": token_str,
                            "expiry": item.get("expiry"),
                            "type": item.get("type").unwrap_or(&json!("cookie")),
                            "profile": item.get("profile"),
                            "links": {
                                "pc": format!("https://www.netflix.com/browse?nftoken={}", token_str),
                                "android": format!("https://www.netflix.com/browse?nftoken={}", token_str),
                                "tv": format!("https://www.netflix.com/tv?nftoken={}", token_str)
                            }
                        });

                        return Json(json!({
                            "status": true,
                            "result": result,
                        }));
                    }
                }
                return Json(json!({
                    "status": false,
                    "message": data.get("message").and_then(|v| v.as_str()).unwrap_or("Gagal generate token")
                }));
            }
            Json(json!({
                "status": false,
                "message": "Gagal membaca response upstream Netflix"
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Request error: {}", e)
        })),
    }
}

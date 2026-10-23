use axum::{extract::State, response::IntoResponse, Json};
use rand::seq::SliceRandom;
use serde_json::json;
use crate::state::AppState;

const API: &str = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/filsuf-quotes.json";

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    let client = &state.http_client;
    let res = client
        .get(API)
                    .header("User-Agent", "Mozilla/5.0")
                    .header("Accept", "application/json, text/plain, */*")
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let quotes_opt = if let Some(arr) = data.as_array() {
                    Some(arr.clone())
                } else if let Some(arr) = data.get("quotes").and_then(|v| v.as_array()) {
                    Some(arr.clone())
                } else if let Some(arr) = data.get("result").and_then(|v| v.as_array()) {
                    Some(arr.clone())
                } else {
                    None
                };

                if let Some(quotes) = quotes_opt {
                    if !quotes.is_empty() {
                        let mut rng = rand::thread_rng();
                        if let Some(selected) = quotes.choose(&mut rng) {
                            let quote = selected
                                .get("quote")
                                .or_else(|| selected.get("text"))
                                .or_else(|| selected.get("kata"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let philosopher = selected
                                .get("philosopher")
                                .or_else(|| selected.get("author"))
                                .or_else(|| selected.get("filsuf"))
                                .or_else(|| selected.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");

                            return Json(json!({
                                "status": true,
                                "total": quotes.len(),
                                "result": {
                                    "quote": quote,
                                    "philosopher": philosopher
                                },
                            }));
                        }
                    }
                }
            }
            Json(json!({
                "status": false,
                "message": "Data quotes kosong atau gagal di-parse"
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Gagal mengambil philosopher quotes: {}", e)
        })),
    }
}

use axum::{extract::State, response::IntoResponse, Json};
use rand::seq::SliceRandom;
use serde_json::json;
use crate::state::AppState;

pub async fn random_game_handler(state: AppState, data_url: &'static str) -> impl IntoResponse {
    let client = &state.client;
    match client.get(data_url).send().await {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let items_opt = if let Some(arr) = data.as_array() {
                    Some(arr)
                } else if let Some(arr) = data.get("result").and_then(|v| v.as_array()) {
                    Some(arr)
                } else {
                    None
                };

                if let Some(items) = items_opt {
                    if !items.is_empty() {
                        let mut rng = rand::thread_rng();
                        if let Some(item) = items.choose(&mut rng) {
                            return Json(json!({
                                "status": true,
                                "result": item,
                            }));
                        }
                    }
                }
            }
            Json(json!({
                "status": false,
                "message": "Data game kosong atau gagal di-parse"
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Gagal mengambil data game: {}", e)
        })),
    }
}

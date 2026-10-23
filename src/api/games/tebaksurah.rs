use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde_json::json;
use crate::state::AppState;

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    let client = &state.client;
    let random_ayah: u32 = {
        let mut rng = rand::thread_rng();
        rng.gen_range(1..=6236)
    };

    let url = format!("https://api.alquran.cloud/v1/ayah/{}/ar.alafasy", random_ayah);
    match client.get(&url).send().await {
        Ok(res) => {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(ayah_data) = data.get("data") {
                    return Json(json!({
                        "status": true,
                        "result": ayah_data
                    }));
                }
            }
            Json(json!({
                "status": false,
                "message": "Ayat tidak ditemukan"
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error mengambil data Quran: {}", e)
        })),
    }
}

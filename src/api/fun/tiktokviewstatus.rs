use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const BASE_URL: &str = "https://clooud.my.id/api/cekstatus?id=";

#[derive(Debug, Deserialize)]
pub struct StatusParams {
    pub id: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<StatusParams>,
    body: Option<Json<StatusParams>>,
) -> impl IntoResponse {
    let id_opt = query.id.or_else(|| body.and_then(|b| b.id.clone()));

    let id = match id_opt {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'id' wajib diisi"
            }));
        }
    };

    let client = &state.http_client;
    let target = format!("{}{}", BASE_URL, urlencoding::encode(&id));

    match client.get(&target).send().await {
        Ok(resp) => {
            if let Ok(res) = resp.json::<serde_json::Value>().await {
                let data = res.get("data").cloned().unwrap_or(res);
                Json(json!({
                    "statusCode": 200,
                    "status": true,
                    "result": {
                        "data": data
                    },
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca format data response"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": "Gagal mengambil data dari server",
            "error": e.to_string()
        })),
    }
}

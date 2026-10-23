use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
pub struct CapcutParams {
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SnapApiResponse {
    pub code: i32,
    pub msg: Option<String>,
    pub data: Option<Value>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<CapcutParams>,
    body: Option<Json<CapcutParams>>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let body_params = body.map(|b| b.0).unwrap_or_default();
    let target_url = body_params.url.or(query.url).unwrap_or_default().trim().to_string();

    if target_url.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'url' wajib diisi (contoh: https://www.capcut.com/watch/xxxxx)"
        }));
    }

    let payload = json!({ "text": target_url });

    match state.client.post("https://snapvideotools.com/id/api/snap")
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json, text/javascript, */*; q=0.01")
                    .header("X-Requested-With", "XMLHttpRequest")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36")
                    .header("Referer", "https://snapvideotools.com/id/capcut-downloader")
                    .header("Origin", "https://snapvideotools.com")
        .json(&payload)
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(snap_res) = res.json::<SnapApiResponse>().await {
                if snap_res.code == 0 {
                    Json(json!({
                        "status": true,
                        "time": format!("{}ms", start_time.elapsed().as_millis()),
                        "result": snap_res.data,
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    }))
                } else {
                    Json(json!({
                        "status": false,
                        "time": format!("{}ms", start_time.elapsed().as_millis()),
                        "error": snap_res.msg.unwrap_or_else(|| "Gagal mengunduh video CapCut".to_string()),
                    }))
                }
            } else {
                Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": "Gagal mengurai respons dari server penyedia.",
                }))
            }
        }
        Err(e) => {
            Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": format!("Koneksi ke server download gagal: {}", e),
            }))
        }
    }
}

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct HumanizerParams {
    pub teks: Option<String>,
}

pub async fn handler(
    Query(query): Query<HumanizerParams>,
    body: Option<Json<HumanizerParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi (minimal 50 karakter)"
            })),
        );
    }

    if teks.len() < 50 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Teks terlalu pendek. Minimal 50 karakter untuk di-humanize."
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "string": teks,
        "skipRealtime": 1,
        "humanizerReadability": "High School",
        "humanizerPurpose": "General Writing",
        "humanizerStrength": "Balanced",
        "humanizerModel": "v11"
    });

    let res = client
        .post("https://api.zerogpt.com/api/transform/humanize")
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Origin", "https://www.zerogpt.com")
                    .header("Referer", "https://www.zerogpt.com/ai-humanizer")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                (
                    StatusCode::OK,
                    Json(json!({
                        "status": true,
                        "result": data
                    })),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal membaca response ZeroGPT"
                    })),
                )
            }
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

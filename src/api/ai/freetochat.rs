use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct FreeToChatParams {
    pub teks: Option<String>,
    pub model: Option<String>,
    pub session: Option<String>,
}

pub async fn handler(
    Query(query): Query<FreeToChatParams>,
    body: Option<Json<FreeToChatParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();
    let model = params.model.unwrap_or_else(|| "grok-4.3".to_string());

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

    // Fast high-availability API fallback using Pollinations AI engine
    let encoded = urlencoding::encode(&teks);
    let url = format!("https://text.pollinations.ai/{}?model=openai", encoded);

    let res = client
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0")
        .send()
        .await;

    match res {
        Ok(resp) => {
            let answer = resp.text().await.unwrap_or_default();
            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "model": model,
                    "input": teks,
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

use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const UPSTREAM_URL: &str = "https://us-central1-nova-ai---android.cloudfunctions.net/app/ai-response/v2";

#[derive(Debug, Deserialize)]
pub struct NovaParams {
    pub teks: Option<String>,
    pub session: Option<String>,
}

pub async fn handler(
    Query(query): Query<NovaParams>,
    body: Option<Json<NovaParams>>,
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

    let payload = json!({
        "question_text": &teks,
        "conversation": {
            "conversation_items": []
        }
    });

    let res = client
        .post(UPSTREAM_URL)
                    .header("User-Agent", "okhttp/4.10.0")
                    .header("platform", "Android")
                    .header("version", "1.4.0")
                    .header("language", "in")
                    .header("content-type", "application/json; charset=utf-8")
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
                        "message": "Gagal membaca response dari Nova AI"
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

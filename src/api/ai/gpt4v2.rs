use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct Gpt4v2Params {
    pub teks: Option<String>,
    pub websearch: Option<String>,
}

pub async fn handler(
    Query(query): Query<Gpt4v2Params>,
    body: Option<Json<Gpt4v2Params>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();
    let websearch_str = params.websearch.unwrap_or_else(|| "false".to_string());

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi"
            })),
        );
    }

    if websearch_str != "true" && websearch_str != "false" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'websearch' harus bernilai 'true' atau 'false'"
            })),
        );
    }

    let use_websearch = websearch_str == "true";
    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let encoded = urlencoding::encode(&teks);
    let url = if use_websearch {
        format!("https://text.pollinations.ai/{}?model=searchgpt", encoded)
    } else {
        format!("https://text.pollinations.ai/{}?model=openai", encoded)
    };

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
                    "input": teks,
                    "result": answer.trim(),
                    "websearch": use_websearch,
                    "timestamp": chrono::Utc::now().timestamp_millis()
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

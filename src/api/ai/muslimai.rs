use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE: &str = "https://www.muslimai.io";
const DISTINCT_ID: &str = "019ebfc5-619f-78d5-be7b-ba3494e16e3a";

#[derive(Debug, Deserialize)]
pub struct MuslimAiParams {
    pub teks: Option<String>,
}

pub async fn handler(
    Query(query): Query<MuslimAiParams>,
    body: Option<Json<MuslimAiParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let teks = params.teks.unwrap_or_default().trim().to_string();

    if teks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi dengan pertanyaan seputar Islam"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let payload = json!({
        "query": &teks,
        "distinctId": DISTINCT_ID
    });

    let res = client
        .post(format!("{}/api/chat", BASE))
                    .header("authority", "www.muslimai.io")
                    .header("accept", "*/*")
                    .header("content-type", "application/json")
        .header("origin", BASE)
        .header("referer", format!("{}/", BASE))
                    .header("user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body_str = resp.text().await.unwrap_or_default();
            let mut full_text = String::new();
            let mut sources = vec![];

            for line in body_str.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(t) = parsed.get("type").and_then(|t| t.as_str()) {
                        if t == "sources" {
                            if let Some(s) = parsed.get("data").and_then(|d| d.as_array()) {
                                sources = s.clone();
                            }
                        } else if t == "text" {
                            if let Some(txt) = parsed.get("data").and_then(|d| d.as_str()) {
                                full_text.push_str(txt);
                            }
                        }
                    }
                }
            }

            (
                StatusCode::OK,
                Json(json!({
                    "status": true,
                    "result": {
                        "query": teks,
                        "text": full_text.trim(),
                        "sources": sources
                    }
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

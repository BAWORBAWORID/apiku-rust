use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const ASKME_URL: &str = "https://askme.matlubapps.com/ask-me";
const ASKME_KEY: &str = "ak8asda9$5kpq";
const ASKME_MODEL: &str = "gpt_4__1_nano";

#[derive(Debug, Deserialize)]
pub struct AskMeParams {
    pub text: Option<String>,
    pub image: Option<String>,
    pub session: Option<String>,
    pub system: Option<String>,
}

pub async fn handler(
    Query(query): Query<AskMeParams>,
    body: Option<Json<AskMeParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let text = params.text.unwrap_or_default().trim().to_string();

    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let mut parts = vec![json!({ "text": &text })];

    if let Some(img) = params.image {
        if img.starts_with("http://") || img.starts_with("https://") {
            if let Ok(resp) = client.get(&img).send().await {
                if let Ok(bytes) = resp.bytes().await {
                    let b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &bytes,
                    );
                    parts.push(json!({
                        "inlineData": {
                            "mimeType": "image/jpeg",
                            "data": b64
                        }
                    }));
                }
            }
        } else if img.starts_with("data:") {
            if let Some(pos) = img.find(',') {
                parts.push(json!({
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": &img[pos + 1..]
                    }
                }));
            }
        } else if !img.is_empty() {
            parts.push(json!({
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": &img
                }
            }));
        }
    }

    let history = vec![json!({
        "role": "user",
        "parts": parts
    })];

    let payload = json!({
        "history": history,
        "isPremium": false,
        "modelname": ASKME_MODEL
    });

    let res = client
        .post(ASKME_URL)
                    .header("Content-Type", "application/json")
        .header("key", ASKME_KEY)
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let reply = data.get("msg").or_else(|| data.get("text")).and_then(|v| v.as_str());
                if let Some(ans) = reply {
                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": true,
                            "result": ans
                        })),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "status": false,
                            "message": "Empty response from AskMe server"
                        })),
                    )
                }
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal membaca format response AskMe"
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

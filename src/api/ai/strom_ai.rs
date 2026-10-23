use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE: &str = "https://strom-ai.my.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct StromParams {
    pub text: Option<String>,
    pub mode: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StromResponse {
    text: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    error: Option<String>,
}

pub async fn handler(
    Query(query): Query<StromParams>,
    body: Option<Json<StromParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let prompt = params.text.unwrap_or_default().trim().to_string();
    let mode = params.mode.unwrap_or_else(|| "strom".to_string());
    let sid = params.session_id.unwrap_or_else(|| {
        format!("sess_{}_{:x}", chrono::Utc::now().timestamp_millis(), rand::random::<u32>())
    });
    let uid = format!("user_{}_{:x}", chrono::Utc::now().timestamp_millis(), rand::random::<u32>());

    if prompt.is_empty() {
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

    let payload = json!({
        "prompt": &prompt,
        "sessionId": &sid,
        "image": null,
        "mimeType": null,
        "userId": &uid,
        "mode": &mode
    });

    let res = client
        .post(format!("{}/api/chat", BASE))
                    .header("Content-Type", "application/json")
        .header("Origin", BASE)
        .header("Referer", format!("{}/", BASE))
        .header("User-Agent", UA)
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<StromResponse>().await {
                if let Some(err) = data.error {
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(json!({
                            "status": false,
                            "message": err
                        })),
                    );
                }
                if let Some(txt) = data.text {
                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": true,
                            "result": {
                                "text": txt,
                                "session_id": data.session_id.unwrap_or(sid),
                                "mode": mode
                            }
                        })),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "status": false,
                            "message": "Upstream tidak memberikan respons"
                        })),
                    )
                }
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal membaca format JSON dari Strom-AI"
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

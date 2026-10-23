use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE_URL: &str = "https://api.zerogpt.com";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct ZeroGptParams {
    pub text: Option<String>,
    pub action: Option<String>,
    pub conversation_id: Option<serde_json::Value>,
}

pub async fn handler(
    Query(query): Query<ZeroGptParams>,
    body: Option<Json<ZeroGptParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let text = params.text.unwrap_or_default().trim().to_string();
    let action = params.action.unwrap_or_else(|| "chat".to_string()).to_lowercase();

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

    if action == "detect" {
        let res = client
            .post(format!("{}/api/detect/detectText", BASE_URL))
                        .header("Content-Type", "application/json")
                        .header("Origin", "https://www.zerogpt.com")
                        .header("Referer", "https://www.zerogpt.com/")
            .header("User-Agent", USER_AGENT)
                        .header("Accept", "application/json, text/plain, */*")
            .json(&json!({ "input_text": &text }))
            .send()
            .await;

        match res {
            Ok(resp) => {
                if let Ok(json_data) = resp.json::<serde_json::Value>().await {
                    let d = json_data.get("data").cloned().unwrap_or(json!({}));
                    let fake = d.get("fakePercentage").and_then(|f| f.as_f64()).unwrap_or(0.0);
                    let verdict = if fake >= 70.0 {
                        "ai"
                    } else if fake <= 30.0 {
                        "human"
                    } else {
                        "uncertain"
                    };

                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": true,
                            "action": "detect",
                            "result": {
                                "verdict": verdict,
                                "fake_percentage": fake,
                                "is_human": d.get("isHuman").cloned().unwrap_or(json!(0)),
                                "ai_words": d.get("aiWords").cloned().unwrap_or(json!(0)),
                                "text_words": d.get("textWords").cloned().unwrap_or(json!(0)),
                                "feedback": d.get("feedback").cloned().unwrap_or(json!("")),
                                "detected_language": d.get("detected_language").cloned().unwrap_or(json!("en"))
                            }
                        })),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "status": false,
                            "message": "Gagal membaca format response dari ZeroGPT detector"
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
    } else {
        // Chat action
        let conv_id = params
            .conversation_id
            .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0);

        let res = client
            .post(format!("{}/api/transform/sendText", BASE_URL))
                        .header("Content-Type", "application/json")
                        .header("Origin", "https://www.zerogpt.com")
                        .header("Referer", "https://www.zerogpt.com/")
            .header("User-Agent", USER_AGENT)
                        .header("Accept", "application/json, text/plain, */*")
            .json(&json!({
                "string": &text,
                "wsId": "",
                "conversation_id": conv_id,
                "chatVersion": 1
            }))
            .send()
            .await;

        match res {
            Ok(resp) => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    let msg = data.pointer("/data/message").and_then(|m| m.as_str()).unwrap_or("");
                    let returned_conv_id = data.pointer("/data/conversation_id").and_then(|c| c.as_i64()).unwrap_or(conv_id);

                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": true,
                            "action": "chat",
                            "result": {
                                "response": msg,
                                "conversation_id": returned_conv_id
                            }
                        })),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "status": false,
                            "message": "Gagal membaca format chat dari ZeroGPT"
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
}

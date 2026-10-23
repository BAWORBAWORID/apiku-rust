use axum::{
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
pub struct ViuParams {
    device_id: Option<String>,
}

#[derive(Serialize)]
struct ViuAccountData {
    email: Option<String>,
    password: Option<String>,
}

pub async fn handler(axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>, payload: Option<Json<HashMap<String, serde_json::Value>>>) -> impl IntoResponse {
    let mut device_id = params.get("device_id").cloned();
    if device_id.is_none() {
        if let Some(Json(p)) = payload {
            if let Some(val) = p.get("device_id").and_then(|v| v.as_str()) {
                device_id = Some(val.to_string());
            }
        }
    }

    let dev_id = device_id.unwrap_or_else(|| {
        let start = SystemTime::now();
        let since_the_epoch = start.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        format!("{:x}", since_the_epoch)
    });

    let client = reqwest::Client::new();
    let body = json!({ "device_id": dev_id });

    let res = client.post("https://viu.interflazz.my.id/?action=account")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://viu.interflazz.my.id")
                    .header("Referer", "https://viu.interflazz.my.id/")
        .json(&body)
        .send()
        .await;

    match res {
        Ok(response) => {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                let success = data.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
                let message = data.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
                let is_new = data.get("is_new").and_then(|v| v.as_bool()).unwrap_or(false);
                let returned_dev_id = data.get("device_id").and_then(|v| v.as_str()).unwrap_or(&dev_id).to_string();

                let account_obj = data.get("account");
                let email = account_obj.and_then(|a| a.get("email")).and_then(|v| v.as_str()).map(String::from);
                let password = account_obj.and_then(|a| a.get("password")).and_then(|v| v.as_str()).map(String::from);

                Json(json!({
                    "success": success,
                    "message": message,
                    "is_new": is_new,
                    "device_id": returned_dev_id,
                    "account": {
                        "email": email,
                        "password": password
                    },
                    "fetched_at": chrono::Utc::now().to_rfc3339()
                })).into_response()
            } else {
                Json(json!({ "success": false, "error": "Invalid JSON response from upstream", "device_id": dev_id })).into_response()
            }
        }
        Err(err) => {
            Json(json!({ "success": false, "error": err.to_string(), "device_id": dev_id })).into_response()
        }
    }
}

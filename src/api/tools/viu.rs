use axum::{extract::Query, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct ViuParams {
    device_id: Option<String>,
}

#[derive(Serialize)]
struct ViuAccountData {
    email: Option<String>,
    password: Option<String>,
}

#[derive(Serialize)]
struct ViuResponse {
    success: bool,
    message: String,
    is_new: bool,
    device_id: String,
    account: ViuAccountData,
    fetched_at: String,
}

use md5::Digest;

fn uuid_v4_simple() -> String {
    let mut b = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex::encode(b);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

pub async fn handler(Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let device_id = params
        .get("device_id")
        .cloned()
        .unwrap_or_else(|| format!("{:x}", md5::Md5::digest(uuid_v4_simple())));

    let client = reqwest::Client::new();
    let body = json!({ "device_id": device_id });

    let res = client
        .post("https://viu.interflazz.my.id/?action=account")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
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
                let success = data
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let message = data
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let is_new = data
                    .get("is_new")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let dev_id = data
                    .get("device_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&device_id)
                    .to_string();

                let account_obj = data.get("account");
                let email = account_obj
                    .and_then(|a| a.get("email"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let password = account_obj
                    .and_then(|a| a.get("password"))
                    .and_then(|v| v.as_str())
                    .map(String::from);

                Json(json!({
                    "success": success,
                    "message": message,
                    "is_new": is_new,
                    "device_id": dev_id,
                    "account": {
                        "email": email,
                        "password": password
                    },
                    "fetched_at": chrono::Utc::now().to_rfc3339()
                }))
                .into_response()
            } else {
                Json(json!({ "success": false, "error": "Invalid JSON response from upstream", "device_id": device_id })).into_response()
            }
        }
        Err(err) => {
            Json(json!({ "success": false, "error": err.to_string(), "device_id": device_id }))
                .into_response()
        }
    }
}

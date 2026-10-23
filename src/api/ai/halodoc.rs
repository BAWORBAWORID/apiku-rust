use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct HalodocParams {
    pub teks: Option<String>,
}

pub async fn handler(
    Query(query): Query<HalodocParams>,
    body: Option<Json<HalodocParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let message = params.teks.unwrap_or_default().trim().to_string();

    if message.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'teks' wajib diisi"
            })),
        );
    }

    let xsrf_token: String = (0..32)
        .map(|_| format!("{:02X}", rand::random::<u8>()))
        .collect();
    let fingerprint: String = (0..16)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect();
    let ref_uuid = format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rand::random::<u32>(),
        rand::random::<u16>(),
        rand::random::<u16>() & 0x0fff,
        rand::random::<u16>() & 0x3fff | 0x8000,
        rand::random::<u64>() & 0xffffffffffff,
    );
    let reference_id = format!("{}:{}", ref_uuid, chrono::Utc::now().timestamp_millis());

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let user_agent = "Mozilla/5.0 (Linux; Android 14; Infinix X6837 Build/BP2A.250605.031.A2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    // 1. Create Session
    let session_res = client
        .post("https://customers.api.halodoc.com/magneto-api/v1/concierge/guest/sessions")
                    .header("Host", "customers.api.halodoc.com")
                    .header("Connection", "keep-alive")
        .header("sec-ch-ua-platform", "\"Android\"")
        .header("X-XSRF-TOKEN", &xsrf_token)
        .header("User-Agent", user_agent)
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://www.halodoc.com")
                    .header("Referer", "https://www.halodoc.com/")
        .header("Cookie", format!("XSRF-TOKEN={};", xsrf_token))
        .json(&json!({
            "usecase_type": "h4c_concierge",
            "fingerprint": &fingerprint
        }))
        .send()
        .await;

    let session_id = match session_res {
        Ok(resp) => {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                v.get("session_id").and_then(|s| s.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let Some(session_id) = session_id else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": "Gagal membuat sesi konsultasi Halodoc"
            })),
        );
    };

    // 2. Send Message
    let chat_res = client
        .post("https://customers.api.halodoc.com/magneto-api/v1/concierge/messages")
                    .header("Host", "customers.api.halodoc.com")
                    .header("Connection", "keep-alive")
        .header("sec-ch-ua-platform", "\"Android\"")
        .header("X-XSRF-TOKEN", &xsrf_token)
        .header("User-Agent", user_agent)
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://www.halodoc.com")
                    .header("Referer", "https://www.halodoc.com/")
        .header("Cookie", format!("XSRF-TOKEN={};", xsrf_token))
        .json(&json!({
            "message": &message,
            "session_id": &session_id,
            "reference_id": &reference_id
        }))
        .send()
        .await;

    match chat_res {
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
                        "message": "Gagal membaca response pesan Halodoc"
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

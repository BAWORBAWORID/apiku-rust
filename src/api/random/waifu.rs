use axum::{
    body::Body,
    extract::State,
    http::header::{HeaderMap, HeaderValue, CONTENT_TYPE},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use crate::state::AppState;

const API_URL: &str = "https://api.waifu.im/images";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    let client = &state.client;
    match client.get(API_URL).header("User-Agent", UA).send().await {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(img_url) = data.get("items")
                    .and_then(|i| i.as_array())
                    .and_then(|a| a.first())
                    .and_then(|item| item.get("url"))
                    .and_then(|u| u.as_str())
                {
                    match client.get(img_url).header("User-Agent", UA).send().await {
                        Ok(img_resp) => {
                            let content_type = img_resp
                                .headers()
                                .get(reqwest::header::CONTENT_TYPE)
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("image/jpeg")
                                .to_string();

                            if let Ok(bytes) = img_resp.bytes().await {
                                let mut headers = HeaderMap::new();
                                headers.insert(
                                    CONTENT_TYPE,
                                    HeaderValue::from_str(&content_type)
                                        .unwrap_or(HeaderValue::from_static("image/jpeg")),
                                );
                                headers.insert(
                                    "Cache-Control",
                                    HeaderValue::from_static("no-cache, no-store, must-revalidate"),
                                );
                                return (headers, Body::from(bytes)).into_response();
                            }
                        }
                        Err(e) => {
                            return Json(json!({
                                "status": false,
                                "message": format!("Gagal mendownload gambar: {}", e)
                            })).into_response();
                        }
                    }
                }
            }
            Json(json!({
                "status": false,
                "message": "Gagal parse response waifu.im"
            })).into_response()
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Request waifu.im gagal: {}", e)
        })).into_response(),
    }
}

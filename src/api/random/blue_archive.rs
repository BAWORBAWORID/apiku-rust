use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const GIST_URL: &str = "https://gist.githubusercontent.com/siputzx/e985e0566c0529df3a2289fd64047d21/raw/1568d9d26ee25dbe82fb0bdf51b5c88727e3f602/bluearchive.json";

#[derive(Debug, Deserialize)]
pub struct BlueArchiveParams {
    pub format: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BlueArchiveParams>,
) -> Response {
    let client = &state.client;

    let accept = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let wants_json = query.format.as_deref() == Some("json") || accept.contains("application/json");

    let resp = match client.get(GIST_URL).send().await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": false,
                    "message": "BLUE ARCHIVE service unavailable",
                    "reason": e.to_string()
                })),
            ).into_response();
        }
    };

    let images: Vec<serde_json::Value> = match resp.json().await {
        Ok(imgs) => imgs,
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": false,
                    "message": "Failed to parse images data",
                    "reason": e.to_string()
                })),
            ).into_response();
        }
    };

    if images.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "status": false,
                "message": "No image URLs found"
            })),
        ).into_response();
    }

    let (image_url, picked) = {
        let mut rng = rand::thread_rng();
        let p = images.choose(&mut rng).unwrap();
        let url = if let Some(s) = p.as_str() {
            s.to_string()
        } else if let Some(u) = p.get("url").and_then(|x| x.as_str()) {
            u.to_string()
        } else {
            String::new()
        };
        (url, p.clone())
    };

    if image_url.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": "Invalid image data format"
            })),
        ).into_response();
    }

    if wants_json {
        return Json(json!({
            "status": true,
            "result": {
                "url": image_url,
                "metadata": picked
            }
        })).into_response();
    }

    match client.get(&image_url).send().await {
        Ok(img_resp) => {
            let content_type = img_resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("image/jpeg")
                .to_string();

            if let Ok(bytes) = img_resp.bytes().await {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
                    .body(Body::from(bytes))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
            } else {
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "status": false,
                        "message": "Failed to read image bytes"
                    })),
                ).into_response()
            }
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "status": false,
                "message": format!("Failed to download image: {}", e)
            })),
        ).into_response(),
    }
}

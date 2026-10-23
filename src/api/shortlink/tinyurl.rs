use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ShortlinkParams {
    pub link: Option<String>,
    pub url: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<ShortlinkParams>,
    body: Option<Json<ShortlinkParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let link_opt = query.link
        .or(query.url)
        .or_else(|| body.as_ref().and_then(|b| b.link.clone().or_else(|| b.url.clone())));

    let link = match link_opt {
        Some(l) if l.starts_with("http://") || l.starts_with("https://") => l,
        _ => {
            return Json(json!({
                "status": false,
                "message": "[!] masukan parameter link url yang valid (http:// atau https://)"
            }));
        }
    };

    let target = format!("https://tinyurl.com/api-create.php?url={}", urlencoding::encode(&link));
    match client.get(&target).send().await {
        Ok(resp) => {
            if let Ok(short) = resp.text().await {
                if short.starts_with("http") {
                    Json(json!({
                        "status": true,
                        "result": {
                            "original": link,
                            "short": short.trim()
                        },
                    }))
                } else {
                    Json(json!({
                        "status": false,
                        "message": format!("Gagal memendekkan URL: {}", short)
                    }))
                }
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca response TinyURL"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Request error: {}", e)
        })),
    }
}

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct TelegramParams {
    pub username: Option<String>,
    pub user: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<TelegramParams>,
    body: Option<Json<TelegramParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let username_opt = query.username
        .or(query.user)
        .or_else(|| body.as_ref().and_then(|b| b.username.clone().or_else(|| b.user.clone())));

    let raw_username = match username_opt {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'username' wajib diisi"
            }));
        }
    };

    let username = raw_username.trim_start_matches('@');
    let target = format!("https://t.me/{}", username);

    match client.get(&target).header("User-Agent", UA).send().await {
        Ok(resp) => {
            if resp.status() == 404 {
                return Json(json!({
                    "status": false,
                    "message": "Telegram user not found"
                }));
            }

            if let Ok(html) = resp.text().await {
                let doc = Html::parse_document(&html);
                let meta_sel = Selector::parse("meta").unwrap();

                let mut og_image = None;
                let mut og_desc = None;
                let mut og_title = None;

                for meta in doc.select(&meta_sel) {
                    if let Some(prop) = meta.value().attr("property") {
                        if prop == "og:image" {
                            og_image = meta.value().attr("content").map(|s| s.to_string());
                        } else if prop == "og:description" {
                            og_desc = meta.value().attr("content").map(|s| s.to_string());
                        } else if prop == "og:title" {
                            og_title = meta.value().attr("content").map(|s| s.to_string());
                        }
                    }
                }

                let html_lower = html.to_lowercase();
                let is_bot = html.contains("tg_badge") && html_lower.contains("bot");
                let is_verified = html.contains("verified-icon") || html.contains("verified");
                let is_scam = html_lower.contains("scam");
                let is_fake = html_lower.contains("fake");

                let display_name = og_title
                    .as_deref()
                    .unwrap_or(username)
                    .trim_start_matches("Telegram: Contact @")
                    .to_string();

                Json(json!({
                    "status": true,
                    "result": {
                        "username": username,
                        "name": display_name,
                        "avatar": og_image,
                        "bio": og_desc.unwrap_or_default(),
                        "is_bot": is_bot,
                        "is_verified": is_verified,
                        "is_scam": is_scam,
                        "is_fake": is_fake,
                        "url": target
                    },
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca response Telegram"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Request error: {}", e)
        })),
    }
}

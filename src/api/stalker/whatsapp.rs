use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct WhatsappParams {
    pub link: Option<String>,
    pub url: Option<String>,
    pub channel: Option<String>,
}

fn extract_meta(html: &str, property: &str) -> Option<String> {
    let p1 = format!(r#"(?i)<meta[^>]+(?:property|name)=["']{}["'][^>]+content=["']([^"']+)["']"#, property);
    if let Ok(re) = Regex::new(&p1) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                return Some(m.as_str().to_string());
            }
        }
    }
    let p2 = format!(r#"(?i)<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']{}["']"#, property);
    if let Ok(re) = Regex::new(&p2) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                return Some(m.as_str().to_string());
            }
        }
    }
    None
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<WhatsappParams>,
    body: Option<Json<WhatsappParams>>,
) -> impl IntoResponse {
    let b = body.as_ref().map(|x| &x.0);

    let input_raw = query.link
        .or(query.url)
        .or(query.channel)
        .or_else(|| b.and_then(|x| x.link.clone().or_else(|| x.url.clone()).or_else(|| x.channel.clone())))
        .unwrap_or_default();

    let input = input_raw.trim();
    if input.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'link' wajib diisi (URL Channel atau URL Group)",
            "example": {
                "group": "/api/stalker/whatsapp?link=https://chat.whatsapp.com/KfTAZgFu9mtA1U8vZejXaD",
                "channel": "/api/stalker/whatsapp?link=https://www.whatsapp.com/channel/0029Vb7bAFaCXC3E44TGgK3B"
            }
        }));
    }

    let target_url = if input.starts_with("http://") || input.starts_with("https://") {
        input.to_string()
    } else {
        format!("https://www.whatsapp.com/channel/{}", input)
    };

    let client = &state.client;
    match client.get(&target_url).header("User-Agent", USER_AGENT).send().await {
        Ok(res) => {
            if let Ok(html) = res.text().await {
                let title = extract_meta(&html, "og:title")
                    .or_else(|| extract_meta(&html, "twitter:title"))
                    .unwrap_or_default();
                let description = extract_meta(&html, "og:description")
                    .or_else(|| extract_meta(&html, "description"))
                    .unwrap_or_default();
                let image = extract_meta(&html, "og:image")
                    .or_else(|| extract_meta(&html, "twitter:image"));

                return Json(json!({
                    "status": true,
                    "result": {
                        "title": title,
                        "description": description,
                        "image": image,
                        "url": target_url
                    }
                }));
            }

            Json(json!({
                "status": false,
                "message": "Gagal membaca halaman WhatsApp"
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Gagal menghubungi WhatsApp: {}", e)
        })),
    }
}

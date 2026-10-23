use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const BASE_URL: &str = "https://react.v1.zfile.web.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct ReachParams {
    pub url: Option<String>,
    pub link: Option<String>,
    pub emoji: Option<String>,
    pub emojis: Option<serde_json::Value>,
}

fn random_ip() -> String {
    let mut rng = rand::thread_rng();
    format!(
        "{}.{}.{}.{}",
        rng.gen_range(1..254),
        rng.gen_range(1..254),
        rng.gen_range(1..254),
        rng.gen_range(1..254)
    )
}

fn parse_emojis(raw: &str) -> Vec<String> {
    if raw.contains(',') {
        raw.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        vec![raw.trim().to_string()]
    }
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<ReachParams>,
    body: Option<Json<ReachParams>>,
) -> impl IntoResponse {
    let url = query.url
        .or(query.link)
        .or_else(|| body.as_ref().and_then(|b| b.url.clone().or_else(|| b.link.clone())))
        .unwrap_or_default();

    let emoji_str = query.emoji
        .or_else(|| body.as_ref().and_then(|b| b.emoji.clone()))
        .unwrap_or_default();

    if url.is_empty() || emoji_str.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'url' dan 'emoji' wajib diisi"
        }));
    }

    let emoji_list = parse_emojis(&emoji_str);
    let ip = random_ip();

    let payload = json!({
        "url": url,
        "emojis": emoji_list,
        "visitorIp": ip
    });

    let client = &state.http_client;
    let target = format!("{}/api/react", BASE_URL);

    match client.post(&target)
        .header("User-Agent", UA)
                    .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                Json(json!({
                    "status": true,
                    "result": data,
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal parse response dari upstream"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Gagal mengirim reaksi: {}", e)
        })),
    }
}

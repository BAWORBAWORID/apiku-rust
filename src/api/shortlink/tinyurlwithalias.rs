use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct AliasParams {
    pub link: Option<String>,
    pub url: Option<String>,
    pub alias: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<AliasParams>,
    body: Option<Json<AliasParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let link_opt = query.link
        .or(query.url)
        .or_else(|| body.as_ref().and_then(|b| b.link.clone().or_else(|| b.url.clone())));
    let alias_opt = query.alias
        .or_else(|| body.as_ref().and_then(|b| b.alias.clone()));

    let link = match link_opt {
        Some(l) if l.starts_with("http://") || l.starts_with("https://") => l,
        _ => {
            return Json(json!({
                "status": false,
                "message": "[!] masukan parameter link url yang valid"
            }));
        }
    };

    let alias = match alias_opt {
        Some(a) if !a.trim().is_empty() => a.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "[!] masukan parameter alias"
            }));
        }
    };

    let target = format!(
        "https://tinyurl.com/api-create.php?url={}&alias={}",
        urlencoding::encode(&link),
        urlencoding::encode(&alias)
    );

    match client.get(&target).send().await {
        Ok(resp) => {
            if let Ok(short) = resp.text().await {
                if short.starts_with("http") {
                    Json(json!({
                        "status": true,
                        "result": {
                            "original": link,
                            "alias": alias,
                            "short": short.trim()
                        },
                    }))
                } else {
                    Json(json!({
                        "status": false,
                        "message": format!("Gagal memendekkan URL atau alias sudah dipakai: {}", short)
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

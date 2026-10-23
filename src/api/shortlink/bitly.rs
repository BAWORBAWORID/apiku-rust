use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;
use axum::response::Response;

const BITLY_KEYS: &[&str] = &[
    "c71b6658a1d271ddaf2a5077de3dcb9d67f68025",
    "cddbceccdc2f1c9d11e4cdd0d2b1d1078e447c43",
    "7915c671fbd90eca96310e5c9442d761225a1080",
    "e5dee46eb2d69fc9f4b0057266226a52a3555356",
    "f09ab8db9cf778b37a1cf8bc406eee5063816dec",
    "964080579f959c0cc3226b4b2053cd6520bb60ad",
    "a4f429289bf8bf6291be4b1661df57dde5066525",
    "3d48e2601f25800f375ba388c30266aad54544ae",
    "4854cb9fbad67724a2ef9c27a9d1a4e9ded62faa",
    "d375cf1fafb3dc17e711870524ef4589995c4f69",
    "43f58e789d57247b2cf285d7d24ab755ba383a28",
    "971f6c6c2efe6cb5d278b4164acef11c5f21b637",
    "ae128b3094c96bf5fd1a349e7ac03113e21d82c9",
    "e65f2948f584ffd4c568bf248705eee2714abdd2",
    "08425cf957368db9136484145aa6771e1171e232",
    "dc4bec42a64749b0f23f1a8f525a69184227e301",
    "0f9eb729a7a08ff5e73fe1860c6dc587cc523035",
    "037c5017712c8f5f154ebbe6f91db1f82793c375",
];

#[derive(Debug, Deserialize)]
pub struct BitlyParams {
    pub link: Option<String>,
    pub url: Option<String>,
}

fn is_valid_url(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<BitlyParams>,
    body: Option<Json<BitlyParams>>,
) -> Response {
    let link_opt = query.link
        .or(query.url)
        .or_else(|| body.as_ref().and_then(|b| b.link.clone().or_else(|| b.url.clone())));

    let link = match link_opt {
        Some(l) if !l.trim().is_empty() => l.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "[!] masukan parameter link"
            })).into_response();
        }
    };

    if !is_valid_url(&link) {
        return Json(json!({
            "status": false,
            "message": "[!] masukan parameter url sahaja"
        })).into_response();
    }

    let mut keys = BITLY_KEYS.to_vec();
    {
        let mut rng = rand::thread_rng();
        keys.shuffle(&mut rng);
    }

    let client = &state.client;
    let mut last_error = "Gagal memperpendek link melalui Bitly".to_string();

    for key in keys {
        let payload = json!({ "long_url": link });
        match client.post("https://api-ssl.bitly.com/v4/shorten")
            .header("Authorization", format!("Bearer {}", key))
                        .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    if let Ok(data) = resp.json::<serde_json::Value>().await {
                        if let Some(short) = data.get("link").and_then(|l| l.as_str()) {
                            return Json(json!({
                                "status": true,
                                "result": short,
                                "data": {
                                    "id": data.get("id"),
                                    "link": short,
                                    "long_url": data.get("long_url").unwrap_or(&json!(link)),
                                    "created_at": data.get("created_at")
                                }
                            })).into_response();
                        }
                    }
                } else if status.as_u16() == 401 || status.as_u16() == 403 || status.as_u16() == 429 {
                    last_error = format!("Bitly key error (status {})", status);
                    continue;
                } else {
                    if let Ok(err_data) = resp.json::<serde_json::Value>().await {
                        let msg = err_data.get("message").and_then(|m| m.as_str()).unwrap_or("Invalid URL or domain");
                        return Json(json!({
                            "status": false,
                            "message": msg
                        })).into_response();
                    }
                }
            }
            Err(e) => {
                last_error = e.to_string();
            }
        }
    }

    Json(json!({
        "status": false,
        "message": last_error
    })).into_response()
}

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct RobloxParams {
    pub username: Option<String>,
    pub query: Option<String>,
    pub id: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<RobloxParams>,
    body: Option<Json<RobloxParams>>,
) -> impl IntoResponse {
    let b = body.as_ref().map(|x| &x.0);

    let user_raw = query.username
        .or(query.query)
        .or(query.id)
        .or_else(|| b.and_then(|x| x.username.clone().or_else(|| x.query.clone()).or_else(|| x.id.clone())))
        .unwrap_or_default();

    let username = user_raw.trim();
    if username.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'username' atau 'query' wajib diisi"
        }));
    }

    let client = &state.client;

    // Check if input is direct numeric ID
    let user_id = if username.chars().all(|c| c.is_ascii_digit()) {
        username.to_string()
    } else {
        let lookup_payload = json!({
            "usernames": [username],
            "excludeBannedUsers": false
        });

        match client.post("https://users.roblox.com/v1/usernames/users")
                        .header("Content-Type", "application/json")
            .json(&lookup_payload)
            .send()
            .await
        {
            Ok(res) => {
                if let Ok(data) = res.json::<serde_json::Value>().await {
                    if let Some(first) = data.get("data").and_then(|d| d.as_array()).and_then(|arr| arr.first()) {
                        first.get("id").and_then(|id| id.as_i64()).map(|n| n.to_string()).unwrap_or_default()
                    } else {
                        return Json(json!({
                            "status": false,
                            "message": format!("User Roblox '{}' tidak ditemukan", username)
                        }));
                    }
                } else {
                    return Json(json!({
                        "status": false,
                        "message": "Gagal mencari user Roblox"
                    }));
                }
            }
            Err(e) => {
                return Json(json!({
                    "status": false,
                    "message": format!("Error lookup user Roblox: {}", e)
                }));
            }
        }
    };

    if user_id.is_empty() {
        return Json(json!({
            "status": false,
            "message": format!("User Roblox '{}' tidak ditemukan", username)
        }));
    }

    let profile_url = format!("https://users.roblox.com/v1/users/{}", user_id);
    match client.get(&profile_url).send().await {
        Ok(res) => {
            if let Ok(profile) = res.json::<serde_json::Value>().await {
                Json(json!({
                    "status": true,
                    "result": profile
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca profil Roblox"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error fetch profil Roblox: {}", e)
        })),
    }
}

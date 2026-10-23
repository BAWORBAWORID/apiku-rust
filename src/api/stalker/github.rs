use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
pub struct GithubParams {
    pub username: Option<String>,
    pub user: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<GithubParams>,
    body: Option<Json<GithubParams>>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let body_params = body.map(|b| b.0).unwrap_or_default();
    let username = body_params.username
        .or(body_params.user)
        .or(query.username)
        .or(query.user)
        .unwrap_or_default()
        .trim()
        .to_string();


    if username.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'username' wajib diisi (contoh: octocat)"
        }));
    }

    let url = format!("https://api.github.com/users/{}", username);

    match state.client.get(&url)
                    .header("User-Agent", "Apiku-Rust-Stalker/1.0")
                    .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status();
            if status == reqwest::StatusCode::NOT_FOUND {
                return Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": format!("Pengguna GitHub '{}' tidak ditemukan.", username),
                }));
            }
            if status == reqwest::StatusCode::FORBIDDEN {
                return Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": "Batas kuota GitHub API tercapai. Silakan coba beberapa saat lagi.",
                }));
            }

            if let Ok(data) = res.json::<Value>().await {
                Json(json!({
                    "status": true,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "result": {
                        "username": data.get("login"),
                        "name": data.get("name"),
                        "avatar": data.get("avatar_url"),
                        "bio": data.get("bio"),
                        "company": data.get("company"),
                        "location": data.get("location"),
                        "blog": data.get("blog"),
                        "public_repos": data.get("public_repos"),
                        "public_gists": data.get("public_gists"),
                        "followers": data.get("followers"),
                        "following": data.get("following"),
                        "created_at": data.get("created_at"),
                        "updated_at": data.get("updated_at"),
                        "html_url": data.get("html_url")
                    },
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                }))
            } else {
                Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": "Gagal mengurai respons data pengguna dari GitHub.",
                }))
            }
        }
        Err(e) => {
            Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": format!("Gagal terhubung ke GitHub: {}", e),
            }))
        }
    }
}

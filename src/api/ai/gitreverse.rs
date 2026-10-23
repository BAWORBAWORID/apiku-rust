use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct GitReverseParams {
    pub repo: Option<String>,
    pub url: Option<String>,
}

fn normalize_repo(input: &str) -> Result<String, String> {
    let mut repo = input.trim().to_string();
    if repo.is_empty() {
        return Err("Parameter 'repo' atau 'url' wajib diisi".to_string());
    }

    if let Some(pos) = repo.find("github.com/") {
        repo = repo[pos + 11..].to_string();
    }

    if let Some(pos) = repo.find('?') {
        repo = repo[..pos].to_string();
    }
    if let Some(pos) = repo.find('#') {
        repo = repo[..pos].to_string();
    }
    repo = repo.trim_end_matches('/').trim_end_matches(".git").to_string();

    let parts: Vec<&str> = repo.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Err("Format repository tidak valid. Gunakan 'owner/repo' atau URL GitHub (contoh: WhiskeySockets/Baileys)".to_string());
    }

    Ok(format!("{}/{}", parts[0], parts[1]))
}

pub async fn handler(
    Query(query): Query<GitReverseParams>,
    body: Option<Json<GitReverseParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let raw_repo = params.repo.or(params.url).unwrap_or_default();

    let repo_slug = match normalize_repo(&raw_repo) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "status": false,
                    "message": e
                })),
            );
        }
    };

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let res = client
        .post("https://www.gitreverse.com/api/reverse-prompt")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36")
                    .header("Accept", "*/*")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://www.gitreverse.com")
        .header("Referer", format!("https://www.gitreverse.com/{}", repo_slug))
        .json(&json!({ "repoUrl": &repo_slug }))
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                (
                    StatusCode::OK,
                    Json(json!({
                        "status": true,
                        "result": data
                    })),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal membaca response dari GitReverse"
                    })),
                )
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": e.to_string()
            })),
        ),
    }
}

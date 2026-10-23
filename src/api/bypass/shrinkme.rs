// Shrinkme Bypass — native conversion of api/bypass/shrinkme.js
// Pure HTTP: fetch form inputs from shrinkme domain, sleep, POST /links/go.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const DOMAINS: [&str; 3] = [
    "https://en.shrinke.me",
    "https://shrinkme.click",
    "https://shrinkme.io",
];

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

async fn bypass_shrinkme(url: &str) -> Option<String> {
    let client = client().ok()?;
    let code = url.trim_end_matches('/').split('/').next_back()?.to_string();

    for domain in DOMAINS {
        let final_url = format!("{}/{}", domain, code);
        let resp = client
            .get(&final_url)
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                        .header("Accept-Language", "en-US,en;q=0.5")
                        .header("Referer", "https://mrproblogger.com/")
            .send()
            .await;
        let html = match resp {
            Ok(r) => r.text().await.unwrap_or_default(),
            Err(_) => continue,
        };
        if html.is_empty() {
            continue;
        }

        let input_re = regex::Regex::new(r#"(?is)<input[^>]*>"#).unwrap();
        let name_re = regex::Regex::new(r#"name=["']([^"']*)["']"#).unwrap();
        let value_re = regex::Regex::new(r#"value=["']([^"']*)["']"#).unwrap();

        let mut form: Vec<(String, String)> = Vec::new();
        for tag in input_re.find_iter(&html) {
            let tag = tag.as_str();
            if let Some(n) = name_re.captures(tag).and_then(|c| c.get(1)) {
                let v = value_re
                    .captures(tag)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                form.push((n.as_str().to_string(), v));
            }
        }
        if form.is_empty() {
            continue;
        }

        tokio::time::sleep(std::time::Duration::from_secs(12)).await;

        let go_resp = client
            .post(format!("{}/links/go", domain))
                        .header("X-Requested-With", "XMLHttpRequest")
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("Referer", "https://mrproblogger.com/")
            .form(&form)
            .send()
            .await;
        if let Ok(gr) = go_resp {
            let text = gr.text().await.unwrap_or_default();
            if let Ok(j) = serde_json::from_str::<Value>(&text) {
                if let Some(u) = j.get("url").and_then(|u| u.as_str()) {
                    if u.starts_with("http") {
                        return Some(u.to_string());
                    }
                }
            } else if text.starts_with("http") && !text.contains("<html") {
                return Some(text.trim().to_string());
            }
        }
    }
    None
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let url_param = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });
    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'url' wajib diisi"
            })))
            .into_response()
        }
    };
    let shrinkme_re = regex::Regex::new(r"shrinkme\.(click|io)|shrinke\.me").unwrap();
    if !shrinkme_re.is_match(&url) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "URL harus dari shrinkme.click / shrinkme.io / shrinke.me"
        })))
        .into_response();
    }

    match bypass_shrinkme(&url).await {
        Some(result) => Json(json!({ "status": true, "result": result })).into_response(),
        None => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": "Gagal bypass shortlink"
        })))
        .into_response(),
    }
}

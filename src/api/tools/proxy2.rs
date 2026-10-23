// Proxy2 — native conversion of api/tools/proxy2.js (CORS proxy via proxysite.com)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const SERVERS: &[&str] = &[
    "us1", "us2", "us3", "us4", "us5", "us6", "us7", "us8", "us9", "us10", "us11", "eu1", "eu2",
    "eu3", "eu4", "eu5",
];

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36";

async fn proxy_request(
    client: &reqwest::Client,
    target_url: &str,
    server: &str,
) -> Result<reqwest::Response, String> {
    let base = format!("https://{}.proxysite.com", server);

    let form = format!(
        "d={}&server-option={}&allowCookies=on&stripJS=on&stripObjects=on",
        urlencoding::encode(target_url),
        server
    );

    let no_redirect_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let post_res = no_redirect_client
        .post(format!("{}/includes/process.php?action=update", base))
        .header(
            "accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
                    .header("content-type", "application/x-www-form-urlencoded")
        .header("origin", &base)
        .header("referer", format!("{}/", base))
        .header("user-agent", USER_AGENT)
        .body(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut cookie_str = String::new();
    for val in post_res.headers().get_all("set-cookie") {
        if let Ok(c) = val.to_str() {
            let kv = c.split(';').next().unwrap_or("").trim();
            if !cookie_str.is_empty() {
                cookie_str.push_str("; ");
            }
            cookie_str.push_str(kv);
        }
    }

    let location = post_res
        .headers()
        .get("location")
        .and_then(|l| l.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Redirect tidak ditemukan untuk server {}", server))?;

    let redirect_url = if location.starts_with("http") {
        location
    } else if location.starts_with('/') {
        format!("{}{}", base, location)
    } else {
        format!("{}/{}", base, location)
    };

    client
        .get(&redirect_url)
        .header("cookie", &cookie_str)
        .header("referer", format!("{}/", base))
        .header("user-agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| e.to_string())
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    method: axum::http::Method,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    if method == axum::http::Method::OPTIONS {
        return (
            axum::http::StatusCode::NO_CONTENT,
            [
                ("Access-Control-Allow-Origin", "*"),
                ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                (
                    "Access-Control-Allow-Headers",
                    "Content-Type, Authorization, X-Requested-With",
                ),
            ],
        )
            .into_response();
    }

    let url = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|b| b.get("url"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    });

    let url = match url {
        Some(u) if !u.is_empty() => u,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'url' wajib diisi",
                "example": "/tools/proxy2?url=https://example.com",
            }))
            .into_response()
        }
    };

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Json(json!({
            "status": false,
            "message": "Format URL tidak valid. Gunakan URL lengkap dengan protokol (http/https).",
            "example": "https://example.com",
        }))
        .into_response();
    }

    use rand::seq::SliceRandom;
    let server = SERVERS
        .choose(&mut rand::thread_rng())
        .copied()
        .unwrap_or("us1");

    match proxy_request(&state.client, &url, server).await {
        Ok(res) => {
            let status = res.status().as_u16();
            let content_type = res
                .headers()
                .get("content-type")
                .and_then(|c| c.to_str().ok())
                .unwrap_or("text/plain; charset=utf-8")
                .to_string();
            let bytes = res.bytes().await.unwrap_or_default();

            Response::builder()
                .status(
                    axum::http::StatusCode::from_u16(status).unwrap_or(axum::http::StatusCode::OK),
                )
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                .header(
                    "Access-Control-Allow-Headers",
                    "Content-Type, Authorization, X-Requested-With",
                )
                .header("X-Proxy-Server", server)
                .header(
                    "X-Proxy-Region",
                    if server.starts_with("us") { "US" } else { "EU" },
                )
                .header("X-Proxy-Status", status.to_string())
                .header("Content-Type", content_type)
                .body(axum::body::Body::from(bytes))
                .unwrap_or_else(|_| {
                    Json(json!({"status": false, "message": "Gagal memproses proxy request"}))
                        .into_response()
                })
        }
        Err(e) => Json(json!({"status": false, "message": e})).into_response(),
    }
}

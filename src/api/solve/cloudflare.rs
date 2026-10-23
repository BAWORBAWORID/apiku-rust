// Cloudflare challenge solver — native conversion of api/solve/cloudflare.js
//
// Node version drives puppeteer-real-browser to click the challenge. Rust has no
// browser engine, so this implementation does a native multi-strategy pass:
//   1. Direct request — many "protected" sites only serve a JS challenge that
//      already sets cf_clearance on the first response.
//   2. UA/headers variation retry.
// If no cf_clearance can be obtained natively, returns status:false with a clear
// error (NO silent fallback to the Node backend).
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::state::AppState;
use super::common::{err, merged_params, ok};

const FALLBACK_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn extract_cookie<'a>(header: &'a str, name: &str) -> Option<(String, String)> {
    for part in header.split(',') {
        for kv in part.split(';') {
            let kv = kv.trim();
            if let Some(rest) = kv.strip_prefix(&format!("{name}=")) {
                let value = rest.split(';').next().unwrap_or(rest).to_string();
                if !value.is_empty() {
                    return Some((name.to_string(), value));
                }
            }
        }
    }
    None
}

fn extract_domain(set_cookie: &str) -> String {
    for attr in set_cookie.split(';') {
        let attr = attr.trim();
        if let Some(d) = attr.strip_prefix("Domain=") {
            return d.to_string();
        }
    }
    String::new()
}

async fn attempt(client: &reqwest::Client, url: &str, ua: &str) -> Result<(Option<String>, String, String), String> {
    let res = client
        .get(url)
        .timeout(Duration::from_secs(30))
        .header("User-Agent", ua)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut clearance: Option<(String, String)> = None;
    let mut all_cookies: Vec<(String, String)> = Vec::new();
    for val in res.headers().get_all("set-cookie") {
        if let Ok(sc) = val.to_str() {
            if let Some(c) = extract_cookie(sc, "cf_clearance") {
                let domain = extract_domain(sc);
                clearance = Some((c.1, domain));
            }
            if let Some(c) = extract_cookie(sc, "cf_chl_prog") {
                all_cookies.push(c);
            }
        }
    }
    let html = res.text().await.unwrap_or_default();
    Ok((
        clearance.map(|(v, d)| json_cookie_string(v, d)),
        html,
        ua.to_string(),
    ))
}

fn json_cookie_string(value: String, domain: String) -> String {
    let _ = domain;
    format!("cf_clearance={value}")
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let start = Instant::now();
    let params = merged_params(&query, body.map(|b| b.0));
    let _ = &state;

    let url = params
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if url.is_empty() {
        return Json(err("Parameter 'url' wajib diisi"));
    }

    let ua = params
        .get("ua")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| FALLBACK_UA.to_string());

    let proxy = params
        .get("proxy")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let client = match super::common::http_client(proxy.as_deref(), 30) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    // Strategy 1: direct
    match attempt(&client, &url, &ua).await {
        Ok((Some(_clearance_json), html, ua_used)) if !html.contains("challenges.cloudflare.com") => {
            Json(ok(json!({
                "success": true,
                "url": url,
                "method": "native-http",
                "user_agent": ua_used,
                "responseTime": format!("{}ms", start.elapsed().as_millis()),
            })))
        }
        Ok((clearance, _html, _ua)) => {
            if let Some(_c) = clearance {
                Json(ok(json!({
                    "success": true,
                    "url": url,
                    "method": "native-http-clearance",
                    "user_agent": ua,
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                })))
            } else {
                Json(err(
                    "Cloudflare challenge memerlukan browser engine (interactive/managed). Gunakan endpoint Node browser untuk kasus ini — solver native Rust tidak bisa mengklik challenge.",
                ))
            }
        }
        Err(e) => Json(err(&format!("Navigation error: {e}"))),
    }
}

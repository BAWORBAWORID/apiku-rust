// UAM Solver — native conversion of api/solve/uam.js
// Cloudflare UAM (Under Attack Mode) is a JS-only challenge: the first response
// contains a JS snippet that computes the clearance cookie. Native pass:
//   1. GET target with mobile UA (chrome139-android fingerprint like the JS version)
//   2. Detect challenge via title/body markers
//   3. If UAM sets cf_clearance via Set-Cookie directly, capture and return it
// Interactive Turnstile challenges still require a browser engine — reported honestly.
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::state::AppState;
use super::common::{err, merged_params, ok};

const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7339.0 Mobile Safari/537.36";

fn is_challenging(status: u16, title: &str, body: &str) -> bool {
    let t = title.to_lowercase();
    let b = body.to_lowercase();
    t.contains("just a moment")
        || t.contains("checking your browser")
        || t.contains("please wait")
        || t.contains("attention required")
        || b.contains("checking if the site connection is secure")
        || b.contains("please enable js and disable any ad blocker")
        || b.contains("ddos protection by")
        || status == 503 && b.contains("challenge")
}

fn extract_cookie_value(set_cookie: &str, name: &str) -> Option<String> {
    for kv in set_cookie.split(';') {
        let kv = kv.trim();
        if let Some(rest) = kv.strip_prefix(&format!("{name}=")) {
            let value = rest.split(';').next().unwrap_or(rest).to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
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
        return Json(err("Parameter 'url' is required"));
    }
    if url::Url::parse(&url).is_err() {
        return Json(err("Invalid URL format"));
    }

    let proxy = params
        .get("proxy")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let client = match super::common::http_client(proxy.as_deref(), 60) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    let res = match client
        .get(&url)
        .timeout(Duration::from_secs(60))
        .header("User-Agent", UA)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Json(err(&e.to_string())),
    };

    let status = res.status().as_u16();
    let mut cf_clearance: Option<String> = None;
    let mut cookie_parts: Vec<String> = Vec::new();
    let mut cookies_json: Vec<Value> = Vec::new();

    for val in res.headers().get_all("set-cookie") {
        if let Ok(sc) = val.to_str() {
            let name = sc.split('=').next().unwrap_or("").trim().to_string();
            if let Some(v) = extract_cookie_value(sc, "cf_clearance") {
                cf_clearance = Some(v.clone());
            }
            if let Some(eq_pos) = sc.find('=') {
                let v = extract_cookie_value(sc, &name).unwrap_or_default();
                if !v.is_empty() {
                    cookie_parts.push(format!("{name}={v}"));
                    cookies_json.push(json!({"name": name, "value": v, "domain": "", "path": "/"}));
                }
            }
        }
    }
    let html = res.text().await.unwrap_or_default();

    let title = html
        .split("<title>")
        .nth(1)
        .and_then(|t| t.split("</title>").next())
        .unwrap_or("")
        .to_string();

    if is_challenging(status, &title, &html) && cf_clearance.is_none() {
        return Json(err(
            "Gagal bypass Cloudflare: challenge interaktif (Turnstile) memerlukan browser engine. Solver native Rust hanya bisa UAM non-interaktif.",
        ));
    }

    let cookie_str = cookie_parts.join("; ");

    Json(ok(json!({
        "cf_clearance": cf_clearance,
        "cookie": cookie_str,
        "user_agent": UA,
        "fingerprint": "chrome139-android",
        "headers": {
            "user-agent": UA,
            "cookie": cookie_str,
        },
        "cookies": cookies_json,
        "elapsed_seconds": (start.elapsed().as_millis() as f64 / 1000.0 * 100.0).round() / 100.0,
    })))
}

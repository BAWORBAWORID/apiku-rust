// Turnstile Solver (native subset) — conversion of api/solve/turnstile.js
// Browser-based token solving requires a browser engine; this native version covers:
//   - sitekey auto-extraction from URL (HTML + external JS scan) — fully native
//   - token solving: NOT possible natively for interactive widgets → clear error
//     (no silent proxy fallback). The sitekey extraction + validation part of the
//     Node flow is what this endpoint now provides natively.
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use crate::state::AppState;
use super::common::{err, merged_params, ok};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn extract_sitekeys(text: &str, out: &mut HashSet<String>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 22 <= bytes.len() {
        if bytes[i] == b'0' && bytes[i + 1] == b'x' {
            let mut j = i + 2;
            while j < bytes.len()
                && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-')
            {
                j += 1;
            }
            if j - (i + 2) >= 20 {
                out.insert(text[i..j].to_string());
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

async fn extract_sitekey(client: &reqwest::Client, url: &str) -> (String, Vec<String>) {
    let mut keys: HashSet<String> = HashSet::new();
    let html = match client
        .get(url)
        
        .header("User-Agent", UA)
        .send()
        .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => return ("Error".into(), vec![]),
    };

    extract_sitekeys(&html, &mut keys);
    if !keys.is_empty() {
        return ("HTML/DOM".into(), keys.into_iter().collect());
    }

    // External JS scan (up to 10 files)
    let mut js_urls: Vec<String> = Vec::new();
    for part in html.split("src=") {
        if let Some(rest) = part.strip_prefix('"').or_else(|| part.strip_prefix('\'')) {
            if let Some(end) = rest.find(['"', '\'']) {
                let src = &rest[..end];
                if src.contains(".js") && !src.starts_with("data:") {
                    if let Ok(full) = url::Url::parse(url) {
                        if let Ok(joined) = full.join(src) {
                            js_urls.push(joined.to_string());
                        }
                    }
                }
            }
        }
        if js_urls.len() >= 10 {
            break;
        }
    }
    for js_url in js_urls {
        if let Ok(resp) = client
            .get(&js_url)
            
            .header("User-Agent", UA)
            .send()
            .await
        {
            if let Ok(js) = resp.text().await {
                extract_sitekeys(&js, &mut keys);
            }
        }
        if !keys.is_empty() {
            break;
        }
    }
    if !keys.is_empty() {
        ("External JS Scan".into(), keys.into_iter().collect())
    } else {
        ("None".into(), vec![])
    }
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
        .unwrap_or("https://onlyfans.com")
        .trim()
        .to_string();
    if url.is_empty() {
        return Json(err("Parameter 'url' is required"));
    }
    if url::Url::parse(&url).is_err() {
        return Json(err("Invalid URL format"));
    }

    let client = match super::common::http_client(None, 20) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    let manual_sitekey = params
        .get("sitekey")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let sitekey = match manual_sitekey {
        Some(k) => (k, "manual".to_string()),
        None => {
            let (method, keys) = extract_sitekey(&client, &url).await;
            if keys.is_empty() {
                return Json(err(
                    "Tidak ada Cloudflare Turnstile sitekey ditemukan di URL ini. Sertakan parameter 'sitekey' secara manual.",
                ));
            }
            (keys[0].clone(), method)
        }
    };

    // Native solve: Turnstile token requires executing CF's JS — not feasible without
    // a browser engine. Report honestly instead of proxying to Node.
    Json(err(&format!(
        "Sitekey ditemukan ({}) via {}: {} — namun solving token Turnstile memerlukan browser engine (tidak tersedia di solver native Rust).",
        sitekey.0,
        sitekey.1,
        url
    )))
}

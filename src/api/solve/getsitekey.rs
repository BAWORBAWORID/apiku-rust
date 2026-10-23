use base64::Engine as _;
// GetSitekey — extract Cloudflare Turnstile sitekeys from a target URL.
// Converted from api/solve/getsitekey.js (HTML/DOM + JS file scan).
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::collections::HashSet;

use crate::state::AppState;
use super::common::{err, merged_params, ok};

#[derive(Debug, Default, Deserialize)]
pub struct SitekeyParams {
    pub url: Option<String>,
}

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn extract_sitekeys(text: &str, out: &mut HashSet<String>) {
    // matches 0x[A-Za-z0-9_-]{20,}
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 22 <= bytes.len() {
        if bytes[i] == b'0' && bytes[i + 1] == b'x' {
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-') {
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

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let params = merged_params(&query, body.map(|b| b.0));
    let target_url = match params.get("url").and_then(Value::as_str) {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return Json(err("Parameter 'url' wajib diisi")),
    };

    let client = match super::common::http_client(None, 15) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };
    let _ = &state;

    let html = match client
        .get(&target_url)
        .header("User-Agent", UA)
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return Json(err(&e.to_string())),
        },
        Err(e) => return Json(err(&e.to_string())),
    };

    let mut sitekeys: HashSet<String> = HashSet::new();
    extract_sitekeys(&html, &mut sitekeys);

    if sitekeys.is_empty() {
        // Fallback: scan up to 10 linked JS files
        let mut js_urls: Vec<String> = Vec::new();
        for part in html.split("src=") {
            if let Some(rest) = part.strip_prefix('"').or_else(|| part.strip_prefix('\'')) {
                if let Some(end) = rest.find(['"', '\'']) {
                    let src = &rest[..end];
                    if src.contains(".js") && !src.starts_with("data:") {
                        if let Ok(full) = url::Url::parse(&target_url) {
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
            if let Ok(resp) = client.get(&js_url).header("User-Agent", UA).send().await {
                if let Ok(js_content) = resp.text().await {
                    extract_sitekeys(&js_content, &mut sitekeys);
                }
            }
            if !sitekeys.is_empty() {
                break;
            }
        }
    }

    if sitekeys.is_empty() {
        return Json(err("Sitekey tidak ditemukan pada halaman atau file JS"));
    }

    let keys: Vec<String> = sitekeys.into_iter().collect();
    let count = keys.len();
    Json(ok(json!({
        "url": target_url,
        "method": "HTML/DOM",
        "count": count,
        "sitekeys": keys,
    })))
}

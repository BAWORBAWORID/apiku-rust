// BypassLink v2 — native conversion of api/bypass/bypasslinkv2.js
// Pure HTTP: trw.lat bypass API + redirect-chain fallback.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API: &str = "https://trw.lat/api/bypass";
const API_KEY: &str = "TRW_FREE-GAY-15a92945-9b04-4c75-8337-f2a6007281e9";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn parse_result(result: &str) -> String {
    let t = result.trim();
    // python tuple form: ('url', True)
    if (t.starts_with("('") || t.starts_with("(\"")) && t.ends_with(')') {
        if let Some(end) = t.rfind(',') {
            let inner = t[1..end].trim();
            let inner = inner.trim_matches('\'').trim_matches('"');
            return inner.to_string();
        }
    }
    if t.len() > 1
        && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')))
    {
        return t[1..t.len() - 1].to_string();
    }
    t.to_string()
}

fn resolve_relative(href: &str, base: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    url::Url::parse(base)
        .ok()
        .and_then(|b| b.join(href).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| href.to_string())
}

async fn bypass_url(url: &str) -> Result<String, String> {
    let api = format!("{}?apikey={}&url={}", API, API_KEY, urlencoding::encode(url));
    let client = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&api)
                    .header("accept", "*/*")
                    .header("origin", "https://bypassunlock.com")
                    .header("referer", "https://bypassunlock.com/")
                    .header("user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let data: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            return Err(if text.is_empty() {
                format!("HTTP {}", status)
            } else {
                text
            })
        }
    };
    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let result = data.get("result").cloned().unwrap_or(Value::Null);
    if !status.is_success() || !success || result.is_null() {
        let upstream_error = data
            .get("message")
            .or_else(|| data.get("error"))
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .or_else(|| result.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("Bypass failed: HTTP {}", status));
        return Err(upstream_error);
    }
    Ok(parse_result(result.as_str().unwrap_or("")))
}

async fn resolve_redirects(url: &str, max_hops: usize) -> String {
    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(_) => return url.to_string(),
    };
    let mut current = url.to_string();
    for _ in 0..max_hops {
        let res = match client
            .get(&current)
            .header("User-Agent", UA)
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => break,
        };
        let status = res.status().as_u16();
        if (300..400).contains(&status) {
            if let Some(loc) = res.headers().get("location").and_then(|l| l.to_str().ok()) {
                current = resolve_relative(loc.trim(), &current);
                continue;
            }
        }
        let text = res.text().await.unwrap_or_default();
        let meta_re = regex::Regex::new(
            r#"(?i)<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']"#,
        )
        .unwrap();
        if let Some(m) = meta_re.captures(&text) {
            current = resolve_relative(m.get(1).unwrap().as_str().trim(), &current);
            continue;
        }
        let js_re =
            regex::Regex::new(r#"(?i)window\.location(?:\.href)?\s*=\s*["']([^"']+)["']"#).unwrap();
        if let Some(m) = js_re.captures(&text) {
            current = resolve_relative(m.get(1).unwrap().as_str().trim(), &current);
            continue;
        }
        break;
    }
    current
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
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
    if url::Url::parse(&url).is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Format URL tidak valid"
        })))
        .into_response();
    }

    match bypass_url(&url).await {
        Ok(result) => Json(json!({
            "status": true,
            "result": {
                "originalUrl": url,
                "bypassedUrl": result,
                "responseTime": format!("{}ms", start.elapsed().as_millis())
            }
        }))
        .into_response(),
        Err(err) => {
            let fallback = resolve_redirects(&url, 10).await;
            if !fallback.is_empty() && fallback != url {
                return Json(json!({
                    "status": true,
                    "result": {
                        "originalUrl": url,
                        "bypassedUrl": fallback,
                        "responseTime": format!("{}ms", start.elapsed().as_millis())
                    }
                }))
                .into_response();
            }
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": err,
                "result": { "responseTime": format!("{}ms", start.elapsed().as_millis()) }
            })))
                .into_response()
        }
    }
}

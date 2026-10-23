// MovieZone — native conversion of api/movie/moviezone.js
// Scraping movie-zone main site: home, search, detail, server list (HTML + escaped payload regex).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://movie-zone.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";

fn merged(query: &HashMap<String, String>, body: Option<&Value>) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in query { m.insert(k.clone(), json!(v)); }
    if let Some(Value::Object(b)) = body { for (k, v) in b { m.insert(k.clone(), v.clone()); } }
    m
}

fn pstr(m: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(Value::String(s)) = m.get(*k) { if !s.trim().is_empty() { return s.trim().to_string(); } }
        if let Some(Value::Number(n)) = m.get(*k) { return n.to_string(); }
    }
    String::new()
}

fn pnum(m: &serde_json::Map<String, Value>, keys: &[&str], default: i64) -> i64 {
    for k in keys {
        match m.get(*k) {
            Some(Value::Number(n)) => return n.as_i64().unwrap_or(default),
            Some(Value::String(s)) => { if let Ok(x) = s.trim().parse::<i64>() { return x; } }
            _ => {}
        }
    }
    default
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).user_agent(UA).build().unwrap()
}

async fn fetch_page(url: &str) -> Result<String, String> {
    let res = client().get(url)
                    .header("Accept", "text/html,application/xhtml+xml")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let html = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("MovieZone HTTP {}", status)); }
    Ok(html)
}

fn decode_payload(html: &str) -> String {
    html.replace("\\\"", "\"").replace("\\u0026", "&").replace("\\u003d", "=")
        .replace("\\u003c", "<").replace("\\u003e", ">").replace("\\n", "\n").replace("&amp;", "&")
}

fn strip_tags(s: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    let ws = regex::Regex::new(r"\s+").unwrap();
    ws.replace_all(&re.replace_all(s, ""), " ").trim().to_string()
}

fn extract_cards(text: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let re = regex::Regex::new(r#""title":"([^"\\]+)"[\s\S]{0,2000}?"poster":"(https?:[^"\\]+)"[\s\S]{0,2000}?"slug":"([^"\\]+)""#).unwrap();
    for cap in re.captures_iter(text) {
        let slug = cap.get(3).map(|m| m.as_str()).unwrap_or("").to_string();
        if slug.is_empty() { continue; }
        items.push(json!({
            "title": cap.get(1).map(|m| m.as_str()).unwrap_or(""),
            "poster": cap.get(2).map(|m| m.as_str()).unwrap_or(""),
            "slug": slug,
            "url": format!("{}/movie/{}", BASE, slug),
        }));
    }
    // fallback: <a href="/movie/..."> anchors
    if items.is_empty() {
        let re2 = regex::Regex::new(r#"<a[^>]+href="(/movie/[^"]+)"[^>]*>[\s\S]{0,600}?<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>(?:[\s\S]{0,400}?<[^>]*title[^>]*>([^<]+)</)?"#).unwrap();
        for cap in re2.captures_iter(text) {
            let href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            let slug = href.trim_start_matches("/movie/").trim_matches('/').to_string();
            items.push(json!({
                "title": strip_tags(cap.get(3).map(|m| m.as_str()).unwrap_or("")),
                "poster": cap.get(2).map(|m| m.as_str()).unwrap_or(""),
                "slug": slug,
                "url": format!("{}{}", BASE, href),
            }));
        }
    }
    let mut seen: Vec<String> = Vec::new();
    items.into_iter().filter(|i| {
        let s = i.get("slug").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if s.is_empty() || seen.contains(&s) { return false; }
        seen.push(s); true
    }).collect()
}

fn extract_servers(text: &str) -> Vec<Value> {
    let mut servers = Vec::new();
    let re = regex::Regex::new(r#""(?:server_name|server)":"([^"\\]+)"[\s\S]{0,600}?"(?:url|link|iframe|embed_url)":"(https?:[^"\\]+)""#).unwrap();
    for cap in re.captures_iter(text) {
        servers.push(json!({
            "name": cap.get(1).map(|m| m.as_str()).unwrap_or("server"),
            "url": cap.get(2).map(|m| m.as_str()).unwrap_or(""),
        }));
    }
    if servers.is_empty() {
        let re2 = regex::Regex::new(r#"<iframe[^>]+(?:src|data-src)="(https?://[^"]+)""#).unwrap();
        for (i, cap) in re2.captures_iter(text).enumerate() {
            servers.push(json!({"name": format!("Server {}", i + 1), "url": cap.get(1).map(|m| m.as_str()).unwrap_or("")}));
        }
    }
    let mut seen: Vec<String> = Vec::new();
    servers.into_iter().filter(|s| {
        let u = s.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if u.is_empty() || seen.contains(&u) { return false; }
        seen.push(u); true
    }).collect()
}

async fn scrape_home() -> Result<Value, String> {
    let html = fetch_page(BASE).await?;
    let decoded = decode_payload(&html);
    let items = extract_cards(&decoded);
    Ok(json!({"source": BASE, "total": items.len(), "results": items}))
}

async fn scrape_search(keyword: &str, page: i64) -> Result<Value, String> {
    let url = format!("{}/search?keyword={}&page={}", BASE, urlencoding::encode(keyword), page.max(1));
    let html = fetch_page(&url).await?;
    let decoded = decode_payload(&html);
    let items = extract_cards(&decoded);
    Ok(json!({"keyword": keyword, "page": page.max(1), "total": items.len(), "results": items}))
}

async fn scrape_detail(slug_or_url: &str) -> Result<Value, String> {
    let mut url = slug_or_url.trim().to_string();
    if !regex::Regex::new(r"(?i)^https?://").unwrap().is_match(&url) {
        let clean = url.trim_matches('/');
        url = if clean.starts_with("movie/") { format!("{}/{}", BASE, clean) } else { format!("{}/movie/{}", BASE, clean) };
    }
    let html = fetch_page(&url).await?;
    let decoded = decode_payload(&html);
    let title_re = regex::Regex::new(r#"<title[^>]*>([^<]+)</title>"#).unwrap();
    let title = title_re.captures(&html)
        .map(|c| c.get(1).map(|m| m.as_str()).unwrap_or("").trim().replace(" - MovieZone", ""))
        .unwrap_or_default();
    let poster = regex::Regex::new(r#""poster":"(https?:[^"\\]+)""#).unwrap().captures(&decoded)
        .or_else(|| regex::Regex::new(r#"<meta[^>]+property="og:image"[^>]+content="([^"]+)""#).unwrap().captures(&html))
        .map(|c| c.get(1).map(|m| m.as_str()).unwrap_or("").to_string())
        .unwrap_or_default();
    let desc = regex::Regex::new(r#""description":"([^"\\]+)""#).unwrap().captures(&decoded)
        .or_else(|| regex::Regex::new(r#"<meta[^>]+name="description"[^>]+content="([^"]+)""#).unwrap().captures(&html))
        .map(|c| c.get(1).map(|m| m.as_str()).unwrap_or("").to_string())
        .unwrap_or_default();
    let servers = extract_servers(&decoded).iter().chain(extract_servers(&html).iter()).cloned().collect::<Vec<_>>();
    let mut uniq: Vec<String> = Vec::new();
    let servers: Vec<Value> = servers.into_iter().filter(|s| {
        let u = s.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if u.is_empty() || uniq.contains(&u) { return false; }
        uniq.push(u); true
    }).collect();
    Ok(json!({
        "url": url, "title": title, "poster": poster, "description": desc,
        "serverCount": servers.len(), "servers": servers,
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = { let a = pstr(&params, &["action"]); if a.is_empty() { pstr(&params, &["mode"]) } else { a } };
    let action = action.trim().to_lowercase();
    let action = if action.is_empty() { "home".to_string() } else { action };
    let q = { let v = pstr(&params, &["slug"]); if v.is_empty() { pstr(&params, &["url"]) } else { v } };
    let q = { if q.is_empty() { pstr(&params, &["query"]) } else { v_or_empty(q, &params) } };
    let page = pnum(&params, &["page"], 1);

    let result: Result<Value, String> = (|| async {
        if action == "home" {
            let data = scrape_home().await?;
            return Ok(json!({"status": true, "result": data}));
        }
        if action == "search" {
            if q.is_empty() { return Err("PARAM:Parameter 'query' wajib diisi untuk action=search".into()); }
            let data = scrape_search(&q, page).await?;
            return Ok(json!({"status": true, "result": data}));
        }
        if action == "detail" {
            if q.is_empty() { return Err("PARAM:Parameter 'slug' atau 'url' wajib diisi".into()); }
            let data = scrape_detail(&q).await?;
            return Ok(json!({"status": true, "result": data}));
        }
        Err("PARAM:Action tidak valid. Pilihan: home, search, detail".into())
    })().await;

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            if let Some(rest) = e.strip_prefix("PARAM:") { return bad(rest); }
            server_err(&e)
        }
    }
}

fn v_or_empty(prev: String, params: &serde_json::Map<String, Value>) -> String {
    if !prev.is_empty() { return prev; }
    pstr(params, &["q", "keyword"])
}

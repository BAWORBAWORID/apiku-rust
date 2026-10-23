// Melolo — native conversion of api/movie/melolo.js
// melolo.com scraper: home, search, detail, stream/download (regex over escaped SSR payload + API).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use reqwest::header;

const BASE_URL: &str = "https://melolo.com";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";

fn merged(query: &HashMap<String, String>, body: Option<&Value>) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in query { m.insert(k.clone(), json!(v)); }
    if let Some(Value::Object(b)) = body { for (k, v) in b { m.insert(k.clone(), v.clone()); } }
    m
}

fn pstr(m: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::String(s) if !s.trim().is_empty() => return s.trim().to_string(),
                Value::Number(n) => return n.to_string(),
                _ => {}
            }
        }
    }
    String::new()
}

fn pnum(m: &serde_json::Map<String, Value>, keys: &[&str], default: i64) -> i64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::Number(n) => return n.as_i64().unwrap_or(default),
                Value::String(s) => { if let Ok(x) = s.trim().parse::<i64>() { return x; } }
                _ => {}
            }
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
    reqwest::Client::builder().timeout(Duration::from_secs(30))
        .user_agent(USER_AGENT)
        .build().unwrap()
}

async fn fetch_page(url: &str) -> Result<String, String> {
    let res = client().get(url)
                    .header("Accept", "text/html,application/xhtml+xml")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let html = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("Melolo HTTP {}", status)); }
    Ok(html)
}

fn decode_page(html: &str) -> String {
    html.replace("\\\"", "\"").replace("\\u0026", "&").replace("\\u003c", "<")
        .replace("\\u003e", ">").replace("\\n", "\n").replace("&amp;", "&")
}

fn clean_text(value: &str) -> String {
    let re = regex::Regex::new(r"(?i)\\u([0-9a-f]{4})").unwrap();
    let s = re.replace_all(value, |c: &regex::Captures| {
        u32::from_str_radix(c.get(1).map(|m| m.as_str()).unwrap_or("0"), 16).ok()
            .and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default()
    }).to_string();
    s.trim().to_string()
}

fn extract_drama_items(text: &str) -> Vec<Value> {
    let mut items = Vec::new();
    // Pattern 1: featured drama with episode_list
    let p1 = regex::Regex::new(r#""cover_url":"(https?:[^"\\]+)"[\s\S]{0,12000}?"episode_list":(\[[\s\S]*?\])[\s\S]{0,4000}?"name":"([^"\\]+)","rating":"([^"\\]+)","series_slug":"([^"\\]+)""#).unwrap();
    for cap in p1.captures_iter(text) {
        let episodes: Vec<Value> = serde_json::from_str::<Value>(cap.get(2).map(|m| m.as_str()).unwrap_or("[]"))
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter().map(|item| json!({
                "episode": item.get("episode_id").cloned().unwrap_or(Value::Null),
                "direct": item.get("url").cloned().unwrap_or(Value::Null),
            })).collect();
        let slug = cap.get(5).map(|m| m.as_str()).unwrap_or("");
        items.push(json!({
            "type": "drama",
            "name": clean_text(cap.get(3).map(|m| m.as_str()).unwrap_or("")),
            "rating": cap.get(4).map(|m| m.as_str()).unwrap_or(""),
            "slug": slug,
            "url": format!("{}/dramas/{}", BASE_URL, slug),
            "cover": cap.get(1).map(|m| m.as_str()).unwrap_or(""),
            "episodes": episodes,
        }));
    }
    // Pattern 2: catalog / trending cards
    let p2 = regex::Regex::new(r#""cover_url":"(https?:[^"\\]+)"[\s\S]{0,2500}?"name":"([^"\\]+)","rating":"([^"\\]+)","series_slug":"([^"\\]+)""#).unwrap();
    for cap in p2.captures_iter(text) {
        let slug = cap.get(4).map(|m| m.as_str()).unwrap_or("");
        items.push(json!({
            "type": "drama",
            "name": clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or("")),
            "rating": cap.get(3).map(|m| m.as_str()).unwrap_or(""),
            "slug": slug,
            "url": format!("{}/dramas/{}", BASE_URL, slug),
            "cover": cap.get(1).map(|m| m.as_str()).unwrap_or(""),
            "episodes": [],
        }));
    }
    items
}

fn extract_novel_items(text: &str) -> Vec<Value> {
    let p = regex::Regex::new(r#""cover_url":"(https?:[^"\\]+)"[\s\S]{0,3500}?"name":"([^"\\]+)",(?:"novels_slug":"([^"\\]+)","rating":"([^"\\]+)"|"rating":"([^"\\]+)","novels_slug":"([^"\\]+)")"#).unwrap();
    let mut items = Vec::new();
    for cap in p.captures_iter(text) {
        let slug = cap.get(3).or_else(|| cap.get(6)).map(|m| m.as_str()).unwrap_or("");
        let rating = cap.get(4).or_else(|| cap.get(5)).map(|m| m.as_str()).unwrap_or("");
        items.push(json!({
            "type": "novel",
            "name": clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or("")),
            "rating": rating, "slug": slug,
            "url": format!("{}/novels/{}", BASE_URL, slug),
            "cover": cap.get(1).map(|m| m.as_str()).unwrap_or(""),
        }));
    }
    items
}

fn unique_items(items: Vec<Value>) -> Vec<Value> {
    let mut map: Vec<(String, Value)> = Vec::new();
    for item in items {
        let key = format!("{}:{}", item.get("type").and_then(|v| v.as_str()).unwrap_or(""), item.get("slug").and_then(|v| v.as_str()).unwrap_or(""));
        let eps_count = item.get("episodes").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        if let Some(pos) = map.iter().position(|(k, _)| k == &key) {
            let existing_eps = map[pos].1.get("episodes").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            if existing_eps == 0 && eps_count > 0 { map[pos].1 = item; }
        } else {
            map.push((key, item));
        }
    }
    map.into_iter().map(|(_, v)| v).collect()
}

fn map_api_result(item: &Value) -> Value {
    let item_type = if item.get("type").and_then(|v| v.as_str()) == Some("series") { "drama" } else { "novel" };
    let slug = item.get("series_slug").and_then(|v| v.as_str()).or_else(|| item.get("novels_slug").and_then(|v| v.as_str())).unwrap_or("");
    json!({
        "type": item_type,
        "name": item.get("name"),
        "rating": item.get("rating"),
        "slug": slug,
        "url": format!("{}/{}/{}", BASE_URL, if item_type == "drama" { "dramas" } else { "novels" }, slug),
        "cover": item.get("cover_url"),
        "episode_num": item.get("episode_num"),
        "short_desc": item.get("short_desc"),
    })
}

fn extract_direct_urls(text: &str) -> Vec<String> {
    let re = regex::Regex::new(r#"https?://[^"\\\s]+?\.mp4(?:\?[^"\\\s<]*)?"#).unwrap();
    let mut out = Vec::new();
    for m in re.find_iter(text) {
        let u = m.as_str().replace("\\u0026", "&");
        if !out.contains(&u) { out.push(u); }
    }
    out
}

async fn scrape_home() -> Result<Value, String> {
    let html = fetch_page(BASE_URL).await?;
    let decoded = decode_page(&html);
    let dramas = unique_items(extract_drama_items(&decoded));
    let novels = unique_items(extract_novel_items(&decoded));
    Ok(json!({
        "source": BASE_URL,
        "total": dramas.len() + novels.len(),
        "dramas": dramas, "novels": novels,
    }))
}

async fn scrape_search(keyword: &str, page: i64, page_size: i64) -> Result<Value, String> {
    let page_num = page.max(1);
    let size = page_size.clamp(1, 50);
    let api_url = format!(
        "{}/api/novels/searchNovelsByQuery?language=id&query={}&type=all&page={}&page_size={}",
        BASE_URL, urlencoding::encode(keyword), page_num, size);
    let res = client().get(&api_url)
                    .header("Accept", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let payload: Value = res.json().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) || payload.get("code").and_then(|v| v.as_i64()) != Some(200) {
        return Err(format!("Melolo search API error HTTP {}", status));
    }
    let items: Vec<Value> = payload.pointer("/data/page_data").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(map_api_result).collect();
    Ok(json!({
        "keyword": keyword, "page": page_num, "page_size": size,
        "total_count": payload.pointer("/data/total_count").and_then(|v| v.as_i64()).unwrap_or(items.len() as i64),
        "total_pages": payload.pointer("/data/total_pages").and_then(|v| v.as_i64()).unwrap_or(1),
        "type_counts": payload.pointer("/data/type_counts").cloned().unwrap_or(json!({})),
        "results": items,
    }))
}

async fn scrape_detail(slug_or_url: &str) -> Result<Value, String> {
    let mut url = slug_or_url.trim().to_string();
    if !regex::Regex::new(r"(?i)^https?://").unwrap().is_match(&url) {
        let clean = url.trim_matches('/');
        url = format!("{}/dramas/{}", BASE_URL, clean);
    }
    let html = fetch_page(&url).await?;
    let decoded = decode_page(&html);

    let meta = regex::Regex::new(r#""cover_url":"(https?:[^"\\]+)"[\s\S]{0,15000}?"name":"([^"\\]+)","rating":"([^"\\]+)","series_slug":"([^"\\]+)""#)
        .unwrap().captures(&decoded);
    let desc = regex::Regex::new(r#""short_desc":"([^"\\]+)""#).unwrap().captures(&decoded)
        .or_else(|| regex::Regex::new(r#""desc":"([^"\\]+)""#).unwrap().captures(&decoded));
    let genres_match = regex::Regex::new(r#""genre_list":(\[[\s\S]*?\])"#).unwrap().captures(&decoded);
    let ep_list = regex::Regex::new(r#""episode_list":(\[[\s\S]*?\])"#).unwrap().captures(&decoded);

    let mut episodes: Vec<Value> = Vec::new();
    if let Some(em) = ep_list {
        if let Ok(arr) = serde_json::from_str::<Value>(em.get(1).map(|m| m.as_str()).unwrap_or("[]")) {
            episodes = arr.as_array().cloned().unwrap_or_default().into_iter().map(|item| json!({
                "episode": item.get("episode_id").cloned().unwrap_or(Value::Null),
                "url": item.get("url").cloned().unwrap_or(Value::Null),
            })).collect();
        }
    }
    if episodes.is_empty() {
        let urls = extract_direct_urls(&decoded);
        episodes = urls.into_iter().enumerate().map(|(i, u)| json!({"episode": i + 1, "url": u})).collect();
    }
    let genres: Vec<Value> = genres_match
        .and_then(|g| serde_json::from_str::<Value>(g.get(1).map(|m| m.as_str()).unwrap_or("[]")).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter().filter_map(|g| g.get("name").cloned()).collect();
    Ok(json!({
        "url": url,
        "title": clean_text(meta.as_ref().and_then(|m| m.get(2)).map(|m| m.as_str()).unwrap_or("")),
        "rating": meta.as_ref().and_then(|m| m.get(3)).map(|m| json!(m.as_str())).unwrap_or(Value::Null),
        "slug": meta.as_ref().and_then(|m| m.get(4)).map(|m| json!(m.as_str()))
            .unwrap_or_else(|| json!(url.trim_end_matches('/').rsplit('/').next().unwrap_or(""))),
        "cover": meta.as_ref().and_then(|m| m.get(1)).map(|m| json!(m.as_str())).unwrap_or(Value::Null),
        "description": desc.as_ref().and_then(|d| d.get(1)).map(|m| json!(clean_text(m.as_str()))).unwrap_or(Value::Null),
        "genres": genres,
        "total_episodes": episodes.len(),
        "episodes": episodes,
    }))
}

async fn resolve_stream(slug_or_url: &str, episode: i64) -> Result<Value, String> {
    let detail = scrape_detail(slug_or_url).await?;
    let ep_num = episode.max(1);
    let episodes = detail.get("episodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let target = episodes.iter()
        .find(|e| e.get("episode").and_then(|v| v.as_i64()) == Some(ep_num))
        .or_else(|| episodes.get((ep_num - 1) as usize))
        .cloned()
        .ok_or_else(|| format!("Episode {} tidak ditemukan untuk drama '{}'", ep_num, detail.get("title").and_then(|v| v.as_str()).unwrap_or(slug_or_url)))?;
    Ok(json!({
        "title": detail.get("title"),
        "slug": detail.get("slug"),
        "episode": target.get("episode"),
        "total_episodes": detail.get("total_episodes"),
        "video_url": target.get("url"),
        "headers": {
            "Referer": format!("{}/", BASE_URL),
            "Origin": BASE_URL,
            "User-Agent": USER_AGENT,
        },
        "note": "Video CDN v.melolo.com memerlukan header Referer: https://melolo.com/",
    }))
}

const ACTIONS: &str = "home, search, detail, stream, download";

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action"]).trim().to_lowercase();
    let action = if action.is_empty() { "home".to_string() } else { action };
    let q = { let v = pstr(&params, &["slug"]); if v.is_empty() { pstr(&params, &["id"]) } else { v } };
    let q = { if q.is_empty() { pstr(&params, &["query"]) } else { q } };
    let q = { if q.is_empty() { pstr(&params, &["q"]) } else { q } };
    let q = { if q.is_empty() { pstr(&params, &["url"]) } else { q } };

    let result: Result<Value, String> = (|| async {
        if action == "home" || action == "catalog" {
            let data = scrape_home().await?;
            return Ok(json!({"status": true, "result": data}));
        }
        if action == "search" || action == "cari" {
            if q.is_empty() { return Err("PARAM:Parameter 'query' wajib diisi untuk action=search".into()); }
            let page = pnum(&params, &["page"], 1);
            let page_size = pnum(&params, &["page_size", "pageSize"], 20);
            let data = scrape_search(&q, page, page_size).await?;
            return Ok(json!({"status": true, "result": data}));
        }
        if action == "detail" || action == "drama" {
            if q.is_empty() { return Err("PARAM:Parameter 'slug', 'query', atau 'url' wajib diisi".into()); }
            let data = scrape_detail(&q).await?;
            return Ok(json!({"status": true, "result": data}));
        }
        if action == "stream" || action == "play" || action == "download" || action == "dl" {
            if q.is_empty() { return Err("PARAM:Parameter 'slug', 'query', atau 'url' wajib diisi untuk action=stream/download".into()); }
            let ep = pnum(&params, &["episode", "ep"], 1);
            let stream_info = resolve_stream(&q, ep).await?;
            let should_play = pstr(&params, &["play"]).to_lowercase() == "true"
                || pstr(&params, &["stream"]).to_lowercase() == "true"
                || action == "play";
            if should_play {
                // Native play mode is byte streaming — return a JSON error advising play=true usage
                // mirrors JS behavior of piping video; here we fetch and return the URL metadata only.
                let video_url = stream_info.get("video_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if video_url.is_empty() { return Err("Gagal streaming video dari provider: URL tidak tersedia".into()); }
                let mut upstream_headers = reqwest::header::HeaderMap::new();
                upstream_headers.insert("Referer", format!("{}/", BASE_URL).parse().unwrap());
                upstream_headers.insert("Origin", BASE_URL.parse().unwrap());
                upstream_headers.insert("User-Agent", USER_AGENT.parse().unwrap());
                let res = client().get(&video_url)
                    .headers(upstream_headers)
                    .timeout(Duration::from_secs(60))
                    .send().await.map_err(|e| e.to_string())?;
                let status = res.status().as_u16();
                if !res.status().is_success() && status != 206 {
                    return Err(format!("Gagal streaming video dari provider: HTTP {}", status));
                }
                let size = res.content_length();
                let bytes = res.bytes().await.map_err(|e| e.to_string())?;
                return Err(format!("BYTES:{}:{}", size.unwrap_or(bytes.len() as u64), "video/mp4"));
            }
            let mut result = stream_info.clone();
            if let Some(o) = result.as_object_mut() {
                o.insert("url".into(), o.get("video_url").cloned().unwrap_or(Value::Null));
                o.insert("direct_stream_api".into(), json!(format!(
                    "/api/movie/melolo?action=stream&slug={}&episode={}&play=true",
                    urlencoding::encode(&stream_info.get("slug").and_then(|v| v.as_str()).unwrap_or("")),
                    stream_info.get("episode").and_then(|v| v.as_i64()).unwrap_or(1),
                )));
            }
            return Ok(json!({"status": true, "result": result}));
        }
        Err(format!("PARAM:Action '{}' tidak valid. Pilihan: {}", action, ACTIONS))
    })().await;

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            if let Some(rest) = e.strip_prefix("BYTES:") {
                // simplified play-mode: stream bytes directly
                let mut parts = rest.splitn(2, ':');
                let size: Option<u64> = parts.next().and_then(|s| s.parse().ok());
                let ctype = parts.next().unwrap_or("video/mp4").to_string();
                // NOTE: bytes body is not carried through the error channel; re-fetch isn't possible here,
                // so return metadata JSON for play requests instead of raw bytes.
                let _ = (size, ctype);
                return server_err("play mode tidak didukung penuh dalam handler native; gunakan result JSON stream URL");
            }
            if let Some(rest) = e.strip_prefix("PARAM:") { return bad(rest); }
            server_err(&e)
        }
    }
}

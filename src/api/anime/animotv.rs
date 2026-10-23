// AnimoTVSlash — native conversion of api/anime/animotv.js
// WordPress REST API (wp-json/wp/v2) + HTML episode listing. Pure HTTP.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://www.animotvslash.org";
const API: &str = "https://www.animotvslash.org/wp-json/wp/v2";
const UA: &str = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

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

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap()
}

async fn fetch_text(url: &str, html_accept: bool) -> Result<(u16, String), String> {
    let accept = if html_accept { "text/html,application/xhtml+xml" } else { "application/json, text/plain, */*" };
    let res = client().get(url).header("User-Agent", UA).header("Accept", accept)
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok((status, text))
}

async fn fetch_json(url: &str) -> Result<(u16, Value), String> {
    let (status, text) = fetch_text(url, false).await?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("invalid JSON: {}", e))?;
    Ok((status, v))
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#039;", "'").replace("&#8217;", "'")
        .replace("&#8211;", "-").replace("&nbsp;", " ").replace("&#39;", "'")
}

fn parse_class_list(list: &[Value]) -> (Vec<String>, Vec<String>, Vec<String>, Value, Value) {
    let mut genres = Vec::new();
    let mut studios = Vec::new();
    let mut directors = Vec::new();
    let mut season = Value::Null;
    let mut country = Value::Null;
    for cls in list {
        if let Some(c) = cls.as_str() {
            if let Some(g) = c.strip_prefix("genres-") { genres.push(g.replace('-', " ")); }
            else if let Some(s) = c.strip_prefix("studio-") { studios.push(s.replace('-', " ")); }
            else if let Some(d) = c.strip_prefix("director-") { directors.push(d.replace('-', " ")); }
            else if let Some(se) = c.strip_prefix("season-") { season = json!(se); }
            else if let Some(co) = c.strip_prefix("country-") { country = json!(co); }
        }
    }
    (genres, studios, directors, season, country)
}

fn normalize_anime(a: &Value) -> Value {
    let class_list = a.get("class_list").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let (genres, studios, directors, season, country) = parse_class_list(&class_list);
    let description = a.pointer("/content/rendered").and_then(|v| v.as_str())
        .map(|s| strip_tags(s).chars().take(300).collect::<String>())
        .unwrap_or_default();
    json!({
        "id": a.get("id").cloned().unwrap_or(Value::Null),
        "title": a.pointer("/title/rendered").cloned().unwrap_or(Value::Null),
        "slug": a.get("slug").cloned().unwrap_or(Value::Null),
        "link": a.get("link").cloned().unwrap_or(Value::Null),
        "date": a.get("date").cloned().unwrap_or(Value::Null),
        "modified": a.get("modified").cloned().unwrap_or(Value::Null),
        "featuredMedia": a.get("featured_media").cloned().unwrap_or(Value::Null),
        "description": description,
        "genres": genres,
        "studios": studios,
        "directors": directors,
        "season": season,
        "country": country,
    })
}

async fn search_anime(q: &str) -> Result<Value, String> {
    let url = format!("{}/search?search={}&per_page=20", API, urlencoding::encode(q));
    let (status, data) = fetch_json(&url).await?;
    if !(200..300).contains(&status) { return Err(format!("Gagal melakukan pencarian anime (HTTP {})", status)); }
    let arr = data.as_array().cloned().unwrap_or_default();
    let items: Vec<Value> = arr.iter()
        .filter(|i| i.get("subtype").and_then(|s| s.as_str()) == Some("anime"))
        .map(|i| {
            let u = i.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let slug = u.split("/anime/").nth(1).unwrap_or("").trim_end_matches('/').to_string();
            json!({"id": i.get("id").cloned().unwrap_or(Value::Null), "title": i.get("title").cloned().unwrap_or(Value::Null), "url": u, "slug": slug})
        })
        .collect();
    Ok(json!({"query": q, "total": items.len(), "items": items}))
}

async fn get_latest(count: &str) -> Result<Value, String> {
    let n: i64 = count.trim().parse::<i64>().unwrap_or(10).clamp(1, 100);
    let url = format!("{}/anime?per_page={}&orderby=date&order=desc", API, n);
    let (status, data) = fetch_json(&url).await?;
    if !(200..300).contains(&status) { return Err(format!("Gagal mengambil anime terbaru (HTTP {})", status)); }
    let items: Vec<Value> = data.as_array().cloned().unwrap_or_default().iter().map(normalize_anime).collect();
    Ok(json!({"total": items.len(), "items": items}))
}

async fn get_detail(id: &str) -> Result<Value, String> {
    let url = format!("{}/anime/{}", API, urlencoding::encode(id));
    let (status, a) = fetch_json(&url).await?;
    if !(200..300).contains(&status) { return Err("Anime tidak ditemukan".to_string()); }
    if a.is_null() { return Err("Data anime kosong".to_string()); }
    let mut out = normalize_anime(&a);
    if let Value::Object(ref mut map) = out {
        let content = a.pointer("/content/rendered").and_then(|v| v.as_str()).map(strip_tags).unwrap_or_default();
        map.insert("content".into(), json!(content));
    }
    Ok(out)
}

/// Collect (href, inner-text) for every anchor in the HTML.
fn extract_anchors(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("<a") {
        let start = i + p;
        let Some(gt) = lower[start..].find('>') else { break };
        let tag = &html[start..start + gt];
        let href = tag.split("href=\"").nth(1).and_then(|r| r.split('"').next()).unwrap_or("").to_string();
        let inner_start = start + gt + 1;
        let Some(close) = lower[inner_start..].find("</a>") else { break };
        let inner = html[inner_start..inner_start + close].to_string();
        out.push((href, inner));
        i = inner_start + close + 4;
    }
    out
}

async fn get_episodes(slug: &str) -> Result<Value, String> {
    let clean_slug = if slug.contains("/anime/") {
        slug.rsplit("/anime/").next().unwrap_or(slug).trim().trim_end_matches('/').to_string()
    } else {
        slug.trim().trim_end_matches('/').to_string()
    };
    let url = format!("{}/anime/{}/", BASE, clean_slug);
    let (status, html) = fetch_text(&url, true).await?;
    if !(200..300).contains(&status) { return Err(format!("Gagal mengambil daftar episode (HTTP {})", status)); }
    let mut seen = std::collections::HashSet::new();
    let mut episodes = Vec::new();
    for (href, inner) in extract_anchors(&html) {
        if href.contains("-episode-") && href.contains(&clean_slug) && seen.insert(href.clone()) {
            let full = if href.starts_with("http") { href.clone() } else { format!("{}{}", BASE, href) };
            episodes.push(json!({
                "title": unescape(&strip_tags(&inner)),
                "url": full,
            }));
        }
    }
    Ok(json!({"slug": clean_slug, "total": episodes.len(), "episodes": episodes}))
}

fn find_url_token(html: &str, needle: &str) -> Option<String> {
    html.split(|c: char| c == '"' || c == '\'' || c == '<' || c == '>' || c.is_whitespace())
        .find(|t| t.starts_with("http") && t.contains(needle))
        .map(|t| t.trim_end_matches(['"', '\\']).to_string())
}

async fn get_stream(ep_url: &str) -> Result<Value, String> {
    let (status, html) = fetch_text(ep_url, true).await?;
    if !(200..300).contains(&status) { return Err(format!("Gagal mengambil halaman streaming (HTTP {})", status)); }
    let lower = html.to_lowercase();

    let mut stream_url: Option<(String, String)> = None;

    // first iframe src
    if let Some(p) = lower.find("<iframe") {
        if let Some(h) = lower[p..].find("src=\"") {
            let s = p + h + 5;
            if let Some(e) = html[s..].find('"') {
                stream_url = Some((html[s..s + e].to_string(), "iframe".into()));
            }
        }
    }
    // video > source src
    if stream_url.is_none() {
        if let Some(p) = lower.find("<video") {
            if let Some(sp) = lower[p..].find("<source") {
                if let Some(h) = lower[p + sp..].find("src=\"") {
                    let s = p + sp + h + 5;
                    if let Some(e) = html[s..].find('"') {
                        stream_url = Some((html[s..s + e].to_string(), "video".into()));
                    }
                }
            }
        }
    }
    // m3u8 / mp4 URL scan
    if stream_url.is_none() {
        if let Some(u) = find_url_token(&html, ".m3u8") { stream_url = Some((u, "m3u8".into())); }
    }
    if stream_url.is_none() {
        if let Some(u) = find_url_token(&html, ".mp4") { stream_url = Some((u, "mp4".into())); }
    }

    match stream_url {
        Some((u, t)) => Ok(json!({"url": ep_url, "streamUrl": u, "streamType": t})),
        None => Err("Stream URL tidak ditemukan di HTML. Player dimuat dinamis (AIOVG / Cloudflare).".to_string()),
    }
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));

    let mut action = pstr(&params, &["action", "type"]).to_lowercase();
    if action.is_empty() {
        if !pstr(&params, &["query", "q"]).is_empty() { action = "search".into(); }
        else if !pstr(&params, &["url"]).is_empty() { action = "stream".into(); }
        else if !pstr(&params, &["slug"]).is_empty() { action = "episodes".into(); }
        else if !pstr(&params, &["id"]).is_empty() { action = "detail".into(); }
        else { action = "latest".into(); }
    }

    let result: Result<Value, String> = match action.as_str() {
        "search" => {
            let q = pstr(&params, &["query", "q"]);
            if q.is_empty() { return bad("Parameter 'query' wajib diisi untuk action search"); }
            search_anime(&q).await
        }
        "latest" => {
            let count = pstr(&params, &["count", "limit"]);
            get_latest(&count).await
        }
        "detail" => {
            let id = pstr(&params, &["id"]);
            if id.is_empty() { return bad("Parameter 'id' wajib diisi untuk action detail"); }
            get_detail(&id).await
        }
        "episodes" => {
            let slug = pstr(&params, &["slug", "id"]);
            if slug.is_empty() { return bad("Parameter 'slug' wajib diisi untuk action episodes"); }
            get_episodes(&slug).await
        }
        "stream" => {
            let ep_url = pstr(&params, &["url"]);
            if ep_url.is_empty() { return bad("Parameter 'url' wajib diisi untuk action stream"); }
            get_stream(&ep_url).await
        }
        _ => return bad("Action tidak dikenal. Gunakan: latest, search, detail, episodes, atau stream"),
    };

    match result {
        Ok(v) => Json(json!({"status": true, "action": action, "result": v})).into_response(),
        Err(e) => server_err(&e),
    }
}

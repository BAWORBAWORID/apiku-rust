// AnimeAV1 — native conversion of api/anime/animeav1.js
// SvelteKit data extraction: parses `data: [...]...form: null` payload via bracket scanner.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://animeav1.com";
const CDN_URL: &str = "https://cdn.animeav1.com";

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

fn pnum(m: &serde_json::Map<String, Value>, keys: &[&str]) -> i64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::Number(n) => return n.as_i64().unwrap_or(0),
                Value::String(s) => { if let Ok(x) = s.trim().parse::<i64>() { return x; } }
                _ => {}
            }
        }
    }
    0
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(25))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .build().unwrap()
}

async fn fetch_page(path: &str) -> Result<String, String> {
    let url = if path.starts_with("http") { path.to_string() } else { format!("{}{}", BASE_URL, path) };
    let res = client().get(&url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "es-ES,es;q=0.9,en;q=0.8")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {}: Gagal memuat {}", status, url)); }
    Ok(body)
}

/// Extract the `data: [...] ... form: null` SvelteKit payload and parse the JS array
/// into JSON using a lightweight recursive descent parser (subset: arrays, objects,
/// strings, numbers, true/false/null, JS object keys are quoted in Svelte payloads).
fn extract_svelte_data(html: &str) -> Result<Value, String> {
    // find "data:" followed by "[" ... then eventually "form: null"
    let start = html.find("data:").ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let lb = html[start..].find('[').ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let arr_start = start + lb;

    // Bracket scan with string awareness to find the matching close bracket.
    let bytes = html.as_bytes();
    let mut depth = 0i32;
    let mut i = arr_start;
    let mut in_str = false;
    let mut quote = b'"';
    let mut escape = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            if escape { escape = false; }
            else if c == b'\\' { escape = true; }
            else if c == quote { in_str = false; }
        } else {
            match c {
                b'"' | b'\'' => { in_str = true; quote = c; }
                b'[' | b'{' => depth += 1,
                b']' | b'}' => {
                    depth -= 1;
                    if depth == 0 { break; }
                }
                _ => {}
            }
        }
        i += 1;
    }
    if depth != 0 { return Err("Data payload tidak ditemukan di halaman sumber".into()); }
    let raw = &html[arr_start..=i];

    // The payload may contain JS object shorthand or unquoted keys — try strict JSON first,
    // then a tolerant path: convert JS to JSON (quote unquoted keys, single->double quotes
    // is risky; SvelteKit emits JSON-safe payloads, so strict parse usually works).
    serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("Gagal parsing payload SvelteKit: {}", e))
}

fn pick_data(parsed: &Value) -> Option<Value> {
    // JS version: iterate from the end, pick element whose .data is a non-empty object.
    let arr = parsed.as_array()?;
    for item in arr.iter().rev() {
        if let Some(d) = item.get("data") {
            if let Some(obj) = d.as_object() {
                if !obj.is_empty() { return Some(d.clone()); }
            }
        }
    }
    None
}

fn normalize_media(item: &Value) -> Value {
    if item.is_null() { return Value::Null; }
    let slug = item.get("slug").and_then(|v| v.as_str())
        .or_else(|| item.pointer("/media/slug").and_then(|v| v.as_str())).unwrap_or("");
    let id = item.get("id").and_then(|v| v.as_i64())
        .or_else(|| item.pointer("/media/id").and_then(|v| v.as_i64()));
    let trailer = item.get("trailer").and_then(|v| v.as_str()).unwrap_or("");
    let mut out = item.clone();
    if let Some(obj) = out.as_object_mut() {
        if !slug.is_empty() { obj.insert("url".into(), json!(format!("{}/media/{}", BASE_URL, slug))); }
        if let Some(id) = id {
            obj.insert("coverUrl".into(), json!(format!("{}/covers/{}.jpg", CDN_URL, id)));
            obj.insert("backdropUrl".into(), json!(format!("{}/backdrops/{}.jpg", CDN_URL, id)));
        }
        if !trailer.is_empty() {
            obj.insert("trailerUrl".into(), json!(format!("https://www.youtube.com/watch?v={}", trailer)));
        }
    }
    out
}

fn normalize_episode_item(ep: &Value, anime_slug: &str, anime_id: Option<i64>) -> Value {
    if ep.is_null() { return Value::Null; }
    let target_slug = if !anime_slug.is_empty() { anime_slug.to_string() }
        else { ep.pointer("/media/slug").and_then(|v| v.as_str()).unwrap_or("").to_string() };
    let num = ep.get("number").cloned().unwrap_or(Value::Null);
    let media_id = anime_id.or_else(|| ep.get("mediaId").and_then(|v| v.as_i64()))
        .or_else(|| ep.pointer("/media/id").and_then(|v| v.as_i64()));
    let mut out = ep.clone();
    if let Some(obj) = out.as_object_mut() {
        if !target_slug.is_empty() {
            obj.insert("slug".into(), json!(format!("{}/{}", target_slug, num)));
            obj.insert("animeSlug".into(), json!(target_slug));
            obj.insert("url".into(), json!(format!("{}/media/{}/{}", BASE_URL, target_slug, num)));
        }
        if let Some(mid) = media_id {
            obj.insert("thumbnailUrl".into(), json!(format!("{}/thumbnails/{}.jpg", CDN_URL, mid)));
        }
    }
    out
}

fn clean_slug_and_episode(input_slug: &str, input_ep: &str) -> (String, String) {
    let mut slug = input_slug.trim().to_string();
    let mut ep = input_ep.trim().to_string();
    slug = regex::Regex::new(r"^https?://[^/]+").unwrap().replace(&slug, "").to_string();
    slug = regex::Regex::new(r"^/media/").unwrap().replace(&slug, "").to_string();
    slug = slug.trim_matches('/').to_string();
    let parts: Vec<String> = slug.split('/').map(|s| s.to_string()).collect();
    if parts.len() >= 2 {
        slug = parts[0].clone();
        if ep.is_empty() { ep = parts[1].clone(); }
    }
    (slug, ep)
}

async fn home() -> Result<Value, String> {
    let html = fetch_page("/").await?;
    let parsed = extract_svelte_data(&html)?;
    let data = pick_data(&parsed).ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let empty = Vec::new();
    let featured: Vec<Value> = data.get("featured").and_then(|v| v.as_array()).unwrap_or(&empty).iter()
        .map(normalize_media).collect();
    let latest_episodes: Vec<Value> = data.get("latestEpisodes").and_then(|v| v.as_array()).unwrap_or(&empty).iter()
        .map(|ep| normalize_episode_item(ep, "", None)).collect();
    let latest_media: Vec<Value> = data.get("latestMedia").and_then(|v| v.as_array()).unwrap_or(&empty).iter()
        .map(normalize_media).collect();
    Ok(json!({
        "featured": featured,
        "latestEpisodes": latest_episodes,
        "latestMedia": latest_media,
        "latestComments": data.get("latestComments").cloned().unwrap_or(json!([])),
        "latestTopComments": data.get("latestTopComments").cloned().unwrap_or(json!([])),
    }))
}

async fn search(query: &str) -> Result<Value, String> {
    if query.is_empty() { return Err("Query pencarian tidak boleh kosong".into()); }
    let html = fetch_page(&format!("/catalogo?search={}", urlencoding::encode(query))).await?;
    let parsed = extract_svelte_data(&html)?;
    let data = pick_data(&parsed).ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let empty = Vec::new();
    let results: Vec<Value> = data.get("results").and_then(|v| v.as_array()).unwrap_or(&empty).iter()
        .map(normalize_media).collect();
    Ok(json!({
        "query": query,
        "total": data.get("total").and_then(|v| v.as_i64()).unwrap_or(results.len() as i64),
        "pagination": data.get("pagination").cloned().unwrap_or(Value::Null),
        "results": results,
    }))
}

async fn catalog(page: i64, order: &str) -> Result<Value, String> {
    let html = fetch_page(&format!("/catalogo?page={}&order={}", page, order)).await?;
    let parsed = extract_svelte_data(&html)?;
    let data = pick_data(&parsed).ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let empty = Vec::new();
    let results: Vec<Value> = data.get("results").and_then(|v| v.as_array()).unwrap_or(&empty).iter()
        .map(normalize_media).collect();
    Ok(json!({
        "filters": data.get("filters").cloned().unwrap_or(Value::Null),
        "pagination": data.get("pagination").cloned().unwrap_or(Value::Null),
        "results": results,
        "categoriesIdsMap": data.get("categoriesIdsMap").cloned().unwrap_or(Value::Null),
        "genresIdsMap": data.get("genresIdsMap").cloned().unwrap_or(Value::Null),
    }))
}

async fn schedule() -> Result<Value, String> {
    let html = fetch_page("/horario").await?;
    let parsed = extract_svelte_data(&html)?;
    let data = pick_data(&parsed).ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let empty = Vec::new();
    let schedule: Vec<Value> = data.get("media").and_then(|v| v.as_array()).unwrap_or(&empty).iter().map(|item| {
        let mut norm = normalize_media(item);
        if let Some(le) = item.get("latestEpisode") {
            let slug = norm.get("slug").and_then(|v| v.as_str()).unwrap_or("").to_string();
            norm["latestEpisode"] = normalize_episode_item(le, &slug, None);
        }
        norm
    }).collect();
    Ok(json!({ "schedule": schedule }))
}

async fn detail(raw_slug: &str) -> Result<Value, String> {
    let (slug, _) = clean_slug_and_episode(raw_slug, "");
    if slug.is_empty() { return Err("Slug anime tidak boleh kosong".into()); }
    let html = fetch_page(&format!("/media/{}", slug)).await?;
    let parsed = extract_svelte_data(&html)?;
    let data = pick_data(&parsed).ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let media = match data.get("media") {
        Some(m) if !m.is_null() => {
            let id = m.get("id").and_then(|v| v.as_i64());
            let mut norm = normalize_media(m);
            if let Some(eps) = norm.get_mut("episodes").and_then(|v| v.as_array_mut()) {
                let list: Vec<Value> = eps.iter().map(|ep| normalize_episode_item(ep, &slug, id)).collect();
                norm["episodes"] = json!(list);
            }
            norm
        }
        _ => Value::Null,
    };
    Ok(json!({ "media": media }))
}

async fn episode(raw_slug: &str, raw_ep: &str) -> Result<Value, String> {
    let (slug, ep) = clean_slug_and_episode(raw_slug, raw_ep);
    if slug.is_empty() || ep.is_empty() { return Err("Slug dan nomor episode harus diisi".into()); }
    let html = fetch_page(&format!("/media/{}/{}", slug, ep)).await?;
    let parsed = extract_svelte_data(&html)?;
    let data = pick_data(&parsed).ok_or("Data payload tidak ditemukan di halaman sumber")?;
    let media = data.get("media").filter(|m| !m.is_null()).map(normalize_media).unwrap_or(Value::Null);
    let media_id = media.get("id").and_then(|v| v.as_i64());
    let episode_v = data.get("episode").filter(|e| !e.is_null())
        .map(|e| normalize_episode_item(e, &slug, media_id)).unwrap_or(Value::Null);
    Ok(json!({
        "slug": format!("{}/{}", slug, ep),
        "animeSlug": slug,
        "episodeNumber": ep.parse::<i64>().unwrap_or(0),
        "url": format!("{}/media/{}/{}", BASE_URL, slug, ep),
        "media": media,
        "episode": episode_v,
        "embeds": data.get("embeds").cloned().unwrap_or(json!({})),
        "downloads": data.get("downloads").cloned().unwrap_or(json!({})),
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action", "type"]).trim().to_lowercase();
    let action = if action.is_empty() { "home".to_string() } else { action };

    let result: Result<Value, String> = match action.as_str() {
        "home" => home().await,
        "search" => {
            let mut q = pstr(&params, &["query"]);
            if q.is_empty() { q = pstr(&params, &["q"]); }
            if q.is_empty() { q = pstr(&params, &["search"]); }
            let v2 = q;
            if v2.is_empty() { return bad("Parameter 'query' wajib diisi untuk action=search"); }
            search(&v2).await
        }
        "catalog" => {
            let page = { let p = pnum(&params, &["page"]); if p <= 0 { 1 } else { p } };
            let order = { let o = pstr(&params, &["order"]); if o.is_empty() { "latest".to_string() } else { o } };
            catalog(page, &order).await
        }
        "schedule" => schedule().await,
        "detail" => {
            let slug = { let v = pstr(&params, &["slug"]); if v.is_empty() { pstr(&params, &["query"]) } else { v } };
            let slug = { if slug.is_empty() { pstr(&params, &["url"]) } else { slug } };
            if slug.is_empty() { return bad("Parameter 'slug' atau 'url' wajib diisi untuk action=detail"); }
            detail(&slug).await
        }
        "episode" => {
            let slug = { let v = pstr(&params, &["slug"]); if v.is_empty() { pstr(&params, &["query"]) } else { v } };
            let slug = { if slug.is_empty() { pstr(&params, &["url"]) } else { slug } };
            if slug.is_empty() { return bad("Parameter 'slug' wajib diisi untuk action=episode"); }
            let ep = pstr(&params, &["episode", "ep"]);
            episode(&slug, &ep).await
        }
        _ => return bad("Action tidak valid. Gunakan salah satu dari: home, search, catalog, schedule, detail, episode"),
    };

    match result {
        Ok(v) => Json(json!({"status": true, "creator": "Always Codex", "action": action, "result": v})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "creator": "Always Codex", "action": action, "message": e,
        }))).into_response(),
    }
}

// DrakorID Scraper — native conversion of api/anime/drakorid.js
// HTML scraping via regex on fetched pages + POST to myapi/episode_detail.php.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://drakorid.co";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

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

fn pint(m: &serde_json::Map<String, Value>, keys: &[&str], dflt: i64) -> i64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            if let Some(n) = v.as_i64() { return n; }
            if let Some(s) = v.as_str() { if let Ok(n) = s.trim().parse::<i64>() { return n; } }
        }
    }
    dflt
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"success": false, "error": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap()
}

async fn get_html(url: &str) -> Result<(u16, String), String> {
    let res = client().get(url)
                    .header("Accept", "text/html,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9")
        .header("Referer", BASE)
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok((status, body))
}

async fn post_episode(token: &str, m_id: &str, ep: i64, link_slug: &str) -> Option<Value> {
    let form = format!(
        "token={}&id={}&episode={}",
        urlencoding::encode(token), m_id, ep
    );
    let res = client()
        .post(format!("{}/myapi/episode_detail.php", BASE))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Referer", format!("{}/nonton/{}/", BASE, link_slug))
        .body(form)
        .send()
        .await
        .ok()?;
    let text = res.text().await.ok()?;
    let data: Value = serde_json::from_str(&text).ok()?;
    if data.get("status").and_then(|s| s.as_i64()) != Some(1) { return None; }
    Some(json!({
        "watch_lite": format!("{}/watch-lite/{}/{}", BASE, link_slug, ep),
        "watch_max": format!("{}/watch-max/{}/{}", BASE, link_slug, ep),
        "watch_fast": format!("{}/watch-fast/{}/{}", BASE, link_slug, ep),
        "download_lite": format!("{}/download-lite/{}/{}", BASE, link_slug, ep),
        "download_fast": format!("{}/download-fast/{}/{}", BASE, link_slug, ep),
        "sid": data.get("sid").cloned().unwrap_or(Value::Null),
        "streaming_id": data.get("streaming").cloned().unwrap_or(Value::Null),
        "thumbnail": data.get("img").cloned().unwrap_or(Value::Null),
        "is_cdn": data.get("is_any_cdn").and_then(|v| v.as_bool()).unwrap_or(false),
    }))
}

fn match_all<'a>(text: &'a str, re: &regex::Regex) -> Vec<regex::Captures<'a>> {
    re.captures_iter(text).collect()
}

fn parse_list(html: &str) -> Vec<Value> {
    let re = regex::Regex::new(r#"(?is)<a\b[^>]*href="https://drakorid\.co/nonton/([^"/]+)/?"[^>]*>([\s\S]*?)</a>"#).unwrap();
    let title_re = regex::Regex::new(r#"title="([^"]+)""#).unwrap();
    let alt_re = regex::Regex::new(r#"<img[^>]*\balt="([^"]+)""#).unwrap();
    let img_re = regex::Regex::new(r#"<img[^>]*\bsrc="([^"]+)""#).unwrap();
    let tag_re = regex::Regex::new(r#"<[^>]+>"#).unwrap();
    let mut map: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for cap in match_all(html, &re) {
        let slug = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        let inner = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
        let whole = cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
        let t1 = title_re.captures(&whole).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        let t2 = alt_re.captures(&inner).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        let t3 = { let s = tag_re.replace_all(&inner, "").trim().to_string(); if s.is_empty() { None } else { Some(s) } };
        let poster = img_re.captures(&inner).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        let title = t1.or(t2).or(t3).unwrap_or_default();
        if let Some(prev) = map.get_mut(&slug) {
            if prev.get("title").and_then(|v| v.as_str()).unwrap_or("").is_empty() && !title.is_empty() {
                prev["title"] = json!(title);
            }
            if prev.get("poster").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                if let Some(p) = poster { prev["poster"] = json!(p); }
            }
        } else {
            map.insert(slug.clone(), json!({
                "title": title, "slug": slug.clone(),
                "url": format!("{}/nonton/{}/", BASE, slug),
                "poster": poster,
            }));
            order.push(slug);
        }
    }
    order.iter().filter_map(|s| map.remove(s))
        .filter(|i| !i.get("title").and_then(|v| v.as_str()).unwrap_or("").is_empty())
        .collect()
}

fn get_match(html: &str, re: &regex::Regex) -> Option<String> {
    re.captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string())
}

fn parse_detail_page(html: &str) -> Value {
    let title = get_match(html, &regex::Regex::new(r#"(?i)property="og:title"\s+content="([^"]+)""#).unwrap());
    let poster = get_match(html, &regex::Regex::new(r#"(?i)property="og:image"\s+content="([^"]+)""#).unwrap());
    let synopsis = get_match(html, &regex::Regex::new(r#"(?i)name="twitter:card"\s+content="([^"]+)""#).unwrap());
    let token = get_match(html, &regex::Regex::new(r#"var token\s*=\s*"([^"]+)""#).unwrap());
    let link = get_match(html, &regex::Regex::new(r#"var link\s*=\s*"([^"]+)""#).unwrap());
    let m_id = regex::Regex::new(r"var mId\s*=\s*(\d+)").unwrap()
        .captures(html).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok());
    let m_tipe = regex::Regex::new(r"var mTipe\s*=\s*(\d+)").unwrap()
        .captures(html).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok());

    let ep_re = regex::Regex::new(r#"data-episode="(\d+)"\s+data-ep-label="([^"]+)""#).unwrap();
    let mut seen = std::collections::HashSet::new();
    let mut episodes: Vec<Value> = Vec::new();
    for cap in match_all(html, &ep_re) {
        let num: i64 = cap.get(1).map(|m| m.as_str().parse().unwrap_or(0)).unwrap_or(0);
        if seen.insert(num) {
            episodes.push(json!({
                "episode": num,
                "label": cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default(),
            }));
        }
    }
    episodes.sort_by_key(|e| e.get("episode").and_then(|v| v.as_i64()).unwrap_or(0));

    let g_re = regex::Regex::new(r#"href="https://drakorid\.co/kategori/[^"]+">([^<]+)</a>"#).unwrap();
    let mut genres: Vec<String> = Vec::new();
    for cap in match_all(html, &g_re) {
        let g = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        if !g.is_empty() && !genres.contains(&g) { genres.push(g); }
    }
    json!({
        "title": title, "poster": poster, "synopsis": synopsis, "genres": genres,
        "token": token, "link": link, "mId": m_id, "mTipe": m_tipe, "episodes": episodes,
    })
}

async fn get_watch(slug: &str) -> Result<Value, String> {
    let detail_url = format!("{}/nonton/{}/", BASE, slug);
    let (status, html) = get_html(&detail_url).await?;
    if status != 200 { return Err(format!("HTTP {}", status)); }
    let detail = parse_detail_page(&html);
    let token = detail.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let m_id = detail.get("mId").and_then(|v| v.as_i64()).unwrap_or(0).to_string();
    let link_slug = detail.get("link").and_then(|v| v.as_str()).unwrap_or(slug).to_string();

    let mut out_eps = Vec::new();
    for ep in detail.get("episodes").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let num = ep.get("episode").and_then(|v| v.as_i64()).unwrap_or(0);
        let embed = if !token.is_empty() && !m_id.is_empty() {
            post_episode(&token, &m_id, num, &link_slug).await
        } else { None };
        out_eps.push(json!({ "episode": num, "label": ep.get("label").cloned().unwrap_or(Value::Null), "embed": embed }));
    }
    Ok(json!({
        "success": true,
        "url": detail_url,
        "title": detail.get("title").cloned().unwrap_or(Value::Null),
        "poster": detail.get("poster").cloned().unwrap_or(Value::Null),
        "synopsis": detail.get("synopsis").cloned().unwrap_or(Value::Null),
        "genres": detail.get("genres").cloned().unwrap_or(json!([])),
        "total_episodes": out_eps.len(),
        "episodes": out_eps,
    }))
}

async fn get_list(page: i64) -> Result<Value, String> {
    let (status, html) = get_html(&format!("{}/list/{}", BASE, page)).await?;
    if status != 200 { return Err(format!("HTTP {}", status)); }
    let items = parse_list(&html);
    let has_next = html.contains(&format!("/list/{}", page + 1));
    Ok(json!({
        "success": true, "page": page,
        "next_page": if has_next { json!(page + 1) } else { Value::Null },
        "total": items.len(), "items": items,
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action"]);
    if action.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false,
            "error": "Parameter 'action' wajib diisi",
            "valid_actions": ["ongoing", "list", "trending", "search", "genre", "watch"],
        }))).into_response();
    }

    let page = pint(&params, &["page"], 1);
    let result: Result<Value, String> = match action.as_str() {
        "ongoing" => {
            let (status, html) = match get_html(&format!("{}/drama-ongoing/", BASE)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            if status != 200 { Err(format!("HTTP {}", status)) }
            else { let items = parse_list(&html); Ok(json!({"success": true, "total": items.len(), "items": items})) }
        }
        "list" => get_list(page).await,
        "trending" => {
            let (status, html) = match get_html(&format!("{}/trending.html", BASE)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            if status != 200 { Err(format!("HTTP {}", status)) }
            else { let items = parse_list(&html); Ok(json!({"success": true, "total": items.len(), "items": items})) }
        }
        "search" => {
            let q = pstr(&params, &["q", "query"]);
            if q.is_empty() { return bad("Keyword required"); }
            let (status, html) = match get_html(&format!("{}/cari.html?q={}", BASE, urlencoding::encode(&q))).await { Ok(v) => v, Err(e) => return server_err(&e) };
            if status != 200 { Err(format!("HTTP {}", status)) }
            else { let items = parse_list(&html); Ok(json!({"success": true, "query": q, "total": items.len(), "items": items})) }
        }
        "genre" => {
            let genre = pstr(&params, &["genre"]);
            if genre.is_empty() { return bad("Genre required"); }
            let (status, html) = match get_html(&format!("{}/kategori/{}/{}", BASE, genre, page)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            if status != 200 { Err(format!("HTTP {}", status)) }
            else { let items = parse_list(&html); Ok(json!({"success": true, "genre": genre, "page": page, "total": items.len(), "items": items})) }
        }
        "watch" => {
            let slug = pstr(&params, &["slug"]);
            if slug.is_empty() { return bad("Slug required"); }
            get_watch(&slug).await
        }
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false,
            "error": "Parameter 'action' wajib diisi",
            "valid_actions": ["ongoing", "list", "trending", "search", "genre", "watch"],
        }))).into_response(),
    };

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => server_err(&e),
    }
}

// Animexin — native conversion of api/anime/animexin.js
// HTML scraping animexin.dev with regex parsing + 3-digit-id file cache under data/.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://animexin.dev";
const CACHE_FILE: &str = "data/.animexin_cache.json";

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

fn ppage(m: &serde_json::Map<String, Value>, keys: &[&str]) -> i64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::Number(n) => return n.as_i64().unwrap_or(1),
                Value::String(s) => { if let Ok(x) = s.trim().parse::<i64>() { return x; } }
                _ => {}
            }
        }
    }
    1
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build().unwrap()
}

async fn fetch_html(url: &str, allow_404_empty: bool) -> Result<String, String> {
    let res = client().get(url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "id,en-US;q=0.9,en;q=0.8")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status == 404 && allow_404_empty { return Ok(String::new()); }
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {} [{}]", status, url)); }
    Ok(body)
}

fn clean_text(s: &str) -> String {
    let mut out = s.to_string();
    let dec = regex::Regex::new(r"&#(\d+);").unwrap();
    out = dec.replace_all(&out, |c: &regex::Captures| {
        c.get(1).and_then(|m| m.as_str().parse::<u32>().ok())
            .and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default()
    }).to_string();
    let hex = regex::Regex::new(r"(?i)&#x([0-9a-f]+);").unwrap();
    out = hex.replace_all(&out, |c: &regex::Captures| {
        u32::from_str_radix(c.get(1).map(|m| m.as_str()).unwrap_or("0"), 16).ok()
            .and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default()
    }).to_string();
    for (a, b) in [
        ("&amp;", "&"), ("&quot;", "\""), ("&apos;", "'"), ("&#8211;", "-"), ("&#8212;", "-"),
        ("&#8220;", "\""), ("&#8221;", "\""), ("&#8216;", "'"), ("&#8217;", "'"),
        ("&#8230;", "..."), ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "),
    ] { out = out.replace(a, b); }
    let tags = regex::Regex::new(r"<[^>]+>").unwrap();
    out = tags.replace_all(&out, "").to_string();
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_valid_animexin_url(url_str: &str) -> bool {
    url::Url::parse(url_str).map(|u| {
        let h = u.host_str().unwrap_or("");
        h == "animexin.dev" || h.ends_with(".animexin.dev")
    }).unwrap_or(false)
}

// ── cache (mirrors JS loadCache/saveCache) ──
fn load_cache() -> Vec<Value> {
    std::fs::read_to_string(CACHE_FILE).ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

fn save_cache(new_items: &[Value]) {
    let mut map: Vec<(String, Value)> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    for item in load_cache().into_iter().chain(new_items.iter().cloned()) {
        let key = item.get("url").and_then(|v| v.as_str()).map(|s| s.to_string())
            .or_else(|| item.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .or_else(|| item.get("id").and_then(|v| v.as_i64()).map(|n| n.to_string()));
        if let Some(k) = key {
            if let Some(pos) = keys.iter().position(|x| x == &k) { map[pos].1 = item.clone(); }
            else { map.push((k.clone(), item.clone())); keys.push(k); }
        }
    }
    let merged_v: Vec<Value> = if map.len() > 500 { map.split_off(map.len() - 500).into_iter().map(|(_, v)| v).collect() }
        else { map.into_iter().map(|(_, v)| v).collect() };
    if let Some(dir) = std::path::Path::new(CACHE_FILE).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(CACHE_FILE, serde_json::to_string_pretty(&merged_v).unwrap_or_default());
}

fn parse_items(html_block: &str) -> Vec<Value> {
    if html_block.is_empty() { return Vec::new(); }
    let item_re = regex::Regex::new(r#"(?s)<div class="bsx"[^>]*>[\s\S]*?</a>\s*</div>"#).unwrap();
    let results_arc = std::sync::Arc::new(std::sync::Mutex::new(load_cache()));
    let mut existing_ids: std::collections::HashSet<i64> = results_arc.lock().unwrap().iter()
        .filter_map(|c| c.get("id").and_then(|v| v.as_i64())).collect();
    let mut results = Vec::new();
    for item_html in item_re.find_iter(html_block) {
        let block = item_html.as_str();
        let title_re = regex::Regex::new(r#"title="([^"]+)""#).unwrap();
        let title_h2 = regex::Regex::new(r#"<h2 itemprop="headline">([^<]+)</h2>"#).unwrap();
        let title = title_re.captures(block).and_then(|c| c.get(1))
            .or_else(|| title_h2.captures(block).and_then(|c| c.get(1)))
            .map(|m| clean_text(m.as_str())).unwrap_or_else(|| "Judul tidak ditemukan".into());
        let img_re = regex::Regex::new(r#"<img[^>]+src="([^"]+)""#).unwrap();
        let thumbnail = img_re.captures(block).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let url_re = regex::Regex::new(r#"<a[^>]+href="([^"]+)""#).unwrap();
        let url = url_re.captures(block).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();

        let ep_re = regex::Regex::new(r#"<span class="epx">([^<]+)</span>"#).unwrap();
        let ep_re2 = regex::Regex::new(r#"<div class="epx">([^<]+)</div>"#).unwrap();
        let ep_re3 = regex::Regex::new(r#"<div class="eggepisode">([^<]+)</div>"#).unwrap();
        let ep_re4 = regex::Regex::new(r"(?i)Ep (\d+)").unwrap();
        let mut episode = ep_re.captures(block).or_else(|| ep_re2.captures(block))
            .or_else(|| ep_re3.captures(block)).or_else(|| ep_re4.captures(block))
            .and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_default();
        if episode.is_empty() {
            let e1 = regex::Regex::new(r"(?i)Episode\s+(\d+(?:\s+END)?)").unwrap();
            let e2 = regex::Regex::new(r"(?i)Ep\s*(\d+)").unwrap();
            episode = e1.captures(&title).or_else(|| e2.captures(&title))
                .and_then(|c| c.get(1)).map(|m| format!("Episode {}", m.as_str()))
                .unwrap_or_else(|| "Series / TBA".into());
        }
        let type_re = regex::Regex::new(r#"class="(?:eggtype|typez)\s+([^"]+)""#).unwrap();
        let type_re2 = regex::Regex::new(r#"(?i)<div class="(?:eggtype|typez)[^>]*>([^<]+)</div>"#).unwrap();
        let tipe = type_re.captures(block).or_else(|| type_re2.captures(block))
            .and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_else(|| "TBA".into());
        let sub_re = regex::Regex::new(r#"class="sb\s+([^"]+)""#).unwrap();
        let sub_re2 = regex::Regex::new(r#"(?i)<span class="sb[^>]*>([^<]+)</span>"#).unwrap();
        let sub_info = sub_re.captures(block).or_else(|| sub_re2.captures(block))
            .and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_else(|| "RAW".into());

        // stable id: reuse cached, else random 100-999 unique
        let cache = results_arc.lock().unwrap().clone();
        let id: i64 = cache.iter().find(|c| c.get("url").and_then(|v| v.as_str()) == Some(url.as_str()))
            .and_then(|c| c.get("id").and_then(|v| v.as_i64()).or_else(|| c.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse().ok())))
            .unwrap_or_else(|| loop {
                let n = 100 + (rand::random::<f64>() * 900.0) as i64;
                if existing_ids.insert(n) { return n; }
            });

        results.push(json!({ "id": id, "judul": title, "episode": episode, "thumbnail": thumbnail, "url": url, "type": tipe, "subInfo": sub_info }));
    }
    if !results.is_empty() { save_cache(&results); }
    results
}

async fn fetch_list_data(category: &str, page: i64) -> Result<Value, String> {
    let page_num = if page < 1 { 1 } else { page };
    let url = if page_num > 1 { format!("{}/page/{}/", BASE_URL, page_num) } else { format!("{}/", BASE_URL) };
    let html = fetch_html(&url, page_num > 1).await?;
    if html.is_empty() {
        return Ok(json!({"category": category, "page": page_num, "hasNextPage": false, "total": 0, "data": []}));
    }
    let popular_idx = html.find("<h2>Popular Today</h2>");
    let latest_idx = html.find("<h3>Latest Release</h3>");
    let recommend_idx = html.find("<h3>Recommendation</h3>");
    let blog_idx = html.find("<h3>Latest Blog</h3>");

    let html_block: String = if category == "popular" && popular_idx.is_some() && latest_idx.is_some() {
        html[popular_idx.unwrap()..latest_idx.unwrap()].to_string()
    } else if category == "recommend" && recommend_idx.is_some() && blog_idx.is_some() {
        html[recommend_idx.unwrap()..blog_idx.unwrap()].to_string()
    } else if latest_idx.is_some() && recommend_idx.is_some() {
        html[latest_idx.unwrap()..recommend_idx.unwrap()].to_string()
    } else { html.clone() };

    let data = parse_items(&html_block);
    let next_re = regex::Regex::new(r#"class="r"[^>]*>Next"#).unwrap();
    let has_next = html.contains(&format!("/page/{}/", page_num + 1)) || next_re.is_match(&html);
    Ok(json!({"category": category, "page": page_num, "hasNextPage": has_next, "total": data.len(), "data": data}))
}

async fn fetch_search_data(keyword: &str, page: i64) -> Result<Value, String> {
    if keyword.trim().is_empty() { return Err("Parameter keyword tidak boleh kosong".into()); }
    let clean_kw = keyword.trim();
    let page_num = if page < 1 { 1 } else { page };
    let search_url = if page_num > 1 {
        format!("{}/page/{}/?s={}", BASE_URL, page_num, urlencoding::encode(clean_kw))
    } else {
        format!("{}/?s={}", BASE_URL, urlencoding::encode(clean_kw))
    };
    let html = fetch_html(&search_url, page_num > 1).await?;
    if html.is_empty() {
        return Ok(json!({"keyword": clean_kw, "page": page_num, "hasNextPage": false, "total": 0, "data": []}));
    }
    let data = parse_items(&html);
    let next_re = regex::Regex::new(r#"class="r"[^>]*>Next"#).unwrap();
    let has_next = html.contains(&format!("page/{}/?s=", page_num + 1)) || next_re.is_match(&html);
    Ok(json!({"keyword": clean_kw, "page": page_num, "hasNextPage": has_next, "total": data.len(), "data": data}))
}

async fn fetch_schedule_data() -> Result<Value, String> {
    let html = fetch_html(&format!("{}/", BASE_URL), false).await?;
    let block_re = regex::Regex::new(
        r#"(?si)<div class="listSchh"[^>]*>[\s\S]*?<h2>([^<]+)</h2>[\s\S]*?<div class="subSchh">([\s\S]*?)</div>\s*</div>"#).unwrap();
    let link_re = regex::Regex::new(r#"<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
    let mut schedule = serde_json::Map::new();
    for cap in block_re.captures_iter(&html) {
        let day = clean_text(cap.get(1).map(|m| m.as_str()).unwrap_or("")).to_lowercase();
        let links: Vec<Value> = link_re.captures_iter(cap.get(2).map(|m| m.as_str()).unwrap_or("")).map(|m| json!({
            "title": clean_text(m.get(2).map(|x| x.as_str()).unwrap_or("")),
            "url": m.get(1).map(|x| x.as_str().to_string()).unwrap_or_default(),
        })).collect();
        schedule.insert(day, json!(links));
    }
    Ok(json!({"totalDays": schedule.len(), "data": schedule}))
}

async fn fetch_genres_data() -> Result<Value, String> {
    let html = fetch_html(&format!("{}/", BASE_URL), false).await?;
    let genre_re = regex::Regex::new(
        r#"(?si)<a[^>]+href="https://animexin\.dev/genres/([^"/]+)/"[^>]*>([^<]+)</a>"#).unwrap();
    let mut genre_map: Vec<(String, Value)> = Vec::new();
    for cap in genre_re.captures_iter(&html) {
        let slug = cap.get(1).map(|m| m.as_str().trim().to_lowercase()).unwrap_or_default();
        let name = clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if !slug.is_empty() && !name.is_empty() && !genre_map.iter().any(|(s, _)| s == &slug) {
            genre_map.push((slug.clone(), json!({"slug": slug, "name": name, "url": format!("{}/genres/{}/", BASE_URL, slug)})));
        }
    }
    let data: Vec<Value> = genre_map.into_iter().map(|(_, v)| v).collect();
    Ok(json!({"total": data.len(), "data": data}))
}

async fn fetch_genre_anime_data(genre_slug: &str, page: i64) -> Result<Value, String> {
    if genre_slug.trim().is_empty() { return Err("Slug genre tidak boleh kosong".into()); }
    let clean_slug = genre_slug.trim().to_lowercase();
    let page_num = if page < 1 { 1 } else { page };
    let url = if page_num > 1 {
        format!("{}/genres/{}/page/{}/", BASE_URL, clean_slug, page_num)
    } else {
        format!("{}/genres/{}/", BASE_URL, clean_slug)
    };
    let html = fetch_html(&url, page_num > 1).await?;
    if html.is_empty() {
        return Ok(json!({"genre": clean_slug, "page": page_num, "hasNextPage": false, "total": 0, "data": []}));
    }
    let data = parse_items(&html);
    let next_re = regex::Regex::new(r#"class="r"[^>]*>Next"#).unwrap();
    let has_next = html.contains(&format!("/genres/{}/page/{}/", clean_slug, page_num + 1)) || next_re.is_match(&html);
    Ok(json!({"genre": clean_slug, "page": page_num, "hasNextPage": has_next, "total": data.len(), "data": data}))
}

async fn fetch_detail_data(query: &str) -> Result<Value, String> {
    let clean_query = query.trim();
    if clean_query.is_empty() { return Err("Berikan ID, URL, atau Judul Anime!".into()); }
    let mut target_url = String::new();
    let mut target_judul = String::new();
    let mut resolved_id: Option<i64> = None;

    if clean_query.starts_with("http://") || clean_query.starts_with("https://") {
        if !is_valid_animexin_url(clean_query) { return Err("URL tidak valid. Hanya animexin.dev".into()); }
        target_url = clean_query.to_string();
    } else if clean_query.chars().all(|c| c.is_ascii_digit()) && !clean_query.is_empty() {
        let id: i64 = clean_query.parse().unwrap_or(0);
        resolved_id = Some(id);
        let cache = load_cache();
        match cache.iter().find(|item| item.get("id").and_then(|v| v.as_i64()) == Some(id)
            || item.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse::<i64>().ok()) == Some(id)) {
            Some(sel) => {
                target_url = sel.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                target_judul = sel.get("judul").and_then(|v| v.as_str()).unwrap_or("").to_string();
            }
            None => return Err(format!("ID [{}] tidak ditemukan di cache", id)),
        }
    } else {
        let search_res = fetch_search_data(clean_query, 1).await?;
        let arr = search_res.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if arr.is_empty() { return Err(format!("Anime \"{}\" tidak ditemukan", clean_query)); }
        let first = &arr[0];
        target_url = first.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        target_judul = first.get("judul").and_then(|v| v.as_str()).unwrap_or("").to_string();
        resolved_id = first.get("id").and_then(|v| v.as_i64());
    }

    let mut html = fetch_html(&target_url, false).await?;

    if !html.contains("class=\"eplister\"") && (html.contains("<option value=") || html.contains("<iframe")) {
        let series_re = regex::Regex::new(
            r#"(?si)<span itemprop="itemListElement"[^>]*>\s*<a itemprop="item" href="([^"]+)"><span itemprop="name">[^<]*</span></a>\s*<meta itemprop="position" content="2">"#).unwrap();
        let nv_re = regex::Regex::new(r#"(?si)<div class="nvsc">[\s\S]*?<a href="([^"]+)""#).unwrap();
        let series_link = series_re.captures(&html).or_else(|| nv_re.captures(&html))
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        if let Some(series_url) = series_link {
            if is_valid_animexin_url(&series_url) {
                if let Ok(series_html) = fetch_html(&series_url, false).await {
                    if series_html.contains("class=\"eplister\"") { html = series_html; target_url = series_url; }
                }
            }
        }
    }

    let title_re = regex::Regex::new(r#"<h1 class="entry-title"[^>]*>([^<]+)</h1>"#).unwrap();
    let title = title_re.captures(&html).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or(target_judul);
    let grab = |re: &str| -> String {
        regex::Regex::new(re).ok()
            .and_then(|r| r.captures(&html)).and_then(|c| c.get(1))
            .map(|m| clean_text(m.as_str())).unwrap_or_default()
    };
    let alter_judul = grab(r#"(?i)<span class="alter">([^<]+)</span>"#);
    let rating = grab(r#"<meta itemprop="ratingValue" content="([^"]+)""#)
        .or_non_empty_or(grab(r#"(?i)<div class="num"[^>]*>([^<]+)</div>"#)).unwrap_or("N/A".into());
    let status = grab(r#"(?i)<b>Status:</b>\s*([^<]+)</span>"#).non_empty().unwrap_or("N/A".into());
    let tipe = grab(r#"(?i)<b>Type:</b>\s*([^<]+)</span>"#).non_empty().unwrap_or("TBA".into());
    let total_episodes_meta = grab(r#"(?i)<b>Episodes:</b>\s*([^<]+)</span>"#).non_empty().unwrap_or("TBA".into());
    let released = grab(r#"(?i)<b>Released:</b>\s*([^<]+)</span>"#).non_empty().unwrap_or("N/A".into());
    let duration = grab(r#"(?i)<b>Duration:</b>\s*([^<]+)</span>"#).non_empty().unwrap_or("N/A".into());
    let studio = grab(r#"(?i)<b>Studio:</b>\s*<a[^>]*>([^<]+)</a>"#).non_empty()
        .or_non_empty_or(grab(r#"(?i)<b>Studio:</b>\s*([^<]+)</span>"#)).unwrap_or("N/A".into());
    let banner = grab(r#"(?si)<div class="bigcover">[\s\S]*?<img[^>]+src="([^"]+)""#);
    let thumbnail = grab(r#"(?si)<div class="thumb"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)""#);
    let synopsis = grab(r#"(?si)<div class="entry-content"[^>]*>([\s\S]*?)</div>"#).non_empty().unwrap_or("Sinopsis tidak tersedia.".into());

    let mut genres: Vec<String> = Vec::new();
    if let Some(gc) = regex::Regex::new(r#"<div class="genxed">([\s\S]*?)</div>"#).unwrap().captures(&html) {
        for cap in regex::Regex::new(r#"<a[^>]*>([^<]+)</a>"#).unwrap().captures_iter(&gc[1]) {
            let g = clean_text(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
            if !genres.contains(&g) { genres.push(g); }
        }
    }

    let mut subtitles = "Tidak ada info subtitle".to_string();
    if let Some(dc) = regex::Regex::new(r#"(?i)<meta name="description" content="([^"]+)""#).unwrap().captures(&html) {
        let desc_text = dc.get(1).map(|m| m.as_str()).unwrap_or("");
        if let Some(idx) = desc_text.to_lowercase().find("subtitle") {
            let mut sub_str = desc_text[idx + 8..].trim().to_string();
            if let Some(end_idx) = sub_str.to_lowercase().find(&title.to_lowercase()) {
                if end_idx > 3 { sub_str = sub_str[..end_idx].trim().to_string(); }
            }
            if sub_str.ends_with('-') || sub_str.ends_with(',') { sub_str = sub_str[..sub_str.len() - 1].trim().to_string(); }
            if !sub_str.is_empty() {
                subtitles = sub_str.split(',').map(clean_text).collect::<Vec<_>>().join(", ");
            }
        }
    }

    let mut episodes: Vec<Value> = Vec::new();
    let eps_re = regex::Regex::new(r#"(?si)<div class="eplister"[\s\S]*?<ul>([\s\S]*?)</ul>"#).unwrap();
    if let Some(eps_match) = eps_re.captures(&html) {
        let li_re = regex::Regex::new(r#"(?si)<li[^>]*>[\s\S]*?</li>"#).unwrap();
        for (idx, li_c) in li_re.find_iter(&eps_match[1]).enumerate() {
            let li = li_c.as_str();
            let url_m = regex::Regex::new(r#"(?i)<a[^>]+href="([^"]+)""#).unwrap().captures(li);
            let ep_url = match url_m.and_then(|c| c.get(1)) { Some(m) => m.as_str().to_string(), None => continue };
            let t_re = regex::Regex::new(r#"(?i)<div class="epl-title">([^<]+)</div>"#).unwrap();
            let t_re2 = regex::Regex::new(r#"(?i)<a[^>]*>([^<]+)</a>"#).unwrap();
            let ep_title = t_re.captures(li).or_else(|| t_re2.captures(li))
                .and_then(|c| c.get(1)).map(|m| clean_text(m.as_str()))
                .unwrap_or_else(|| format!("Episode {}", idx + 1));
            if !ep_url.contains("animexin.dev") || ep_title.to_lowercase().contains("kofi") || ep_title.to_lowercase().contains("memberpage") { continue; }
            let num = regex::Regex::new(r#"(?i)<div class="epl-num">([^<]+)</div>"#).unwrap()
                .captures(li).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str()))
                .unwrap_or_else(|| format!("{}", idx + 1));
            let sub = regex::Regex::new(r#"(?si)<div class="epl-sub">([\s\S]*?)</div>"#).unwrap()
                .captures(li).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_else(|| "Sub".into());
            let date = regex::Regex::new(r#"(?i)<div class="epl-date">([^<]+)</div>"#).unwrap()
                .captures(li).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_else(|| "N/A".into());
            let index = regex::Regex::new(r#"(?i)data-index="(\d+)""#).unwrap()
                .captures(li).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(idx as i64);
            episodes.push(json!({"index": index, "epNum": num, "title": ep_title, "sub": sub, "date": date, "url": ep_url}));
        }
    } else if html.contains("<option value=") || html.contains("<iframe") {
        episodes.push(json!({"index": 0, "epNum": "1", "title": title, "sub": "Sub", "date": released, "url": target_url}));
    }

    Ok(json!({
        "id": resolved_id,
        "data": {
            "judul": title, "alterJudul": alter_judul, "rating": rating, "status": status,
            "type": tipe, "totalEpisodes": total_episodes_meta, "rilis": released,
            "durasi": duration, "studio": studio, "genres": genres, "subtitle": subtitles,
            "thumbnail": thumbnail, "banner": banner, "sinopsis": synopsis, "url": target_url,
            "totalEpisodesFound": episodes.len(), "episodes": episodes,
        }
    }))
}

trait NonEmptyExt { fn non_empty(self) -> Option<String>; fn or_non_empty_or(self, other: String) -> Option<String>; }
impl NonEmptyExt for Option<String> {
    fn non_empty(self) -> Option<String> { self.filter(|s| !s.is_empty()) }
    fn or_non_empty_or(self, other: String) -> Option<String> { self.or_else(|| other.non_empty()) }
}

impl NonEmptyExt for String {
    fn non_empty(self) -> Option<String> { if self.is_empty() { None } else { Some(self) } }
    fn or_non_empty_or(self, other: String) -> Option<String> { self.non_empty().or_else(|| other.non_empty()) }
}

async fn fetch_episode_data(query: &str) -> Result<Value, String> {
    let clean_query = query.trim();
    if clean_query.is_empty() { return Err("Berikan URL atau judul episode!".into()); }
    let target_url: String;
    if clean_query.starts_with("http://") || clean_query.starts_with("https://") {
        if !is_valid_animexin_url(clean_query) { return Err("URL tidak valid. Hanya animexin.dev".into()); }
        target_url = clean_query.to_string();
    } else {
        let search_res = fetch_search_data(clean_query, 1).await?;
        let arr = search_res.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if arr.is_empty() { return Err(format!("Episode/Anime \"{}\" tidak ditemukan", clean_query)); }
        target_url = arr[0].get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    }

    let html = fetch_html(&target_url, false).await?;
    let title_re = regex::Regex::new(r#"<h1 class="entry-title"[^>]*>([^<]+)</h1>"#).unwrap();
    let title = title_re.captures(&html).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_default();

    let nav_block = regex::Regex::new(r#"(?si)<div class="naveps[^"]*"[^>]*>([\s\S]*?)</div>"#).unwrap()
        .captures(&html).map(|c| c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default());
    let mut navigation = json!({"prev": Value::Null, "next": Value::Null, "series": Value::Null});
    if let Some(nb) = nav_block {
        let find = |re: &str| -> Option<String> {
            regex::Regex::new(re).ok()?.captures(&nb).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
        };
        let prev = find(r#"(?i)<a[^>]+rel="prev"[^>]+href="([^"]+)""#).or_else(|| find(r#"(?i)<a[^>]+href="([^"]+)"[^>]*rel="prev""#));
        let next = find(r#"(?i)<a[^>]+rel="next"[^>]+href="([^"]+)""#).or_else(|| find(r#"(?i)<a[^>]+href="([^"]+)"[^>]*rel="next""#));
        let series = find(r#"(?si)<div class="nvsc">[\s\S]*?<a[^>]+href="([^"]+)""#);
        navigation = json!({"prev": prev, "next": next, "series": series});
    }

    let server_re = regex::Regex::new(r#"(?si)<option value="([^"]+)"[^>]*>([^<]+)</option>"#).unwrap();
    let mut streams: Vec<Value> = Vec::new();
    for cap in server_re.captures_iter(&html) {
        let b64 = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let name = clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        let lname = name.to_lowercase();
        if b64.is_empty() || lname.contains("select video server") || lname.contains("comment") { continue; }
        if let Ok(decoded) = base64_decode_utf8(b64) {
            if let Some(m) = regex::Regex::new(r#"(?i)src=["']?([^"'\s>]+)["']?"#).unwrap().captures(&decoded) {
                let mut u = m.get(1).map(|x| x.as_str()).unwrap_or("").to_string();
                if u.starts_with("//") { u = format!("https:{}", u); }
                streams.push(json!({"name": name, "url": u}));
            }
        }
    }
    if streams.is_empty() {
        if let Some(m) = regex::Regex::new(r#"(?i)<iframe[^>]+src=["']?([^"'\s>]+)["']?"#).unwrap().captures(&html) {
            let mut u = m.get(1).map(|x| x.as_str()).unwrap_or("").to_string();
            if u.starts_with("//") { u = format!("https:{}", u); }
            streams.push(json!({"name": "Direct Stream", "url": u}));
        }
    }

    let mut downloads: Vec<Value> = Vec::new();
    let dl_block_re = regex::Regex::new(
        r#"(?si)<div class="soraddlx[^"]*">([\s\S]*?)</div>\s*(?=<div class="soraddlx|</div>\s*</div>)"#).unwrap();
    for b in dl_block_re.captures_iter(&html) {
        let inner = b.get(1).map(|m| m.as_str()).unwrap_or("");
        let cat = regex::Regex::new(r#"(?i)<div class="sorattlx"><h3>([^<]+)</h3>"#).unwrap()
            .captures(inner).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_else(|| "Download".into());
        let row_re = regex::Regex::new(r#"(?si)<div class="soraurlx"[^>]*>([\s\S]*?)</div>"#).unwrap();
        for r in row_re.captures_iter(inner) {
            let quality = regex::Regex::new(r#"(?i)<strong>([^<]+)</strong>"#).unwrap()
                .captures(&r[1]).and_then(|c| c.get(1)).map(|m| clean_text(m.as_str())).unwrap_or_else(|| "Default".into());
            let link_re = regex::Regex::new(r#"(?si)<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
            let links: Vec<Value> = link_re.captures_iter(&r[1]).map(|m| {
                let mut u = m.get(1).map(|x| x.as_str()).unwrap_or("").to_string();
                if u.starts_with("//") { u = format!("https:{}", u); }
                json!({"server": clean_text(m.get(2).map(|x| x.as_str()).unwrap_or("")), "url": u})
            }).collect();
            if !links.is_empty() { downloads.push(json!({"category": cat, "quality": quality, "links": links})); }
        }
    }

    Ok(json!({
        "data": {
            "title": title, "url": target_url, "navigation": navigation,
            "totalStreams": streams.len(), "streams": streams,
            "totalDownloads": downloads.len(), "downloads": downloads,
        }
    }))
}

fn base64_decode_utf8(s: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action"]).to_lowercase();
    if action.is_empty() {
        return bad("Parameter 'action' wajib: home, popular, recommend, schedule, genres, genre, search, detail, episode");
    }
    let page = ppage(&params, &["page"]);
    let genre = pstr(&params, &["genre"]);
    let mut q = pstr(&params, &["query"]);
    if q.is_empty() { q = pstr(&params, &["url"]); }

    let result: Result<Value, String> = match action.as_str() {
        "home" => fetch_list_data("home", page).await,
        "popular" => fetch_list_data("popular", 1).await,
        "recommend" => fetch_list_data("recommend", 1).await,
        "schedule" => fetch_schedule_data().await,
        "genres" => fetch_genres_data().await,
        "genre" => {
            if genre.is_empty() { return bad("Parameter 'genre' wajib untuk action=genre"); }
            fetch_genre_anime_data(&genre, page).await
        }
        "search" => {
            if q.is_empty() { return bad("Parameter 'query' wajib untuk action=search"); }
            fetch_search_data(&q, page).await
        }
        "detail" => {
            if q.is_empty() { return bad("Parameter 'query' atau 'url' wajib untuk action=detail"); }
            fetch_detail_data(&q).await
        }
        "episode" => {
            if q.is_empty() { return bad("Parameter 'query' atau 'url' wajib untuk action=episode"); }
            fetch_episode_data(&q).await
        }
        _ => return bad(&format!("Action '{}' tidak valid", action)),
    };

    match result {
        Ok(v) => {
            let mut out = json!({"status": true});
            if let Value::Object(map) = v { for (k, val) in map { out[k] = val; } }
            Json(out).into_response()
        }
        Err(e) => server_err(&e),
    }
}

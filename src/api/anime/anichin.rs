// Anichin Donghua — native conversion of api/anime/anichin.js
// HTML scraping anichin.cafe with regex parsing (lists, detail, episode, schedule, genres).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://anichin.cafe";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
    reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent(UA).build().unwrap()
}

async fn fetch_html(url: &str) -> Result<String, String> {
    let res = client().get(url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", format!("{}/", BASE_URL))
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if status != 200 { return Err(format!("Failed {}: HTTP {}", url, status)); }
    Ok(body)
}

fn clean_text(text: &str) -> String {
    let tag_re = regex::Regex::new(r"<[^>]+>").unwrap();
    let s = tag_re.replace_all(text, "");
    s.replace("&nbsp;", " ").replace("&#8217;", "'").replace("&#8211;", "-")
        .replace("&#038;", "&").replace("&amp;", "&")
        .split_whitespace().collect::<Vec<_>>().join(" ")
}

fn slugify(url: &str, prefix: &str) -> String {
    let mut s = url.replace(BASE_URL, "");
    if !prefix.is_empty() {
        s = regex::Regex::new(prefix).map(|re| re.replace(&s, "").to_string()).unwrap_or(s);
    }
    s.trim_matches('/').to_string()
}

fn decode_base64_utf8(b64: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    String::from_utf8(bytes).ok()
}

fn parse_series_list(html: &str) -> Vec<Value> {
    let art_re = regex::Regex::new(r#"(?is)<article[^>]*class="[^"]*bs[^"]*"[^>]*>([\s\S]*?)</article>"#).unwrap();
    let link_re = regex::Regex::new(r#"(?i)<a\s+href="([^"]+)"[^>]*title="([^"]*)""#).unwrap();
    let link2_re = regex::Regex::new(r#"(?i)<a\s+href="([^"]+)""#).unwrap();
    let title_re = regex::Regex::new(r#"(?is)<div class="tt">([\s\S]*?)</div>"#).unwrap();
    let title2_re = regex::Regex::new(r#"(?is)<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)</h2>"#).unwrap();
    let img_re = regex::Regex::new(r#"(?i)<img[^>]*src="([^"]+)""#).unwrap();
    let img2_re = regex::Regex::new(r#"(?i)<img[^>]*data-src="([^"]+)""#).unwrap();
    let status_re = regex::Regex::new(r#"(?is)<span\s+class="status[^"]*">([\s\S]*?)</span>"#).unwrap();
    let typez_re = regex::Regex::new(r#"(?is)<span\s+class="typez[^"]*">([\s\S]*?)</span>"#).unwrap();
    let ep_re = regex::Regex::new(r#"(?is)<span\s+class="epx">([\s\S]*?)</span>"#).unwrap();

    let mut series = Vec::new();
    for cap in art_re.captures_iter(html) {
        let block = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let (url, title_attr) = link_re.captures(block)
            .map(|c| (c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(), c.get(2).map(|m| m.as_str().to_string()).unwrap_or_default()))
            .or_else(|| link2_re.captures(block).map(|c| (c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(), String::new())))
            .unwrap_or_default();
        if url.is_empty() { continue; }
        let title = title_re.captures(block).or_else(|| title2_re.captures(block))
            .map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or("")))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| clean_text(&title_attr));
        let thumb = img_re.captures(block).or_else(|| img2_re.captures(block))
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        let status = status_re.captures(block).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or("")));
        let tipe = typez_re.captures(block).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or(""))).unwrap_or_else(|| "Donghua".into());
        let latest_ep = ep_re.captures(block).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or("")));
        series.push(json!({
            "title": title, "url": url,
            "slug": slugify(&url, "^/seri/"),
            "thumbnail": thumb, "type": tipe,
            "status": status, "latestEpisode": latest_ep,
        }));
    }
    series
}

fn parse_info_block(html: &str) -> serde_json::Map<String, Value> {
    let re = regex::Regex::new(r#"(?is)<span><b>([^<]+):</b>\s*([\s\S]*?)</span>"#).unwrap();
    let mut info = serde_json::Map::new();
    for cap in re.captures_iter(html) {
        let key = clean_text(cap.get(1).map(|m| m.as_str()).unwrap_or("")).to_lowercase();
        let val = clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        info.insert(key, json!(val));
    }
    info
}

fn parse_series_detail(html: &str, url: &str) -> Value {
    let title = regex::Regex::new(r#"(?is)<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)</h1>"#).unwrap()
        .captures(html).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or(""))).unwrap_or_default();
    let alter = regex::Regex::new(r#"(?is)<span[^>]*class="alter"[^>]*>([\s\S]*?)</span>"#).unwrap()
        .captures(html).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or("")));
    let syn = regex::Regex::new(r#"(?is)<div[^>]*class="synp"[^>]*>([\s\S]*?)</div>"#).unwrap()
        .captures(html).map(|c| c.get(1).map(|m| m.as_str()).unwrap_or(""))
        .or_else(|| regex::Regex::new(r#"(?is)<div[^>]*class="entry-content[^"]*"[^>]*>([\s\S]*?)</div>"#).unwrap()
            .captures(html).map(|c| c.get(1).map(|m| m.as_str()).unwrap_or("")));
    let thumb = regex::Regex::new(r#"(?is)<div[^>]*class="thumb"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)""#).unwrap()
        .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());

    let rating_width_re = regex::Regex::new(r#"(?i)<div class="rtb"><span style="width:([0-9.]+)%"></span></div>"#).unwrap();
    let rating: Option<String> = if let Some(c) = rating_width_re.captures(html) {
        c.get(1).and_then(|m| m.as_str().parse::<f64>().ok()).map(|v| format!("{:.1}", v / 10.0))
    } else {
        regex::Regex::new(r#"(?is)<div[^>]*class="rating"[^>]*>[\s\S]*?([0-9.]+)"#).unwrap()
            .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
    };

    let info = parse_info_block(html);

    let mut genres = Vec::new();
    let genre_block = regex::Regex::new(r#"(?is)<div[^>]*class="genxed"[^>]*>([\s\S]*?)</div>"#).unwrap()
        .captures(html).map(|c| c.get(1).map(|m| m.as_str()).unwrap_or("").to_string())
        .or_else(|| regex::Regex::new(r#"(?is)<span[^>]*class="mgen"[^>]*>([\s\S]*?)</span>"#).unwrap()
            .captures(html).map(|c| c.get(1).map(|m| m.as_str()).unwrap_or("").to_string()));
    if let Some(gb) = genre_block {
        let g_re = regex::Regex::new(r#"(?i)<a[^>]*>([^<]+)</a>"#).unwrap();
        for cap in g_re.captures_iter(&gb) {
            genres.push(clean_text(cap.get(1).map(|m| m.as_str()).unwrap_or("")));
        }
    }

    let ep_re = regex::Regex::new(
        r#"(?is)<li[^>]*data-index="[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)</div>[\s\S]*?<div class="epl-title">([^<]+)</div>[\s\S]*?<div class="epl-date">([^<]+)</div>"#).unwrap();
    let mut episodes: Vec<Value> = Vec::new();
    for cap in ep_re.captures_iter(html) {
        let ep_url = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        episodes.push(json!({
            "episodeNumber": clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or("")),
            "title": clean_text(cap.get(3).map(|m| m.as_str()).unwrap_or("")),
            "releaseDate": clean_text(cap.get(4).map(|m| m.as_str()).unwrap_or("")),
            "url": ep_url.clone(),
            "slug": slugify(&ep_url, "/$"),
        }));
    }
    if episodes.is_empty() {
        let alt = regex::Regex::new(r#"(?is)<a href="([^"]+)"[^>]*><div class="epl-title">([^<]+)</div>"#).unwrap();
        let caps: Vec<_> = alt.captures_iter(html).collect();
        let n = caps.len();
        for (i, cap) in caps.iter().enumerate() {
            let ep_url = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            episodes.push(json!({
                "episodeNumber": format!("{}", n - i),
                "title": clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or("")),
                "releaseDate": "-",
                "url": ep_url.clone(),
                "slug": slugify(&ep_url, "/$"),
            }));
        }
    }

    let mut batch_downloads = Vec::new();
    let batch_re = regex::Regex::new(r#"(?is)<div[^>]*class="soraurlx"[^>]*>([\s\S]*?)</div>"#).unwrap();
    for cap in batch_re.captures_iter(html) {
        let section = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let batch_name = regex::Regex::new(r#"(?is)<strong>([\s\S]*?)</strong>"#).unwrap()
            .captures(section).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or("")));
        let link_re = regex::Regex::new(r#"(?is)<a\s+href="([^"]+)"[^>]*>([\s\S]*?)</a>"#).unwrap();
        let links: Vec<Value> = link_re.captures_iter(section).map(|l| json!({
            "provider": clean_text(l.get(2).map(|m| m.as_str()).unwrap_or("")),
            "link": l.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
        })).collect();
        if !links.is_empty() {
            batch_downloads.push(json!({"batchName": batch_name.unwrap_or_else(|| "Batch".into()), "links": links}));
        }
    }

    json!({
        "title": title,
        "alternativeTitle": alter,
        "url": url,
        "slug": slugify(url, "^/seri/"),
        "thumbnail": thumb,
        "rating": rating.map(|r| format!("{} / 10", r)),
        "synopsis": syn.map(|s| clean_text(s)).unwrap_or_default(),
        "genres": genres,
        "info": {
            "status": info.get("status").cloned().unwrap_or(Value::Null),
            "type": info.get("type").cloned().unwrap_or_else(|| json!("Donghua")),
            "studio": info.get("studio").cloned().unwrap_or(Value::Null),
            "network": info.get("network").cloned().unwrap_or(Value::Null),
            "duration": info.get("duration").cloned().unwrap_or(Value::Null),
            "season": info.get("season").cloned().unwrap_or(Value::Null),
            "country": info.get("country").cloned().unwrap_or(Value::Null),
            "released": info.get("released").or_else(|| info.get("released on")).cloned().unwrap_or(Value::Null),
            "updatedOn": info.get("updated on").cloned().unwrap_or(Value::Null),
        },
        "totalEpisodes": episodes.len(),
        "episodes": episodes,
        "batchDownloads": batch_downloads,
    })
}

fn parse_episode_detail(html: &str, url: &str) -> Value {
    let title = regex::Regex::new(r#"(?is)<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)</h1>"#).unwrap()
        .captures(html).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or(""))).unwrap_or_default();
    let default_embed = regex::Regex::new(r#"(?is)<div class="player-embed"[^>]*>[\s\S]*?<iframe[^>]*src="([^"]+)""#).unwrap()
        .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());

    let mut streaming_servers = Vec::new();
    let opt_re = regex::Regex::new(r#"(?is)<option[^>]*value=["']([^"']*)["'][^>]*data-index=["']?([^"'>]*)["']?[^>]*>([\s\S]*?)</option>"#).unwrap();
    for cap in opt_re.captures_iter(html) {
        let b64 = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        let server_name = clean_text(cap.get(3).map(|m| m.as_str()).unwrap_or(""));
        let mut stream_url: Option<String> = None;
        if !b64.is_empty() {
            if let Some(decoded) = decode_base64_utf8(&b64) {
                stream_url = regex::Regex::new(r#"(?i)src=["']([^"']+)["']"#).unwrap()
                    .captures(&decoded).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
            }
        }
        streaming_servers.push(json!({
            "serverName": server_name,
            "serverIndex": cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default(),
            "streamUrl": stream_url.or_else(|| default_embed.clone()),
        }));
    }

    let mut downloads = Vec::new();
    let dl_re = regex::Regex::new(r#"(?is)<div[^>]*class="soraurlx"[^>]*>([\s\S]*?)</div>"#).unwrap();
    for cap in dl_re.captures_iter(html) {
        let block = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let q = regex::Regex::new(r#"(?is)<strong>([\s\S]*?)</strong>"#).unwrap()
            .captures(block).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or("")));
        let link_re = regex::Regex::new(r#"(?is)<a\s+href="([^"]+)"[^>]*>([\s\S]*?)</a>"#).unwrap();
        let links: Vec<Value> = link_re.captures_iter(block).map(|l| json!({
            "provider": clean_text(l.get(2).map(|m| m.as_str()).unwrap_or("")),
            "link": l.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
        })).collect();
        if !links.is_empty() {
            downloads.push(json!({"resolution": q.unwrap_or_else(|| "Direct".into()), "links": links}));
        }
    }

    let nav_prev = regex::Regex::new(r#"(?i)<a[^>]*href="([^"]+)"[^>]*class="prev""#).unwrap()
        .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
        .or_else(|| regex::Regex::new(r#"(?i)<a[^>]*href="([^"]+)"[^>]*rel="prev""#).unwrap()
            .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));
    let nav_next = regex::Regex::new(r#"(?i)<a[^>]*href="([^"]+)"[^>]*class="next""#).unwrap()
        .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
        .or_else(|| regex::Regex::new(r#"(?i)<a[^>]*href="([^"]+)"[^>]*rel="next""#).unwrap()
            .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));
    let nav_all = regex::Regex::new(r#"(?i)<a[^>]*href="([^"]+)"[^>]*class="allsub""#).unwrap()
        .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
        .or_else(|| regex::Regex::new(r#"(?i)<div class="allsub"><a href="([^"]+)""#).unwrap()
            .captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()));

    json!({
        "episodeTitle": if title.is_empty() { "Episode".to_string() } else { title },
        "url": url,
        "slug": slugify(url, "/$"),
        "navigation": {
            "prevEpisodeUrl": nav_prev,
            "nextEpisodeUrl": nav_next,
            "seriesUrl": nav_all,
        },
        "streamingServers": streaming_servers,
        "downloads": downloads,
    })
}

fn parse_schedule(html: &str) -> Value {
    let sec_re = regex::Regex::new(
        r#"(?is)<div class="releases"><h3><span>([^<]+)</span></h3></div>\s*<div class="listupd">([\s\S]*?)</div>\s*</div>"#).unwrap();
    let item_re = regex::Regex::new(
        r#"(?is)<div class="bsx">[\s\S]*?<a\s+href="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<div class="tt">([\s\S]*?)</div>"#).unwrap();
    let mut schedule = serde_json::Map::new();
    for cap in sec_re.captures_iter(html) {
        let day = clean_text(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        let block = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let mut items = Vec::new();
        for ic in item_re.captures_iter(block) {
            let url = ic.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let title = { let t = clean_text(ic.get(4).map(|m| m.as_str()).unwrap_or("")); if t.is_empty() { clean_text(ic.get(2).map(|m| m.as_str()).unwrap_or("")) } else { t } };
            let parent: &str = &block[ic.get(0).map(|m| m.start()).unwrap_or(0)..(ic.get(0).map(|m| m.start()).unwrap_or(0) + 500).min(block.len())];
            let time = regex::Regex::new(r#"(?is)<span class=['"]epx[^'"]*['"][^>]*>([\s\S]*?)</span>"#).unwrap()
                .captures(parent).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or(""))).unwrap_or_default();
            let sub = regex::Regex::new(r#"(?is)<span class=['"]sb[^'"]*['"][^>]*>([\s\S]*?)</span>"#).unwrap()
                .captures(parent).map(|c| clean_text(c.get(1).map(|m| m.as_str()).unwrap_or(""))).unwrap_or_default();
            items.push(json!({
                "title": title, "url": url, "slug": slugify(ic.get(1).map(|m| m.as_str()).unwrap_or(""), "^/seri/"),
                "thumbnail": ic.get(3).map(|m| m.as_str().to_string()).unwrap_or_default(),
                "time": time, "episode": sub,
            }));
        }
        if !items.is_empty() { schedule.insert(day, Value::Array(items)); }
    }
    Value::Object(schedule)
}

fn parse_genres(html: &str) -> Vec<Value> {
    let re = regex::Regex::new(
        r#"(?is)<input[^>]*name=["']genre\[\]["'][^>]*value=["']([^"']+)["'][^>]*>\s*<label[^>]*>([\s\S]*?)</label>"#).unwrap();
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in re.captures_iter(html) {
        let slug = clean_text(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        if seen.insert(slug.clone()) {
            out.push(json!({
                "name": clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or("")),
                "slug": slug.clone(),
                "url": format!("{}/genres/{}/", BASE_URL, slug),
            }));
        }
    }
    out
}

async fn handle_detail(url_or_slug: &str) -> Result<Value, String> {
    let t = url_or_slug.trim();
    let target_url = if !t.starts_with("http") {
        let clean = t.trim_start_matches("/seri/").trim_matches('/');
        format!("{}/seri/{}/", BASE_URL, clean)
    } else { t.to_string() };
    let html = fetch_html(&target_url).await?;
    Ok(parse_series_detail(&html, &target_url))
}

async fn handle_episode(url_or_slug: &str) -> Result<Value, String> {
    let mut target_url = url_or_slug.trim().to_string();
    if !target_url.starts_with("http") {
        let clean = target_url.trim_start_matches("/seri/").trim_matches('/');
        target_url = format!("{}/{}/", BASE_URL, clean);
    }
    let html = fetch_html(&target_url).await?;

    if html.contains("class=\"eplister\"") || html.contains("class=\"synp\"") || html.contains("class=\"infox\"") {
        let series_detail = parse_series_detail(&html, &target_url);
        if let Some(first_ep_url) = series_detail.pointer("/episodes/0/url").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            let ep_html = fetch_html(&first_ep_url).await?;
            let mut ep_data = parse_episode_detail(&ep_html, &first_ep_url);
            if let Value::Object(ref mut map) = ep_data {
                map.insert("note".into(), json!(format!("Input terdeteksi sebagai Series \"{}\". Menampilkan episode terbaru.", series_detail.get("title").and_then(|v| v.as_str()).unwrap_or(""))));
            }
            return Ok(ep_data);
        }
    }
    Ok(parse_episode_detail(&html, &target_url))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));

    let action = pstr(&params, &["action"]).to_lowercase();
    if action.is_empty() {
        return bad("Parameter 'action' wajib: search, ongoing, completed, schedule, genres, genre, detail, episode");
    }
    let mut q = pstr(&params, &["query"]);
    if q.is_empty() { q = pstr(&params, &["url"]); }
    let genre = pstr(&params, &["genre"]);

    let result: Result<Value, String> = match action.as_str() {
        "search" => {
            if q.is_empty() { return bad("Parameter 'query' wajib untuk action=search"); }
            let html = match fetch_html(&format!("{}/?s={}", BASE_URL, urlencoding::encode(&q))).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let data = parse_series_list(&html);
            Ok(json!({"status": true, "total": data.len(), "result": data}))
        }
        "ongoing" => {
            let html = match fetch_html(&format!("{}/ongoing/", BASE_URL)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let data = parse_series_list(&html);
            Ok(json!({"status": true, "total": data.len(), "result": data}))
        }
        "completed" => {
            let html = match fetch_html(&format!("{}/completed/", BASE_URL)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let data = parse_series_list(&html);
            Ok(json!({"status": true, "total": data.len(), "result": data}))
        }
        "schedule" => {
            let html = match fetch_html(&format!("{}/schedule/", BASE_URL)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let data = parse_schedule(&html);
            let days = data.as_object().map(|m| m.len()).unwrap_or(0);
            Ok(json!({"status": true, "daysCount": days, "result": data}))
        }
        "genres" => {
            let html = match fetch_html(&format!("{}/", BASE_URL)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let data = parse_genres(&html);
            Ok(json!({"status": true, "total": data.len(), "result": data}))
        }
        "genre" => {
            if genre.is_empty() { return bad("Parameter 'genre' wajib untuk action=genre"); }
            let clean = genre.trim_start_matches("/genres/").trim_matches('/');
            let html = match fetch_html(&format!("{}/genres/{}/", BASE_URL, clean)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let data = parse_series_list(&html);
            Ok(json!({"status": true, "genre": genre, "total": data.len(), "result": data}))
        }
        "detail" => {
            if q.is_empty() { return bad("Parameter 'query' atau 'url' wajib untuk action=detail"); }
            let data = match handle_detail(&q).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({"status": true, "result": data}))
        }
        "episode" => {
            if q.is_empty() { return bad("Parameter 'query' atau 'url' wajib untuk action=episode"); }
            let data = match handle_episode(&q).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({"status": true, "result": data}))
        }
        _ => return bad(&format!("Action '{}' tidak valid", action)),
    };

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => server_err(&e),
    }
}

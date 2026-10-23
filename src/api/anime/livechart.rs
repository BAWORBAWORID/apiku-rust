// LiveChart — native conversion of api/anime/livechart.js
// livechart.me scraper: season, year, detail, streams, info, rankings, studios, tags, franchises.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://www.livechart.me";
const SEASONS: [&str; 4] = ["winter", "spring", "summer", "fall"];

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

fn bad(code: u16, msg: &str) -> Response {
    (StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST),
        Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap()
}

async fn retry_fetch(url: &str, extra_headers: Option<(&str, &str)>) -> Option<String> {
    for i in 1..=3 {
        let mut rb = client().get(url);
        if let Some((k, v)) = extra_headers { rb = rb.header(k, v); }
        match rb.send().await {
            Ok(res) => {
                let status = res.status().as_u16();
                if status == 200 { return res.text().await.ok(); }
                if status == 404 { return None; }
                if status == 429 {
                    tokio::time::sleep(Duration::from_millis(i as u64 * 3000)).await;
                    continue;
                }
                return None;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(2000)).await,
        }
    }
    None
}

fn unescape(t: &str) -> String {
    t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

fn strip(h: &str) -> String {
    let br = regex::Regex::new(r"(?i)<br\s*/?>").unwrap();
    let tags = regex::Regex::new(r"<[^>]+>").unwrap();
    let s = br.replace_all(h, "\n");
    unescape(tags.replace_all(&s, "").to_string().trim())
}

fn find_attr(html: &str, attr: &str) -> Option<String> {
    let pat = format!("{}=\"([^\"]*)\"", attr);
    regex::Regex::new(&pat).ok()?.captures(html)
        .and_then(|c| c.get(1)).map(|m| unescape(m.as_str()))
}

// ═══ SEASON PAGE ═══
fn parse_season_page(html: &str, slug: &str) -> Vec<Value> {
    let arts = regex::Regex::new(r#"(?s)<article\s+class="anime"[\s\S]*?</article>"#).unwrap();
    let mut out = Vec::new();
    for a in arts.find_iter(html) {
        let a = a.as_str();
        let head = regex::Regex::new(r"^<article[^>]*>").unwrap()
            .captures(a).and_then(|c| c.get(0)).map(|m| m.as_str()).unwrap_or("");
        let Some(id) = find_attr(head, "data-anime-id") else { continue };
        out.push(json!({
            "id": id,
            "season": slug,
            "title_romaji": find_attr(head, "data-romaji"),
            "title_english": find_attr(head, "data-english"),
            "title_native": find_attr(head, "data-native"),
            "premiere_timestamp": find_attr(head, "data-premiere"),
            "url": format!("{}/anime/{}", BASE, id),
        }));
    }
    out
}

async fn scrape_season(season: &str, year: i64) -> Vec<Value> {
    let slug = format!("{}-{}", season, year);
    match retry_fetch(&format!("{}/{}/all", BASE, slug), None).await {
        Some(html) => parse_season_page(&html, &slug),
        None => Vec::new(),
    }
}

// ═══ ANIME DETAIL ═══
fn parse_detail_page(html: &str) -> Value {
    let mut data = serde_json::Map::new();
    if let Some(jc) = regex::Regex::new(r#"(?s)<script type="application/ld\+json"[^>]*>([\s\S]*?)</script>"#).unwrap().captures(html) {
        if let Ok(j) = serde_json::from_str::<Value>(jc.get(1).map(|m| m.as_str()).unwrap_or("")) {
            data.insert("name".into(), j.get("name").cloned().unwrap_or(Value::Null));
            data.insert("alternate_names".into(), j.get("alternateName").cloned().unwrap_or(json!([])));
            data.insert("genres".into(), j.get("genre").cloned().unwrap_or(json!([])));
            data.insert("description".into(), j.get("description").and_then(|v| v.as_str()).map(|s| json!(unescape(s))).unwrap_or(Value::Null));
            data.insert("episodes".into(), j.get("numberOfEpisodes").cloned().unwrap_or(Value::Null));
            data.insert("date_published".into(), j.get("datePublished").cloned().unwrap_or(Value::Null));
            data.insert("image".into(), j.get("image").cloned().unwrap_or(Value::Null));
            data.insert("rating_value".into(), j.pointer("/aggregateRating/ratingValue").cloned().unwrap_or(Value::Null));
            data.insert("rating_count".into(), j.pointer("/aggregateRating/ratingCount").cloned().unwrap_or(Value::Null));
            let companies: Vec<Value> = j.get("productionCompany").and_then(|v| v.as_array()).cloned().unwrap_or_default()
                .into_iter().filter_map(|c| c.get("name").cloned()).collect();
            data.insert("production_companies".into(), json!(companies));
        }
    }
    let status = regex::Regex::new(r#"data-anime-item-status="([^"]+)""#).unwrap()
        .captures(html).and_then(|c| c.get(1)).map(|m| json!(m.as_str()))
        .unwrap_or(Value::Null);
    data.insert("status".into(), status);
    for (key, label) in [("format", "Format"), ("source", "Source"), ("runtime", "Run time")] {
        let re = regex::Regex::new(&format!(r"(?s){}([\s\S]*?)</div>", label)).unwrap();
        data.insert(key.into(), re.captures(html).map(|c| json!(strip(&c[1]))).unwrap_or(Value::Null));
    }
    let has_companies = data.get("production_companies").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
    if !has_companies {
        let re = regex::Regex::new(r#"href="/studios/\d+"[^>]*>([^<]+)</a>"#).unwrap();
        let companies: Vec<String> = re.captures_iter(html).map(|c| unescape(c.get(1).map(|m| m.as_str()).unwrap_or(""))).collect();
        data.insert("production_companies".into(), json!(companies));
    }
    let excluded = ["Sequel", "Prequel", "Side Story", "Summary", "Spin-off", "Alternative Version", "Parent Story", "Full Story", "Alternative Setting"];
    let tag_re = regex::Regex::new(r#"href="/tags/\d+"[^>]*>([^<]+)</a>"#).unwrap();
    let tags: Vec<String> = tag_re.captures_iter(html).map(|c| unescape(c.get(1).map(|m| m.as_str()).unwrap_or("")))
        .filter(|t| !excluded.contains(&t.as_str())).collect();
    data.insert("tags".into(), json!(tags));

    let hash_re = regex::Regex::new(r#"href="https?://x\.com/search\?q=%23([^&"]+)"#).unwrap();
    let hashtags: Vec<String> = hash_re.captures_iter(html).filter_map(|c| c.get(1))
        .map(|m| urlencoding::decode(m.as_str()).map(|s| s.to_string()).unwrap_or_default()).collect();
    data.insert("hashtags".into(), json!(hashtags));

    for (key, re_pat) in [
        ("mal_url", r#"(https?://myanimelist\.net/anime/\d+[^"]*)"#),
        ("anilist_url", r#"(https?://anilist\.co/anime/\d+[^"]*)"#),
        ("anidb_url", r#"(https?://anidb\.net/a\d+[^"]*)"#),
        ("anime_planet_url", r#"(https?://www\.anime-planet\.com/anime/[^"]*)"#),
        ("kitsu_url", r#"(https?://kitsu\.app/anime/\d+[^"]*)"#),
        ("twitter_url", r#"href="(https?://(?:x|twitter)\.com/[^"]*)"[^>]*class="[^"]*twitter"#),
        ("official_url", r#"href="(https?://[^"]*)"[^>]*class="[^"]*website"#),
    ] {
        data.insert(key.into(), regex::Regex::new(re_pat).ok()
            .and_then(|r| r.captures(html)).and_then(|c| c.get(1)).map(|m| json!(m.as_str())).unwrap_or(Value::Null));
    }
    let rel_re = regex::Regex::new(r#"href="/anime/(\d+)"[^>]*>([^<]+)</a>"#).unwrap();
    let related: Vec<Value> = rel_re.captures_iter(html)
        .filter(|c| c.get(2).map(|m| m.as_str()) != Some("Info") && c.get(2).map(|m| m.as_str()) != Some("View All"))
        .map(|c| json!({"id": c.get(1).map(|m| m.as_str().to_string()), "title": unescape(c.get(2).map(|m| m.as_str()).unwrap_or(""))}))
        .collect();
    data.insert("related_anime".into(), json!(related));
    Value::Object(data)
}

// ═══ STREAMS PAGE ═══
fn parse_streams_page(html: &str) -> Vec<Value> {
    let re = regex::Regex::new(r#"(?s)alt="([^"]+?)\s*logo"[\s\S]*?<a[^>]+class="link[^"]*"[^>]+href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
    let mut streams = Vec::new();
    for cap in re.captures_iter(html) {
        let name = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        let url = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
        if !name.is_empty() && !url.is_empty() && !streams.iter().any(|s: &Value| s.get("service").and_then(|v| v.as_str()) == Some(name.as_str())) {
            streams.push(json!({"service": name, "url": unescape(&url)}));
        }
    }
    streams
}

// ═══ RANKINGS ═══
fn parse_rankings(html: &str) -> Value {
    let re = regex::Regex::new(
        r#"(?s)<tr[^>]*data-anime-item-id="(\d+)"[^>]*data-anime-item-romaji-title="([^"]*)"[^>]*data-anime-item-english-title="([^"]*)">([\s\S]*?)</tr>"#).unwrap();
    let anime: Vec<Value> = re.captures_iter(html).map(|r| {
        let rank = regex::Regex::new(r"<td[^>]*>(\d+)</td>").unwrap().captures(&r[4])
            .and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok());
        json!({
            "rank": rank,
            "id": r.get(1).map(|m| m.as_str().to_string()),
            "title_romaji": unescape(r.get(2).map(|m| m.as_str()).unwrap_or("")),
            "title_english": unescape(r.get(3).map(|m| m.as_str()).unwrap_or("")),
        })
    }).collect();
    let re2 = regex::Regex::new(
        r#"(?s)<tr>[\s\S]*?<td[^>]*>(\d+)</td>[\s\S]*?href="/franchises/(\d+)"[^>]*>([^<]+)</a>[\s\S]*?</tr>"#).unwrap();
    let franchises: Vec<Value> = re2.captures_iter(html).map(|r| json!({
        "rank": r.get(1).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0),
        "franchise_id": r.get(2).map(|m| m.as_str().to_string()),
        "name": unescape(r.get(3).map(|m| m.as_str()).unwrap_or("")),
    })).collect();
    json!({"anime": anime, "franchises": franchises})
}

// ═══ STUDIOS / TAGS / FRANCHISES ═══
fn article_blocks(html: &str) -> Vec<String> {
    let re = regex::Regex::new(r"(?s)<article[\s\S]*?</article>").unwrap();
    re.find_iter(html).map(|m| m.as_str().to_string()).collect()
}

fn parse_studios(html: &str) -> Vec<Value> {
    let mut studios = Vec::new();
    for a in article_blocks(html) {
        let id = regex::Regex::new(r#"href="/studios/(\d+)""#).unwrap().captures(&a)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        let name = regex::Regex::new(r#"href="/studios/\d+"[^>]*>([^<]+)</a>"#).unwrap().captures(&a)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        let founded = regex::Regex::new(r"founded in (\d+)").unwrap().captures(&a)
            .and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok());
        let logo = regex::Regex::new(r#"src="([^"]+)""#).unwrap().captures(&a)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        if let (Some(id), Some(name)) = (id, name) {
            let idn = id.parse::<i64>().unwrap_or(0);
            studios.push(json!({
                "id": idn, "name": unescape(&name), "founded": founded,
                "logo": logo, "url": format!("{}/studios/{}", BASE, id),
            }));
        }
    }
    studios
}

fn parse_tags(html: &str) -> Vec<Value> {
    let mut tags = Vec::new();
    for a in article_blocks(html) {
        if let Some(c) = regex::Regex::new(r#"href="/tags/(\d+)"[^>]*>([^<]+)</a>"#).unwrap().captures(&a) {
            let id = c.get(1).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
            tags.push(json!({
                "id": id, "name": unescape(c.get(2).map(|m| m.as_str()).unwrap_or("")),
                "url": format!("{}/tags/{}", BASE, id),
            }));
        }
    }
    tags
}

async fn scrape_franchises(page: i64) -> (i64, Vec<Value>) {
    let p = page.clamp(1, 10);
    let Some(html) = retry_fetch(&format!("{}/franchises?page={}", BASE, p), None).await else {
        return (p, Vec::new());
    };
    let re = regex::Regex::new(r#"href="/franchises/(\d+)"[^>]*>([^<]+)</a>"#).unwrap();
    let items: Vec<Value> = re.captures_iter(&html)
        .filter(|c| c.get(2).map(|m| m.as_str()) != Some("Franchises"))
        .filter_map(|c| c.get(1).and_then(|m| m.as_str().parse::<i64>().ok()).map(|id| {
            json!({"id": id, "name": unescape(c.get(2).map(|m| m.as_str()).unwrap_or("")), "url": format!("{}/franchises/{}", BASE, id)})
        })).collect();
    (p, items)
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = { let a = pstr(&params, &["action"]); if a.is_empty() { pstr(&params, &["type"]) } else { a } }
        .trim().to_lowercase();
    if action.is_empty() {
        return bad(400, "Parameter 'action' wajib: season, year, detail, streams, info, rankings, studios, tags, franchises");
    }
    let year: i64 = pstr(&params, &["year"]).parse().unwrap_or(0);
    let season = pstr(&params, &["season"]).trim().to_lowercase();
    let id = { let v = pstr(&params, &["id"]); if v.is_empty() { pstr(&params, &["anime_id"]) } else { v } };

    let resp: Result<Value, (u16, String)> = (|| async {
        match action.as_str() {
            "season" => {
                if !SEASONS.contains(&season.as_str()) { return Err((400, "Parameter 'season' wajib: winter, spring, summer, fall".into())); }
                if !(1970..=2030).contains(&year) { return Err((400, "Parameter 'year' wajib (1970-2030)".into())); }
                let items = scrape_season(&season, year).await;
                Ok(json!({"total": items.len(), "season": format!("{}-{}", season, year), "result": items}))
            }
            "year" => {
                if !(1970..=2030).contains(&year) { return Err((400, "Parameter 'year' wajib (1970-2030)".into())); }
                let mut seen = std::collections::HashSet::new();
                let mut all = Vec::new();
                for (i, s) in SEASONS.iter().enumerate() {
                    let items = scrape_season(s, year).await;
                    for a in items {
                        if let Some(aid) = a.get("id").and_then(|v| v.as_str()).map(|x| x.to_string()) {
                            if seen.insert(aid) { all.push(a); }
                        }
                    }
                    if i < SEASONS.len() - 1 { tokio::time::sleep(Duration::from_millis(500)).await; }
                }
                Ok(json!({"total": all.len(), "year": year, "result": all}))
            }
            "detail" => {
                if id.is_empty() { return Err((400, "Parameter 'id' (anime id) wajib untuk action=detail".into())); }
                let Some(html) = retry_fetch(&format!("{}/anime/{}", BASE, id), None).await else {
                    return Err((400, "Anime tidak ditemukan (404)".into()));
                };
                let data = parse_detail_page(&html);
                let mut out = serde_json::Map::new();
                let name = data.get("name").cloned().unwrap_or(Value::Null);
                out.insert("title_english".into(), name.clone());
                let alt = data.get("alternate_names").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                out.insert("title_romaji".into(), alt.get(1).cloned().or(Some(name.clone())).unwrap_or(Value::Null));
                out.insert("title_native".into(), alt.first().cloned().unwrap_or(Value::Null));
                if let Some(m) = data.as_object() { for (k, v) in m { out.insert(k.clone(), v.clone()); } }
                out.insert("id".into(), json!(id));
                Ok(json!({"result": Value::Object(out)}))
            }
            "streams" => {
                if id.is_empty() { return Err((400, "Parameter 'id' (anime id) wajib untuk action=streams".into())); }
                let streams = match retry_fetch(&format!("{}/anime/{}/streams", BASE, id), Some(("X-Requested-With", "XMLHttpRequest"))).await {
                    Some(html) => parse_streams_page(&html),
                    None => Vec::new(),
                };
                Ok(json!({"total": streams.len(), "anime_id": id, "result": streams}))
            }
            "info" => {
                if id.is_empty() { return Err((400, "Parameter 'id' (anime id) wajib untuk action=info".into())); }
                let u1 = format!("{}/anime/{}", BASE, id);
                let u2 = format!("{}/anime/{}/streams", BASE, id);
                let (detail_html, streams_html) = tokio::join!(
                    retry_fetch(&u1, None),
                    retry_fetch(&u2, Some(("X-Requested-With", "XMLHttpRequest")))
                );
                let Some(dhtml) = detail_html else { return Err((400, "Anime tidak ditemukan (404)".into())); };
                let data = parse_detail_page(&dhtml);
                let streams = streams_html.map(|h| parse_streams_page(&h)).unwrap_or_default();
                let mut out = serde_json::Map::new();
                let name = data.get("name").cloned().unwrap_or(Value::Null);
                out.insert("title_english".into(), name.clone());
                let alt = data.get("alternate_names").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                out.insert("title_romaji".into(), alt.get(1).cloned().or(Some(name.clone())).unwrap_or(Value::Null));
                out.insert("title_native".into(), alt.first().cloned().unwrap_or(Value::Null));
                if let Some(m) = data.as_object() { for (k, v) in m { out.insert(k.clone(), v.clone()); } }
                out.insert("id".into(), json!(id));
                out.insert("streams".into(), json!(streams));
                Ok(json!({"result": Value::Object(out)}))
            }
            "rankings" => {
                let data = retry_fetch(&format!("{}/rankings", BASE), None).await.map(|h| parse_rankings(&h))
                    .unwrap_or(json!({"anime": [], "franchises": []}));
                let total = data.get("anime").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                Ok(json!({"total": total, "result": data}))
            }
            "studios" => {
                let studios = retry_fetch(&format!("{}/studios", BASE), None).await.map(|h| parse_studios(&h)).unwrap_or_default();
                Ok(json!({"total": studios.len(), "result": studios}))
            }
            "tags" => {
                let tags = retry_fetch(&format!("{}/tags", BASE), None).await.map(|h| parse_tags(&h)).unwrap_or_default();
                Ok(json!({"total": tags.len(), "result": tags}))
            }
            "franchises" => {
                let page: i64 = pstr(&params, &["page"]).parse().unwrap_or(1);
                let (p, franchises) = scrape_franchises(page).await;
                Ok(json!({"total": franchises.len(), "result": franchises, "_page": p}))
            }
            _ => Err((400, "Action tidak valid. Gunakan: season, year, detail, streams, info, rankings, studios, tags, franchises".into())),
        }
    })().await;

    match resp {
        Ok(mut v) => {
            if let Some(o) = v.as_object_mut() { o.remove("_page"); o.insert("status".into(), json!(true)); o.insert("source".into(), json!(BASE)); }
            Json(v).into_response()
        }
        Err((code, msg)) => bad(code, &msg),
    }
}

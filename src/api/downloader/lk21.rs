// Lk21 — native conversion of api/downloader/lk21.js
// Node version used puppeteer (stealth) to load pages because of bot-protection.
// Rust version is best-effort pure HTTP: same routes/parsing on static HTML.
// If the upstream serves a JS challenge, the fetch fails and status:false is returned.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const LK21: &str = "https://tv10.lk21official.cc";
const NONTONDRAMA: &str = "https://tv4.nontondrama.my";

fn client() -> Result<reqwest::Client, String> {
    crate::api::solve::common::http_client(None, 45)
}

async fn get_html(url: &str) -> Result<String, String> {
    let c = client()?;
    let res = c
        .get(url)
        .header(
            "accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
                    .header("accept-language", "id-ID,id;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("request error: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("upstream HTTP {}", res.status()));
    }
    res.text().await.map_err(|e| format!("read error: {e}"))
}

fn text_between<'a>(html: &'a str, marker: &str) -> String {
    match html.find(marker) {
        Some(i) => {
            let rest = &html[i + marker.len()..];
            match rest.find('<') {
                Some(e) => rest[..e].trim().to_string(),
                None => rest.trim().to_string(),
            }
        }
        None => String::new(),
    }
}

fn attr_near(html: &str, marker: &str, attr: &str) -> Option<String> {
    // Find value of attr="..." closest after marker occurrence.
    let idx = html.find(marker)?;
    let seg = &html[idx..(idx + 4000).min(html.len())];
    let needle = format!("{attr}=\"");
    let pos = seg.find(&needle)?;
    let rest = &seg[pos + needle.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn slug_from_href(href: &str) -> String {
    let base = href.trim_end_matches('/');
    base.rsplit('/').next().unwrap_or("").to_string()
}

/// Parse article list items (mirrors Node parseList).
fn parse_list(html: &str) -> Value {
    let mut results: Vec<Value> = Vec::new();
    for chunk in html.split("<article").skip(1) {
        let chunk = &chunk[..chunk.find("</article>").unwrap_or(chunk.len())];
        // first <a ... href= after "figure"
        let search_zone = chunk.find("figure").map(|i| &chunk[i..]).unwrap_or(chunk);
        let href = attr_near(search_zone, "<a", "href").unwrap_or_default();
        if href.is_empty() {
            continue;
        }
        let slug = slug_from_href(&href);
        let title = ["h3.poster-title\">", "h2.poster-title\">"]
            .iter()
            .map(|m| text_between(chunk, m))
            .find(|s| !s.is_empty())
            .or_else(|| attr_near(chunk, "<a", "title"))
            .unwrap_or_default();
        let poster = attr_near(chunk, "type=\"image/jpeg\"", "srcset")
            .or_else(|| attr_near(chunk, "<img", "data-src"))
            .or_else(|| attr_near(chunk, "<img", "src"))
            .unwrap_or_default();
        let year = text_between(chunk, "span.year\">");
        let quality = text_between(chunk, "span.label\">");
        let rating = text_between(chunk, "itemprop=\"ratingValue\">");
        let episode = text_between(chunk, "span.episode\">");
        let duration = text_between(chunk, "span.duration\">");
        results.push(json!({
            "title": title, "slug": slug, "href": href, "poster": poster,
            "year": year, "quality": quality, "rating": rating,
            "episode": episode, "duration": duration,
        }));
    }
    Value::Array(results)
}

fn meta_content(html: &str, prop: &str) -> String {
    let needle = format!("property=\"{prop}\"");
    if let Some(i) = html.find(&needle) {
        let seg = &html[i..];
        let n = "content=\"";
        if let Some(p) = seg.find(n) {
            let v = &seg[p + n.len()..];
            if let Some(e) = v.find('"') {
                return v[..e].to_string();
            }
        }
    }
    String::new()
}

fn year_from_page(html: &str) -> String {
    for seg in html.split("\"datePublished\":").skip(1) {
        let seg = seg.trim_start();
        if let Some(q) = seg.strip_prefix('"') {
            let digits: String = q.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.len() == 4 {
                return digits;
            }
        }
    }
    if let Some(i) = html.find("/year/") {
        let seg = &html[i..];
        if let Some(gt) = seg.find('>') {
            let v = &seg[gt + 1..];
            if let Some(lt) = v.find('<') {
                return v[..lt].trim().to_string();
            }
        }
    }
    String::new()
}

fn tags_from_page(html: &str, marker: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(i) = html[pos..].find(marker) {
        let abs = pos + i;
        let seg = &html[abs..];
        if let Some(gt) = seg.find('>') {
            let v = &seg[gt + 1..];
            if let Some(lt) = v.find('<') {
                let label = v[..lt].trim().to_string();
                if !label.is_empty() && !out.contains(&label) {
                    out.push(label);
                }
            }
        }
        pos = abs + marker.len();
    }
    out
}

fn info_spans(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let start = match html.find("info-tag") {
        Some(i) => i,
        None => return out,
    };
    let seg = &html[start..(start + 4000).min(html.len())];
    for chunk in seg.split("<span").skip(1) {
        let chunk = &chunk[..chunk.find("</span>").unwrap_or(chunk.len())];
        if let Some(g) = chunk.find('>') {
            let v = &chunk[g + 1..];
            let t = match v.find('<') {
                Some(l) => v[..l].trim().to_string(),
                None => v.trim().to_string(),
            };
            if !t.is_empty() {
                out.push(t);
            }
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

fn h1_title(html: &str) -> String {
    let start = match html.find("<h1") {
        Some(i) => &html[i..],
        None => return String::new(),
    };
    start
        .find('>')
        .and_then(|g| {
            let v = &start[g + 1..];
            v.find("</h1>").map(|e| v[..e].trim().to_string())
        })
        .unwrap_or_default()
}

fn collect_servers(html: &str) -> Vec<Value> {
    let mut servers = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for chunk in html.split("data-server=").skip(1) {
        let server = chunk
            .strip_prefix('"')
            .and_then(|c| c.find('"').map(|e| &c[..e]))
            .unwrap_or("");
        if let Some(n) = chunk.find("data-url=\"") {
            let rest = &chunk[n + 10..];
            if let Some(e) = rest.find('"') {
                let url = &rest[..e];
                if !server.is_empty() && !url.is_empty() && seen.insert(server.to_string()) {
                    servers.push(json!({"server": server, "url": url}));
                }
            }
        }
    }
    servers
}

fn parse_movie_detail(html: &str) -> Value {
    let spans = info_spans(html);
    let rating: String = spans
        .first()
        .map(|s| s.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect())
        .unwrap_or_default();
    let (genre, country) = (
        tags_from_page(html, "/genre/"),
        tags_from_page(html, "/country/"),
    );
    let synopsis = attr_near(html, "data-full=\"", "data-full").unwrap_or_default();
    json!({
        "title": h1_title(html), "rating": rating,
        "quality": spans.get(1).cloned().unwrap_or_default(),
        "resolution": spans.get(2).cloned().unwrap_or_default(),
        "duration": spans.get(3).cloned().unwrap_or_default(),
        "year": year_from_page(html), "genre": genre, "country": country,
        "synopsis": synopsis, "poster": meta_content(html, "og:image"),
        "servers": collect_servers(html),
    })
}

fn parse_series_detail(html: &str) -> Value {
    let spans = info_spans(html);
    let rating: String = spans
        .first()
        .map(|s| s.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect())
        .unwrap_or_default();
    let (genre, country) = (
        tags_from_page(html, "/genre/"),
        tags_from_page(html, "/country/"),
    );
    let synopsis = attr_near(html, "data-full=\"", "data-full").unwrap_or_default();
    let mut episodes = Vec::new();
    for chunk in html.split("<a ").skip(1) {
        let chunk = &chunk[..chunk.find("</a>").unwrap_or(chunk.len())];
        let href = match chunk.find("href=\"") {
            Some(p) => {
                let v = &chunk[p + 6..];
                match v.find('"') {
                    Some(e) => v[..e].to_string(),
                    None => continue,
                }
            }
            None => continue,
        };
        if href.contains("episode") {
            let label = match chunk.find('>') {
                Some(g) => {
                    let v = &chunk[g + 1..];
                    match v.find('<') {
                        Some(l) => v[..l].trim().to_string(),
                        None => v.trim().to_string(),
                    }
                }
                None => String::new(),
            };
            episodes.push(json!({
                "label": label, "slug": slug_from_href(&href), "href": href,
            }));
        }
    }
    json!({
        "title": h1_title(html), "rating": rating,
        "airDate": spans.get(1).cloned().unwrap_or_default(),
        "type": spans.get(2).cloned().unwrap_or_default(),
        "status": spans.get(3).cloned().unwrap_or_default(),
        "year": year_from_page(html), "genre": genre, "country": country,
        "synopsis": synopsis, "poster": meta_content(html, "og:image"),
        "episodes": episodes,
    })
}

fn parse_episode_watch(html: &str) -> Value {
    let mut meta = Value::Null;
    if let Some(i) = html.find("\"current_eps\"") {
        if let Some(start) = html[..i].rfind('{') {
            let seg = &html[start..];
            if let Some(end) = seg.find('}') {
                if let Ok(v) = serde_json::from_str::<Value>(&seg[..end + 1]) {
                    meta = v;
                }
            }
        }
    }
    let get = |k: &str| meta.get(k).cloned().unwrap_or(Value::Null);
    json!({
        "title": h1_title(html),
        "season": get("current_season"),
        "episode": get("current_eps"),
        "totalEps": get("total_eps"),
        "rating": get("rating"),
        "poster": get("poster"),
        "seriesSlug": get("slug"),
        "servers": collect_servers(html),
        "prevEp": Value::Null,
        "nextEp": meta.get("next").and_then(|v| v.as_str()).map(|s| format!("/{s}")),
    })
}

pub(crate) async fn scrape_home(category: &str) -> Result<Value, String> {
    let base = if category == "series" { NONTONDRAMA } else { LK21 };
    let html = get_html(&format!("{base}/")).await?;
    Ok(parse_list(&html))
}

pub(crate) async fn scrape_latest(category: &str, page: u32) -> Result<Value, String> {
    let (base, path) = if category == "series" {
        (
            NONTONDRAMA,
            if page > 1 {
                format!("/latest-series/page/{page}/")
            } else {
                "/latest-series/".into()
            },
        )
    } else {
        (
            LK21,
            if page > 1 {
                format!("/latest/page/{page}/")
            } else {
                "/latest/".into()
            },
        )
    };
    let html = get_html(&format!("{base}{path}")).await?;
    Ok(parse_list(&html))
}

pub(crate) async fn scrape_search(q: &str, category: &str, page: u32) -> Result<Value, String> {
    let base = if category == "series" { NONTONDRAMA } else { LK21 };
    let url = if page > 1 {
        format!("{base}/search/page/{page}/?s={}", urlencoding::encode(q))
    } else {
        format!("{base}/search/?s={}", urlencoding::encode(q))
    };
    let html = get_html(&url).await?;
    Ok(parse_list(&html))
}

pub(crate) async fn scrape_genre(genre: &str, category: &str, page: u32) -> Result<Value, String> {
    let base = if category == "series" { NONTONDRAMA } else { LK21 };
    let url = if page > 1 {
        format!("{base}/genre/{genre}/page/{page}/")
    } else {
        format!("{base}/genre/{genre}/")
    };
    let html = get_html(&url).await?;
    Ok(parse_list(&html))
}

pub(crate) async fn scrape_detail(slug: &str, category: &str) -> Result<Value, String> {
    let base = if category == "series" { NONTONDRAMA } else { LK21 };
    let html = get_html(&format!("{base}/{slug}/")).await?;
    if category != "series" {
        let h1 = html
            .find("<h1")
            .and_then(|i| html[i..].find("</h1>").map(|e| html[i..i + e].to_lowercase()))
            .unwrap_or_default();
        if h1.contains("dialihkan") || h1.contains("nontondrama") {
            let shtml = get_html(&format!("{NONTONDRAMA}/{slug}/")).await?;
            return Ok(json!({"type": "series", "data": parse_series_detail(&shtml)}));
        }
        return Ok(json!({"type": "movie", "data": parse_movie_detail(&html)}));
    }
    let og_type = meta_content(&html, "og:type");
    let og_url = meta_content(&html, "og:url");
    let is_movie = og_type != "series"
        && (og_url.contains("d21.team")
            || og_url.contains("lk21official")
            || !og_url.contains("nontondrama"));
    if is_movie {
        let mhtml = get_html(&format!("{LK21}/{slug}/")).await?;
        return Ok(json!({"type": "movie", "data": parse_movie_detail(&mhtml)}));
    }
    Ok(json!({"type": "series", "data": parse_series_detail(&html)}))
}

pub(crate) async fn scrape_watch_series(slug: &str) -> Result<Value, String> {
    let html = get_html(&format!("{NONTONDRAMA}/{slug}/")).await?;
    Ok(parse_episode_watch(&html))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let p = crate::api::solve::common::merged_params(&query, body.map(|Json(v)| v));
    let s = |k: &str| p.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());

    let action = s("action").unwrap_or_else(|| "latest".into());
    let category = s("category").unwrap_or_else(|| "movie".into());
    let page: u32 = s("page").and_then(|v| v.parse().ok()).unwrap_or(1);
    let q = s("q");
    let slug = s("slug");
    let genre = s("genre");

    let result: Result<Value, String> = match action.to_lowercase().as_str() {
        "home" => scrape_home(&category).await,
        "search" => match q.as_deref() {
            Some(q) if !q.is_empty() => scrape_search(q, &category, page).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'q' wajib untuk search"
                })))
                .into_response()
            }
        },
        "genre" => match genre.as_deref() {
            Some(g) if !g.is_empty() => scrape_genre(g, &category, page).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'genre' wajib"
                })))
                .into_response()
            }
        },
        "detail" => match slug.as_deref() {
            Some(sl) if !sl.is_empty() => scrape_detail(sl, &category).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'slug' wajib untuk detail"
                })))
                .into_response()
            }
        },
        "watch" => match slug.as_deref() {
            Some(sl) if !sl.is_empty() => scrape_watch_series(sl).await,
            _ => {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'slug' wajib untuk watch"
                })))
                .into_response()
            }
        },
        _ => scrape_latest(&category, page).await,
    };

    match result {
        Ok(result) => Json(json!({
            "status": true,
            "creator": "ShanMolvyr",
            "action": action,
            "category": category,
            "result": result,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"status": false, "message": e})),
        )
            .into_response(),
    }
}

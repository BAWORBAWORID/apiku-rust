// Manhwaland Search — native conversion of api/search/manhwaland.js
// Scraping 05c.manhwaland.land: homepage, latest, popular, genres, search,
// detail, chapter. Regex-based HTML parsing (tanpa scraper crate).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://05c.manhwaland.land";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_page(c: &reqwest::Client, url: &str, params: &[(&str, String)]) -> Result<String, (StatusCode, String)> {
    let resp = c.get(url).query(params).send().await
        .and_then(|r| r.error_for_status())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    resp.text().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#039;", "'").replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn text_between<'a>(html: &'a str, start: &Regex, end: &str) -> Option<&'a str> {
    let m = start.find(html)?;
    let rest = &html[m.end()..];
    let idx = rest.find(end)?;
    Some(&rest[..idx])
}

fn abs_url(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    if path.starts_with("http") {
        return path.to_string();
    }
    let base = BASE_URL.trim_end_matches('/');
    if let Some(p) = path.strip_prefix('/') {
        format!("{}/{}", base, p)
    } else {
        format!("{}/{}", base, path)
    }
}

fn attr<'a>(html: &'a str, tag_start: usize, name: &str) -> Option<String> {
    // cari attribute name="..." dalam tag HTML yang dimulai di tag_start
    let rest = &html[tag_start..];
    let tag_end = rest.find('>')?;
    let tag = &rest[..tag_end];
    let re = Regex::new(&format!(r##"(?is){}\s*=\s*["']([^"']*)["']"##, name)).ok()?;
    re.captures(tag).map(|c| html_decode(c.get(1).unwrap().as_str()))
}

fn inner_text(html: &str, tag_start: usize) -> String {
    let rest = &html[tag_start..];
    let Some(open_end) = rest.find('>') else { return String::new() };
    let after = &rest[open_end + 1..];
    let Some(close) = after.find("</") else { return String::new() };
    let inner = &after[..close];
    let re = Regex::new(r"(?s)<[^>]*>").unwrap();
    html_decode(re.replace_all(inner, "").trim())
}

/// Parse satu kartu manga (`<div class="manga-card ...">` atau `<a class="manga-grid ...">`).
fn parse_manga_card(block: &str) -> Value {
    let href_re = Regex::new(r##"href="(/manga/[^"]+)""##).unwrap();
    let href = href_re.captures(block).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();

    // title: .manga-title > h3 > img[alt]
    let mut title = String::new();
    let t1 = Regex::new(r##"class="manga-title"[^>]*>([^<]+)<"##).unwrap();
    let t2 = Regex::new(r"<h3[^>]*>(.*?)</h3>").unwrap();
    let t3 = Regex::new(r##"<img[^>]+alt="([^"]*)"##).unwrap();
    if let Some(c) = t1.captures(block) {
        title = html_decode(c[1].trim());
    } else if let Some(c) = t2.captures(block) {
        let re = Regex::new(r"(?s)<[^>]*>").unwrap();
        title = html_decode(re.replace_all(&c[1], "").trim());
    } else if let Some(c) = t3.captures(block) {
        title = html_decode(c[1].trim());
    }

    let img_re = Regex::new(r##"<img[^>]+src="([^"]*)"##).unwrap();
    let image = img_re.captures(block).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();

    let mut type_ = String::new();
    let ty1 = Regex::new(r##"class="manga-badge"[^>]*>([^<]+)<"##).unwrap();
    let ty2 = Regex::new(r##"class="text-white/80"[^>]*>([^<]+)<"##).unwrap();
    if let Some(c) = ty1.captures(block) {
        type_ = c[1].trim().to_string();
    } else if let Some(c) = ty2.captures(block) {
        type_ = c[1].trim().to_string();
    }

    // rating: teks "★ x" dalam blok
    let mut rating = String::new();
    let r1 = Regex::new(r##"class="text-amber-400"[^>]*>([^<]+)<"##).unwrap();
    if let Some(c) = r1.captures(block) {
        rating = c[1].replace('★', "").trim().to_string();
    }
    if rating.is_empty() {
        let r2 = Regex::new(r"★\s*([\d.A-Za-z/]+)").unwrap();
        if let Some(c) = r2.captures(block) {
            rating = c[1].trim().to_string();
        }
    }

    // views: teks "• x •"
    let mut views = String::new();
    let v1 = Regex::new(r##"class="text-zinc-300"[^>]*>([^<]+)<"##).unwrap();
    if let Some(c) = v1.captures(block) {
        views = c[1].trim().to_string();
    }
    if views.is_empty() {
        let v2 = Regex::new(r"•\s*([\d.A-Za-z/]+)\s*•").unwrap();
        if let Some(c) = v2.captures(block) {
            views = c[1].trim().to_string();
        }
    }

    // latest chapters: link anchor yang mengandung /chapter
    let mut latest_chapters: Vec<Value> = Vec::new();
    let ch_re = Regex::new(r##"(?s)<a\s+href="(/[^"]*chapter[^"]*)"[^>]*>(.*?)</a>"##).unwrap();
    for c in ch_re.captures_iter(block) {
        let ch_href = c.get(1).unwrap().as_str().to_string();
        let inner_html = c.get(2).unwrap().as_str();
        let re = Regex::new(r"(?s)<[^>]*>").unwrap();
        let plain = re.replace_all(inner_html, "").trim().to_string();
        // span pertama = judul, span terakhir = tanggal (ambil dari inner_html)
        let span_re = Regex::new(r"(?s)<span[^>]*>(.*?)</span>").unwrap();
        let spans: Vec<String> = span_re
            .captures_iter(inner_html)
            .map(|sc| html_decode(re.replace_all(&sc[1], "").trim()))
            .collect();
        let (ch_text, ch_date) = if spans.len() >= 2 {
            (spans[0].clone(), spans[spans.len() - 1].clone())
        } else {
            (plain.clone(), String::new())
        };
        latest_chapters.push(json!({
            "title": if ch_text.is_empty() { plain.clone() } else { ch_text },
            "url": abs_url(&ch_href),
            "uploadDate": if spans.len() >= 2 && spans[spans.len() - 1] != plain { ch_date } else { String::new() },
        }));
    }

    let slug = href.trim_start_matches("/manga/").to_string();
    json!({
        "title": title,
        "slug": slug,
        "url": if href.is_empty() { Value::String(String::new()) } else { Value::String(abs_url(&href)) },
        "image": image,
        "type": type_,
        "rating": if rating.is_empty() { "N/A".to_string() } else { rating },
        "views": if views.is_empty() { "N/A".to_string() } else { views },
        "latestChapters": latest_chapters,
    })
}

/// Kumpulkan semua kartu `.manga-card` atau `a.manga-grid` dari HTML.
fn collect_cards(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let re = Regex::new(r##"(?s)<(?:div|a)\s[^>]*class="[^"]*manga-(?:card|grid)[^"]*"[^>]*>.*?(?:</div>\s*</div>|</a>)"##).unwrap();
    for m in re.find_iter(html) {
        let card = parse_manga_card(m.as_str());
        // dedup by slug
        let slug = card.get("slug").and_then(Value::as_str).unwrap_or("");
        if !slug.is_empty() && !out.iter().any(|v: &Value| v.get("slug").and_then(Value::as_str) == Some(slug)) {
            out.push(card);
        }
    }
    out
}

fn hero_items(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    // img[loading="eager"] yang parent-nya <a>
    let re = Regex::new(r##"(?s)<a\s+href="([^"]*)"[^>]*>\s*<img[^>]+loading="eager"[^>]*>"##).unwrap();
    for c in re.captures_iter(html) {
        let href = c.get(1).unwrap().as_str().to_string();
        let tag = c.get(0).unwrap().as_str();
        let alt = Regex::new(r##"alt="([^"]*)"##).unwrap()
            .captures(tag).and_then(|m| m.get(1)).map(|m| html_decode(m.as_str())).unwrap_or_default();
        let src = Regex::new(r##"src="([^"]*)"##).unwrap()
            .captures(tag).and_then(|m| m.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        out.push(json!({
            "title": alt,
            "slug": href.trim_start_matches("/manga/"),
            "url": abs_url(&href),
            "image": src,
        }));
    }
    out
}

static GENRE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r##"href="/genres/([^"]+)"[^>]*>([^<]*)<"##).unwrap());


fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "status": false, "message": msg }))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if !v.is_empty() {
                    return Some(v.clone());
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(s) = v.get(*k).and_then(Value::as_str) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        None
    };

    let action = match get_param(&["action"]) {
        Some(a) => a,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'action' wajib diisi"),
    };
    let page: u32 = get_param(&["page"]).and_then(|p| p.parse().ok()).unwrap_or(1);
    let genre = get_param(&["genre"]).unwrap_or_default();
    let query_str = get_param(&["query", "q"]).unwrap_or_default();
    let url_param = get_param(&["url"]).unwrap_or_default();

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result: Result<Value, (StatusCode, String)> = async {
        match action.as_str() {
            "homepage" => {
                let html = fetch_page(&c, &format!("{}/", BASE_URL), &[]).await?;
                let hero = hero_items(&html);
                let mut latest = collect_cards(&html);
                latest.truncate(20);
                Ok(json!({ "hero": hero, "latest": latest }))
            }
            "latest" => {
                let html = fetch_page(&c, &format!("{}/latest", BASE_URL), &[("page", page.to_string())]).await?;
                Ok(json!({ "page": page, "manga": collect_cards(&html) }))
            }
            "popular" => {
                let html = fetch_page(&c, &format!("{}/popular", BASE_URL), &[("page", page.to_string())]).await?;
                Ok(json!({ "page": page, "manga": collect_cards(&html) }))
            }
            "genres" => {
                let html = fetch_page(&c, &format!("{}/", BASE_URL), &[]).await?;
                let mut genres: Vec<Value> = Vec::new();
                for cap in GENRE_RE.captures_iter(&html) {
                    let slug = cap.get(1).unwrap().as_str().to_string();
                    let title = html_decode(cap.get(2).unwrap().as_str().trim());
                    if !slug.is_empty() && !genres.iter().any(|g| g.get("slug").and_then(Value::as_str) == Some(slug.as_str())) {
                        genres.push(json!({ "title": if title.is_empty() { slug.clone() } else { title }, "slug": slug }));
                    }
                }
                Ok(json!(genres))
            }
            "search" => {
                if query_str.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' wajib untuk action search".into()));
                }
                let html = fetch_page(&c, &format!("{}/search", BASE_URL), &[("q", query_str.clone()), ("page", page.to_string())]).await?;
                Ok(json!({ "query": query_str, "page": page, "manga": collect_cards(&html) }))
            }
            "detail" => {
                if url_param.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'url' wajib untuk action detail".into()));
                }
                let detail_url = if url_param.starts_with("http") {
                    url_param.clone()
                } else {
                    let slug = url_param.trim_start_matches("/manga/").trim_start_matches('/');
                    format!("{}/manga/{}", BASE_URL, slug)
                };
                let html = fetch_page(&c, &detail_url, &[]).await?;

                let title = Regex::new(r"(?s)<h1[^>]*>(.*?)</h1>")
                    .unwrap()
                    .captures(&html)
                    .map(|cap| {
                        let re = Regex::new(r"(?s)<[^>]*>").unwrap();
                        html_decode(re.replace_all(&cap[1], "").trim())
                    })
                    .unwrap_or_default();

                let image = Regex::new(r##"<img[^>]+alt="Cover Komik[^"]*"[^>]+src="([^"]*)"##)
                    .unwrap()
                    .captures(&html)
                    .and_then(|cap| cap.get(1))
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();

                // Author/Artist/Status/Type/Views: <span>X</span><span>value</span> berpasangan
                let mut author = String::new();
                let mut artist = String::new();
                let mut status = String::new();
                let mut type_ = String::new();
                let mut views = String::new();
                let pair_re = Regex::new(r"(?s)<span[^>]*>([^<]+)</span>\s*<span[^>]*>([^<]+)</span>").unwrap();
                for cap in pair_re.captures_iter(&html) {
                    let key = cap[1].trim();
                    let val = cap[2].trim().to_string();
                    match key {
                        "Author" => author = val,
                        "Artist" => artist = val,
                        "Status" => status = val,
                        "Type" => type_ = val,
                        "Views" => views = val,
                        _ => {}
                    }
                }

                let synopsis = Regex::new(r"(?s)Synopsis\s*</h3>\s*<[^>]*>(.*?)</")
                    .unwrap()
                    .captures(&html)
                    .map(|cap| {
                        let re = Regex::new(r"(?s)<[^>]*>").unwrap();
                        html_decode(re.replace_all(&cap[1], "").trim())
                    })
                    .unwrap_or_default();

                let slug = detail_url.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();

                // chapters: semua <a href="/manga/<slug>/...">
        let ch_re = Regex::new(&format!(r##"(?s)<a\s+href="(/manga/{}/[^"]+)"[^>]*>(.*?)</a>"##, regex::escape(&slug))).unwrap();
                let mut chapters: Vec<Value> = Vec::new();
                for cap in ch_re.captures_iter(&html) {
                    let href = cap.get(1).unwrap().as_str().to_string();
                    let inner = cap.get(2).unwrap().as_str();
                    let re = Regex::new(r"(?s)<[^>]*>").unwrap();
                    let plain = re.replace_all(inner, "").trim().to_string();
                    let span_re = Regex::new(r"(?s)<span[^>]*>(.*?)</span>").unwrap();
                    let spans: Vec<String> = span_re
                        .captures_iter(inner)
                        .map(|sc| html_decode(re.replace_all(&sc[1], "").trim()))
                        .collect();
                    let (ch_text, ch_date) = if spans.len() >= 2 {
                        (spans[0].clone(), spans[spans.len() - 1].clone())
                    } else {
                        (plain.clone(), String::new())
                    };
                    let ch_slug = href.replacen(&format!("/manga/{}/", slug), "", 1);
                    chapters.push(json!({
                        "title": ch_text.replace(&ch_date, "").trim(),
                        "slug": ch_slug,
                        "url": abs_url(&href),
                        "uploadDate": if spans.len() >= 2 && spans[spans.len() - 1] != plain { ch_date.trim().to_string() } else { String::new() },
                    }));
                }
                chapters.reverse();

                Ok(json!({
                    "title": title, "slug": slug, "url": detail_url, "image": image,
                    "author": author, "artist": artist, "status": status, "type": type_,
                    "views": views, "synopsis": synopsis, "chapters": chapters,
                }))
            }
            "chapter" => {
                if url_param.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'url' wajib untuk action chapter".into()));
                }
                let ch_url = if url_param.starts_with("http") {
                    url_param.clone()
                } else {
                    let slug = url_param.trim_start_matches("/manga/").trim_start_matches('/');
                    format!("{}/manga/{}", BASE_URL, slug)
                };
                let html = fetch_page(&c, &ch_url, &[]).await?;

                let title = Regex::new(r"(?is)<title>(.*?)</title>")
                    .unwrap()
                    .captures(&html)
                    .map(|cap| html_decode(cap[1].trim()))
                    .unwrap_or_default();

                let mut images: Vec<String> = Vec::new();
                let img_re = Regex::new(r##"(?s)<img\b[^>]*>"##).unwrap();
                for m in img_re.find_iter(&html) {
                    let tag = m.as_str();
                    let class = attr(&html, m.start(), "class").unwrap_or_default();
                    let src = attr(&html, m.start(), "src").unwrap_or_default();
                    let data_src = attr(&html, m.start(), "data-src").unwrap_or_default();
                    let candidate = if !src.is_empty() { src } else { data_src };
                    if candidate.is_empty() {
                        continue;
                    }
                    if class.contains("page-image") || class.contains("page") || candidate.contains("/manga/") {
                        if !images.contains(&candidate) {
                            images.push(candidate);
                        }
                    }
                }
                Ok(json!({ "title": title, "url": ch_url, "pages": images }))
            }
            _ => Err((StatusCode::BAD_REQUEST, format!("Unknown action: {}", action))),
        }
    }
    .await;

    match result {
        Ok(r) => Json(json!({ "status": true, "result": r })).into_response(),
        Err((status, msg)) => err(status, &msg),
    }
}

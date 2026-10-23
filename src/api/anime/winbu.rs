// Winbu — native conversion of api/anime/winbu.js
// winbu.org scraper: home, search, series, film (AJAX player resolve), stream, category, genre, genres.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://winbu.org";

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

fn bad(code: u16, msg: &str) -> Response {
    (StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST),
        Json(json!({"status": false, "message": msg}))).into_response()
}

fn to_absolute_url(url: &str) -> Option<String> {
    if url.is_empty() { return None; }
    let clean = url.trim();
    if clean.starts_with("http://") || clean.starts_with("https://") { return Some(clean.to_string()); }
    if clean.starts_with("//") { return Some(format!("https:{}", clean)); }
    Some(format!("{}/{}", BASE_URL.trim_end_matches('/'), clean.trim_start_matches('/')))
}

fn clean_text(t: &str) -> String { t.split_whitespace().collect::<Vec<_>>().join(" ") }

fn text_of(frag: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    clean_text(&re.replace_all(frag, ""))
}

fn find_attr(tag: &str, name: &str) -> Option<String> {
    let pat = format!("{}=\"", name);
    tag.find(&pat).and_then(|p| {
        let s = &tag[p + pat.len()..];
        s.find('"').map(|e| s[..e].to_string())
    }).or_else(|| {
        let pat2 = format!("{}='", name);
        tag.find(&pat2).and_then(|p| {
            let s = &tag[p + pat2.len()..];
            s.find('\'').map(|e| s[..e].to_string())
        })
    })
}

async fn fetch_html(url: &str) -> Result<String, String> {
    let res = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
        .build().map_err(|e| e.to_string())?
        .get(url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", format!("{}/", BASE_URL))
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {}", status)); }
    Ok(body)
}

fn anchors(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("<a ") {
        let start = i + p;
        let Some(gt) = lower[start..].find('>') else { break };
        let tag = html[start..start + gt].to_string();
        let inner_start = start + gt + 1;
        let Some(close) = lower[inner_start..].find("</a>") else { break };
        out.push((tag, html[inner_start..inner_start + close].to_string()));
        i = inner_start + close + 4;
    }
    out
}

fn img_of(block: &str) -> Option<String> {
    let lower = block.to_lowercase();
    lower.find("<img").and_then(|p| {
        let gt = lower[p..].find('>')? + p;
        let tag = &block[p..=gt];
        find_attr(tag, "src").or_else(|| find_attr(tag, "data-src"))
            .or_else(|| find_attr(tag, "data-lazy-src"))
    })
}

fn first_inner_by_class(frag: &str, classes: &[&str]) -> Option<(usize, usize, String)> {
    let lower = frag.to_lowercase();
    for cls in classes {
        let needle = format!("class=\"{}", cls);
        if let Some(p) = lower.find(&needle) {
            let tag_start = frag[..p].rfind('<').unwrap_or(p);
            let gt = lower[tag_start..].find('>')? + tag_start;
            let end = lower[gt..].find("</").map(|e| gt + e).unwrap_or(frag.len());
            return Some((gt, end, text_of(&frag[gt..end])));
        }
    }
    None
}

fn parse_card(item: &str) -> Option<Value> {
    let mut raw_url: Option<String> = None;
    let mut title_attr: Option<String> = None;
    for (tag, _inner) in anchors(item) {
        let cls = find_attr(&tag, "class").unwrap_or_default();
        let href = find_attr(&tag, "href");
        let matched = cls.contains("mli-thumb-box") || cls.contains("ml-mask") || !cls.is_empty();
        if let Some(h) = href {
            if matched || raw_url.is_none() {
                raw_url = to_absolute_url(&h);
                if title_attr.is_none() { title_attr = find_attr(&tag, "title"); }
                if cls.contains("mli-thumb-box") { break; }
            }
        }
    }
    let url = raw_url?;
    let clean_path = url.replace(BASE_URL, "").trim_matches('/').to_string();
    let cp_lower = clean_path.to_lowercase();
    if clean_path.is_empty() || ["film", "anime", "series", "tvshow", "others", "animedonghua"].contains(&cp_lower.as_str()) {
        return None;
    }
    let title = first_inner_by_class(item, &["judul", "jt", "title"]).map(|(_, _, t)| t)
        .or_else(|| lower_text_of(item, "h2"))
        .or_else(|| lower_text_of(item, "h3"))
        .or_else(|| title_attr.clone())
        .or_else(|| img_of(item).filter(|_| false)) // placeholder
        .or_else(|| {
            let lower = item.to_lowercase();
            lower.find("<img").and_then(|p| {
                let gt = lower[p..].find('>')? + p;
                find_attr(&item[p..=gt], "title").or_else(|| find_attr(&item[p..=gt], "alt"))
            })
        })
        .unwrap_or_default();
    if title.is_empty() { return None; }
    let poster = img_of(item).and_then(|p| to_absolute_url(&p));
    let rating = first_inner_by_class(item, &["ratingValue", "mli-rating", "rating"]).map(|(_, _, t)| t).unwrap_or_default();
    let eps = first_inner_by_class(item, &["mli-eps", "eps", "quality", "episode"]).map(|(_, _, t)| t).unwrap_or_default();
    let meta_text = first_inner_by_class(item, &["mli-mvi", "info", "meta"]).map(|(_, _, t)| t).unwrap_or_default();
    let synopsis = first_inner_by_class(item, &["mli-desc"]).map(|(_, _, t)| t).unwrap_or_default();
    let url_lower = url.to_lowercase();
    let tipe = if url_lower.contains("/anime/") { "anime" }
        else if url_lower.contains("/series/") { "series" }
        else if url_lower.contains("/film/") { "film" }
        else if url_lower.contains("-episode-") { "episode" } else { "unknown" };
    let slug = clean_path.split('/').last().unwrap_or("").to_string();
    Some(json!({
        "title": title, "type": tipe,
        "rating": if rating.is_empty() { Value::Null } else { json!(rating) },
        "statusOrEpisode": if eps.is_empty() { Value::Null } else { json!(eps) },
        "meta": if meta_text.is_empty() { Value::Null } else { json!(meta_text) },
        "synopsis": if synopsis.is_empty() { Value::Null } else { json!(synopsis) },
        "poster": poster, "url": url, "slug": slug,
    }))
}

fn lower_text_of(frag: &str, tagname: &str) -> Option<String> {
    let open = format!("<{}", tagname);
    let close = format!("</{}>", tagname);
    let lower = frag.to_lowercase();
    let p = lower.find(&open)?;
    let gt = lower[p..].find('>')? + p;
    let end = lower[gt..].find(&close)? + gt;
    let t = text_of(&frag[gt..end]);
    if t.is_empty() { None } else { Some(t) }
}

/// split wrap blocks (div class containing 'movies-list-wrap')
fn wrap_blocks(html: &str, class_frag: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let needle = format!("class=\"", );
    let _ = needle;
    let mut i = 0usize;
    while let Some(p) = lower[i..].find(&format!("class=\"{}", class_frag)) {
        let abs = i + p;
        let tag_start = html[..abs].rfind('<').unwrap_or(abs);
        let gt = match lower[tag_start..].find('>') { Some(g) => tag_start + g + 1, None => break };
        // balanced div scan
        let mut depth = 1i32;
        let mut j = gt;
        let bytes = html.as_bytes();
        while j < bytes.len() && depth > 0 {
            if bytes[j] == b'<' {
                if html[j..].starts_with("<div") { depth += 1; j += 4; continue; }
                if html[j..].starts_with("</div") { depth -= 1; j += 5; continue; }
            }
            j += 1;
        }
        out.push(html[tag_start..j.min(html.len())].to_string());
        i = j.max(gt);
    }
    out
}

fn item_blocks_in(frag: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = frag.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("class=\"ml-item") {
        let abs = i + p;
        let tag_start = frag[..abs].rfind('<').unwrap_or(abs);
        let gt = match lower[tag_start..].find('>') { Some(g) => tag_start + g + 1, None => break };
        let next = lower[gt..].find("class=\"ml-item").map(|n| gt + n).unwrap_or(frag.len());
        out.push(frag[tag_start..next].to_string());
        i = next.max(gt);
    }
    if out.is_empty() {
        // fallback: articles
        let mut i = 0usize;
        while let Some(p) = lower[i..].find("<article") {
            let start = i + p;
            let Some(end) = lower[start..].find("</article>") else { break };
            out.push(frag[start..start + end + 10].to_string());
            i = start + end + 10;
        }
    }
    out
}

fn dedupe_push(list: &mut Vec<Value>, item: Value) {
    let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !list.iter().any(|x| x.get("url").and_then(|v| v.as_str()) == Some(url.as_str())) {
        list.push(item);
    }
}

fn parse_page_items(html: &str) -> Vec<Value> {
    let mut results = Vec::new();
    for block in item_blocks_in(html) {
        if let Some(c) = parse_card(&block) { dedupe_push(&mut results, c); }
    }
    results
}

fn extract_pagination(html: &str, current_page: i64) -> Value {
    let p = if current_page < 1 { 1 } else { current_page };
    let mut total_pages = p;
    let mut pages = vec![p];
    let a_re = regex::Regex::new(r"(?s)<li[^>]*>\s*<a[^>]*>([\s\S]*?)</a>").unwrap();
    for cap in a_re.captures_iter(html) {
        let t = text_of(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        if let Ok(n) = t.trim().parse::<i64>() {
            if n > total_pages { total_pages = n; }
            if !pages.contains(&n) { pages.push(n); }
        }
    }
    let has_next = total_pages > p || html.contains("class=\"next") || html.contains("»");
    json!({"currentPage": p, "totalPages": total_pages, "hasNextPage": has_next, "pages": pages})
}

fn extract_download_links(html: &str) -> Vec<Value> {
    let mut downloads = Vec::new();
    // per li within download containers
    let mut li_html: Vec<String> = Vec::new();
    for cls in ["download-eps", "download", "dlx"] {
        for block in wrap_blocks(html, cls) {
            let lower = block.to_lowercase();
            let mut i = 0;
            while let Some(p) = lower[i..].find("<li") {
                let start = i + p;
                let Some(end) = lower[start..].find("</li>") else { break };
                li_html.push(block[start..start + end + 5].to_string());
                i = start + end + 5;
            }
        }
        if !li_html.is_empty() { break; }
    }
    for li in &li_html {
        let quality = lower_text_of(li, "strong").unwrap_or_else(|| "Unknown".into());
        let mut links = Vec::new();
        for (tag, inner) in anchors(li) {
            let server = text_of(&inner);
            if let Some(href) = find_attr(&tag, "href") {
                if !server.is_empty() { links.push(json!({"server": server, "url": href})); }
            }
        }
        if !links.is_empty() { downloads.push(json!({"quality": quality, "links": links})); }
    }
    if downloads.is_empty() {
        let mut flat = Vec::new();
        for cls in ["download-eps", "download", "dlx"] {
            for block in wrap_blocks(html, cls) {
                for (tag, inner) in anchors(&block) {
                    let server = text_of(&inner);
                    if let Some(href) = find_attr(&tag, "href") {
                        if !server.is_empty() { flat.push(json!({"server": server, "url": href})); }
                    }
                }
            }
            if !flat.is_empty() { break; }
        }
        if !flat.is_empty() { downloads.push(json!({"quality": "Default", "links": flat})); }
    }
    downloads
}

async fn get_home() -> Result<Value, String> {
    let html = fetch_html(BASE_URL).await?;
    let mut sections = json!({
        "topSeries": [], "animeDonghuaTerbaru": [], "topFilm": [],
        "filmTerbaru": [], "asianDrama": [], "tvShow": [], "genres": [],
    });
    for wrap in wrap_blocks(&html, "movies-list-wrap") {
        let heading = first_inner_by_class(&wrap, &["ml-title"]).map(|(_, _, t)| t)
            .or_else(|| lower_text_of(&wrap, "h2"))
            .map(|t| t.to_lowercase()).unwrap_or_default();
        let mut items: Vec<Value> = Vec::new();
        for block in item_blocks_in(&wrap) {
            if let Some(c) = parse_card(&block) { dedupe_push(&mut items, c); }
        }
        if heading.contains("top 10 series") { sections["topSeries"] = json!(items); }
        else if heading.contains("anime donghua") { sections["animeDonghuaTerbaru"] = json!(items); }
        else if heading.contains("top 10 film") { sections["topFilm"] = json!(items); }
        else if heading.contains("film terbaru") { sections["filmTerbaru"] = json!(items); }
        else if heading.contains("jepang") || heading.contains("korea") || heading.contains("others") { sections["asianDrama"] = json!(items); }
        else if heading.contains("tv show") { sections["tvShow"] = json!(items); }
    }
    let mut genres: Vec<Value> = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0;
    while let Some(p) = lower[i..].find("<a ") {
        let a_abs = i + p;
        let gt = lower[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(lower.len());
        let end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(lower.len());
        let tag = &html[a_abs..gt];
        if tag.contains("/genre/") {
            let raw_text = text_of(&html[gt..end]);
            let re = regex::Regex::new(r"^(.+?)(?:\s*\((\d+)\))?$").unwrap();
            let (name, count) = match re.captures(&raw_text) {
                Some(c) => (
                    c.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or(raw_text.clone()),
                    c.get(2).and_then(|m| m.as_str().parse::<i64>().ok()),
                ),
                None => (raw_text.clone(), None),
            };
            let href = find_attr(tag, "href").unwrap_or_default();
            let slug = href.replace(BASE_URL, "").replace("/genre/", "").trim_matches('/').to_string();
            if !name.is_empty() && !slug.is_empty() && !genres.iter().any(|g| g.get("slug").and_then(|v| v.as_str()) == Some(slug.as_str())) {
                genres.push(json!({"name": name, "slug": slug, "count": count, "url": to_absolute_url(&href)}));
            }
        }
        i = end;
    }
    sections["genres"] = json!(genres);
    Ok(json!({"source": BASE_URL, "totalSections": 7, "data": sections}))
}

async fn search(query: &str, page: i64) -> Result<Value, String> {
    if query.trim().is_empty() { return Err("Kata kunci pencarian wajib diisi.".into()); }
    let p = if page < 1 { 1 } else { page };
    let url = if p > 1 {
        format!("{}/page/{}/?s={}", BASE_URL, p, urlencoding::encode(query.trim()))
    } else {
        format!("{}/?s={}", BASE_URL, urlencoding::encode(query.trim()))
    };
    let html = fetch_html(&url).await?;
    let results = parse_page_items(&html);
    let pagination = extract_pagination(&html, p);
    Ok(json!({
        "query": query.trim(), "page": p,
        "totalPages": pagination.get("totalPages").cloned().unwrap_or(json!(p)),
        "hasNextPage": pagination.get("hasNextPage").cloned().unwrap_or(json!(false)),
        "totalFound": results.len(), "results": results,
    }))
}

async fn get_series(slug_or_url: &str) -> Result<Value, String> {
    if slug_or_url.trim().is_empty() { return Err("Slug atau URL Series/Anime wajib diisi.".into()); }
    let mut target_url = slug_or_url.to_string();
    if !target_url.starts_with("http") {
        let clean = slug_or_url.trim_matches('/');
        target_url = if clean.contains('/') {
            format!("{}/{}/", BASE_URL, clean)
        } else {
            format!("{}/anime/{}/", BASE_URL, clean)
        };
    }
    let html = match fetch_html(&target_url).await {
        Ok(h) => h,
        Err(e) => {
            if target_url.contains("/anime/") && !slug_or_url.starts_with("http") {
                let fallback = target_url.replace("/anime/", "/series/");
                target_url = fallback.clone();
                fetch_html(&fallback).await?
            } else { return Err(e); }
        }
    };
    let title = first_inner_by_class(&html, &["judul"]).map(|(_, _, t)| t)
        .or_else(|| lower_text_of(&html, "h1"))
        .or_else(|| {
            lower_text_of(&html, "title").map(|t| {
                let t = regex::Regex::new(r"(?i)Sub Indo.*$").unwrap().replace(&t, "").to_string();
                regex::Regex::new(r"(?i)^Nonton\s+").unwrap().replace(&t, "").to_string()
            })
        }).unwrap_or_default();
    let poster = {
        let lower = html.to_lowercase();
        let mut found = None;
        for cls in ["mli-thumb-wrap", "poster", "thumb"] {
            let needle = format!("class=\"{}", cls);
            if let Some(p) = lower.find(&needle) {
                let seg_end = lower[p..].find("</div").map(|e| p + e).unwrap_or(html.len());
                let seg = &html[p..seg_end];
                if let Some(ip) = seg.to_lowercase().find("<img") {
                    let igt = seg[ip..].find('>').map(|g| ip + g + 1).unwrap_or(ip);
                    found = find_attr(&seg[ip..igt], "src");
                    break;
                }
            }
        }
        found.and_then(|f| to_absolute_url(&f))
    };
    let rating_value = first_inner_by_class(&html, &["ratingValue", "rating"]).map(|(_, _, t)| t).unwrap_or_default();
    let rating_count = first_inner_by_class(&html, &["ratingCount"]).map(|(_, _, t)| t).unwrap_or_default();
    let (season, season_url) = {
        let lower = html.to_lowercase();
        let mut s = String::new(); let mut u = Value::Null;
        let mut i = 0;
        while let Some(p) = lower[i..].find("<a ") {
            let a_abs = i + p;
            let gt = lower[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(lower.len());
            let end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(lower.len());
            let tag = &html[a_abs..gt];
            if tag.contains("/season/") {
                s = text_of(&html[gt..end]);
                u = find_attr(tag, "href").and_then(|h| to_absolute_url(&h)).map(|x| json!(x)).unwrap_or(Value::Null);
                break;
            }
            i = end;
        }
        (s, u)
    };
    let mut genres: Vec<Value> = Vec::new();
    {
        let lower = html.to_lowercase();
        let mut i = 0;
        while let Some(p) = lower[i..].find("<a ") {
            let a_abs = i + p;
            let gt = lower[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(lower.len());
            let end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(lower.len());
            let tag = &html[a_abs..gt];
            if tag.contains("rel=\"tag\"") && (tag.contains("itemprop=\"genre\"") || tag.contains("/genre/")) {
                let g = text_of(&html[gt..end]);
                if !g.is_empty() && !g.contains('(') && !genres.iter().any(|x| x.get("name").and_then(|v| v.as_str()) == Some(g.as_str())) {
                    genres.push(json!({"name": g, "url": find_attr(tag, "href").and_then(|h| to_absolute_url(&h))}));
                }
            }
            i = end;
        }
    }
    let mut synopsis = first_inner_by_class(&html, &["mli-desc", "sinopsis", "entry-content"]).map(|(_, _, t)| t).unwrap_or_default();
    if synopsis.starts_with("Sinopsis :") {
        synopsis = regex::Regex::new(r"(?i)^Sinopsis\s*:\s*").unwrap().replace(&synopsis, "").to_string();
    }
    let mut metadata = serde_json::Map::new();
    for (start, end, text) in class_blocks(&html, "mli-mvi") {
        let _ = (start, end);
        if text.contains(':') {
            let parts: Vec<&str> = text.splitn(2, ':').collect();
            if parts.len() == 2 {
                let key = clean_text(parts[0]).to_lowercase();
                let val = clean_text(parts[1]);
                if !key.is_empty() && !val.is_empty() { metadata.insert(key, json!(val)); }
            }
        }
    }
    // episodes
    let mut episodes: Vec<Value> = Vec::new();
    let mut ep_anchors: Vec<(String, String)> = Vec::new();
    {
        // .les-content a
        let les = wrap_blocks(&html, "les-content");
        if !les.is_empty() {
            ep_anchors = anchors(&les[0]);
        } else {
            // fallback: anchors with -episode-
            for (tag, inner) in anchors(&html) {
                if let Some(h) = find_attr(&tag, "href") {
                    if h.contains("-episode-") { ep_anchors.push((tag, inner)); }
                }
            }
        }
    }
    for (idx, (tag, inner)) in ep_anchors.iter().enumerate() {
        let Some(raw) = find_attr(tag, "href") else { continue };
        let Some(ep_url) = to_absolute_url(&raw) else { continue };
        let mut ep_title = text_of(inner);
        let slug = ep_url.replace(BASE_URL, "").trim_matches('/').to_string();
        if ep_title.is_empty() {
            ep_title = regex::Regex::new(r"(?i)episode[-_]?(\d+)").unwrap().captures(&slug)
                .and_then(|c| c.get(1)).map(|m| format!("Episode {}", m.as_str()))
                .unwrap_or_else(|| format!("Episode {}", idx + 1));
        }
        let ep_num = regex::Regex::new(r"(\d+)").unwrap().captures(&ep_title)
            .or_else(|| regex::Regex::new(r"(?i)episode[-_]?(\d+)").unwrap().captures(&slug))
            .and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok());
        let mut exists = false;
        if episodes.iter().any(|e| e.get("url").and_then(|v| v.as_str()) == Some(ep_url.as_str())) { exists = true; }
        if !exists {
            episodes.push(json!({"title": ep_title, "episodeNumber": ep_num, "url": ep_url, "slug": slug}));
        }
    }
    Ok(json!({
        "title": title,
        "rating": if rating_value.is_empty() { Value::Null } else { json!({"score": rating_value, "count": if rating_count.is_empty() { Value::Null } else { json!(rating_count) }}) },
        "season": if season.is_empty() { Value::Null } else { json!({"name": season, "url": season_url}) },
        "metadata": metadata, "genres": genres,
        "synopsis": if synopsis.is_empty() { Value::Null } else { json!(synopsis) },
        "poster": poster, "url": target_url,
        "totalEpisodes": episodes.len(), "episodes": episodes,
    }))
}

fn class_blocks(html: &str, cls: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let needle = format!("class=\"{}", cls);
    let mut i = 0usize;
    while let Some(p) = lower[i..].find(&needle) {
        let abs = i + p;
        let tag_start = html[..abs].rfind('<').unwrap_or(abs);
        let gt = match lower[tag_start..].find('>') { Some(g) => tag_start + g + 1, None => break };
        let end = lower[gt..].find("</").map(|e| gt + e).unwrap_or(html.len());
        out.push((gt, end, text_of(&html[gt..end])));
        i = end.max(gt);
    }
    out
}

async fn resolve_player(post_id: &str, nume_id: &str, ptype: &str, referer_url: &str) -> Result<(Option<String>, String), String> {
    if post_id.is_empty() || nume_id.is_empty() {
        return Err("postId dan numeId wajib diisi untuk resolve video player.".into());
    }
    let ajax_url = format!("{}/wp-admin/admin-ajax.php", BASE_URL);
    let payload = format!("action=player_ajax&post={}&nume={}&type={}", urlencoding::encode(post_id), urlencoding::encode(nume_id), urlencoding::encode(ptype));
    let res = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .build().map_err(|e| e.to_string())?
        .post(&ajax_url)
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
        .header("Referer", referer_url)
                    .header("X-Requested-With", "XMLHttpRequest")
        .body(payload)
        .send().await.map_err(|e| e.to_string())?;
    let raw_html = res.text().await.unwrap_or_default();
    let lower = raw_html.to_lowercase();
    let iframe_src = lower.find("<iframe").and_then(|p| {
        let gt = lower[p..].find('>')? + p;
        let tag = &raw_html[p..=gt];
        find_attr(tag, "src").or_else(|| find_attr(tag, "data-src"))
    }).and_then(|s| to_absolute_url(&s));
    Ok((iframe_src, raw_html.trim().to_string()))
}

async fn collect_player_options(html: &str, target_url: &str) -> Vec<Value> {
    let mut opts: Vec<Value> = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0;
    while let Some(p) = lower[i..].find("id=\"player-option") {
        let abs = i + p;
        let tag_start = html[..abs].rfind('<').unwrap_or(abs);
        let gt = lower[tag_start..].find('>').map(|g| tag_start + g + 1).unwrap_or(lower.len());
        let tag = &html[tag_start..gt];
        let end = lower[gt..].find("</").map(|e| gt + e).unwrap_or(lower.len());
        let server_name = text_of(&html[gt..end]);
        let post_id = find_attr(tag, "data-post").unwrap_or_default();
        let nume_id = find_attr(tag, "data-nume").unwrap_or_default();
        let ptype = find_attr(tag, "data-type").unwrap_or_else(|| "schtml".into());
        let opt_id = find_attr(tag, "id").unwrap_or_default();
        if !post_id.is_empty() && !nume_id.is_empty() {
            let dupe = opts.iter().any(|o| o.get("numeId").and_then(|v| v.as_str()) == Some(nume_id.as_str())
                && o.get("postId").and_then(|v| v.as_str()) == Some(post_id.as_str()));
            if !dupe {
                opts.push(json!({
                    "id": if opt_id.is_empty() { format!("player-option-{}", opts.len() + 1) } else { opt_id },
                    "name": if server_name.is_empty() { format!("Server {}", nume_id) } else { server_name },
                    "postId": post_id, "numeId": nume_id, "type": ptype,
                }));
            }
        }
        i = gt;
    }
    // .east_player_option
    for (start, end, _) in class_blocks(html, "east_player_option") {
        let tag_start = html[..start].rfind('<').unwrap_or(start);
        let tag = &html[tag_start..start];
        let post_id = find_attr(tag, "data-post").unwrap_or_default();
        let nume_id = find_attr(tag, "data-nume").unwrap_or_default();
        let ptype = find_attr(tag, "data-type").unwrap_or_else(|| "schtml".into());
        let opt_id = find_attr(tag, "id").unwrap_or_default();
        let _ = end;
        if !post_id.is_empty() && !nume_id.is_empty() {
            let dupe = opts.iter().any(|o| o.get("numeId").and_then(|v| v.as_str()) == Some(nume_id.as_str())
                && o.get("postId").and_then(|v| v.as_str()) == Some(post_id.as_str()));
            if !dupe {
                opts.push(json!({
                    "id": if opt_id.is_empty() { format!("player-option-{}", opts.len() + 1) } else { opt_id },
                    "name": format!("Server {}", nume_id),
                    "postId": post_id, "numeId": nume_id, "type": ptype,
                }));
            }
        }
    }
    // resolve in parallel
    let mut futs = Vec::new();
    for opt in &opts {
        let post = opt.get("postId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let nume = opt.get("numeId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let t = opt.get("type").and_then(|v| v.as_str()).unwrap_or("schtml").to_string();
        let target_url = target_url.to_string();
        futs.push(tokio::spawn(async move {
            resolve_player(&post, &nume, &t, &target_url).await.ok()
        }));
    }
    let mut streams = Vec::new();
    for (fut, opt) in futs.into_iter().zip(opts.into_iter()) {
        if let Ok(Some((iframe_src, raw_embed))) = fut.await {
            let mut s = opt.clone();
            s["iframeSrc"] = iframe_src.map(|x| json!(x)).unwrap_or(Value::Null);
            s["rawEmbed"] = json!(raw_embed);
            streams.push(s);
        }
    }
    streams
}

async fn get_film(slug_or_url: &str) -> Result<Value, String> {
    if slug_or_url.trim().is_empty() { return Err("Slug atau URL Film wajib diisi.".into()); }
    let mut target_url = slug_or_url.to_string();
    if !target_url.starts_with("http") {
        let clean = slug_or_url.trim_matches('/');
        target_url = format!("{}/film/{}/", BASE_URL, clean);
    }
    let html = fetch_html(&target_url).await?;
    let title = first_inner_by_class(&html, &["judul"]).map(|(_, _, t)| t)
        .or_else(|| lower_text_of(&html, "h1"))
        .or_else(|| lower_text_of(&html, "title").map(|t| {
            let t = regex::Regex::new(r"(?i)Sub Indo.*$").unwrap().replace(&t, "").to_string();
            regex::Regex::new(r"(?i)^Nonton\s+").unwrap().replace(&t, "").to_string()
        })).unwrap_or_default();
    let poster = img_of(&html).and_then(|p| to_absolute_url(&p));
    let rating_value = first_inner_by_class(&html, &["ratingValue", "rating"]).map(|(_, _, t)| t).unwrap_or_default();
    let rating_count = first_inner_by_class(&html, &["ratingCount"]).map(|(_, _, t)| t).unwrap_or_default();
    let mut genres: Vec<Value> = Vec::new();
    {
        let lower = html.to_lowercase();
        let mut i = 0;
        while let Some(p) = lower[i..].find("<a ") {
            let a_abs = i + p;
            let gt = lower[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(lower.len());
            let end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(lower.len());
            let tag = &html[a_abs..gt];
            if tag.contains("rel=\"tag\"") && (tag.contains("itemprop=\"genre\"") || tag.contains("/genre/")) {
                let g = text_of(&html[gt..end]);
                if !g.is_empty() && !g.contains('(') && !genres.iter().any(|x| x.get("name").and_then(|v| v.as_str()) == Some(g.as_str())) {
                    genres.push(json!({"name": g, "url": find_attr(tag, "href").and_then(|h| to_absolute_url(&h))}));
                }
            }
            i = end;
        }
    }
    let mut synopsis = first_inner_by_class(&html, &["mli-desc", "sinopsis", "entry-content"]).map(|(_, _, t)| t).unwrap_or_default();
    if synopsis.starts_with("Sinopsis :") {
        synopsis = regex::Regex::new(r"(?i)^Sinopsis\s*:\s*").unwrap().replace(&synopsis, "").to_string();
    }
    let streams = collect_player_options(&html, &target_url).await;
    let downloads = extract_download_links(&html);
    Ok(json!({
        "title": title,
        "rating": if rating_value.is_empty() { Value::Null } else { json!({"score": rating_value, "count": if rating_count.is_empty() { Value::Null } else { json!(rating_count) }}) },
        "genres": genres,
        "synopsis": if synopsis.is_empty() { Value::Null } else { json!(synopsis) },
        "poster": poster, "url": target_url,
        "streams": streams, "downloads": downloads,
    }))
}

async fn get_stream(episode_slug_or_url: &str) -> Result<Value, String> {
    if episode_slug_or_url.trim().is_empty() { return Err("Slug atau URL Episode wajib diisi.".into()); }
    let mut target_url = episode_slug_or_url.to_string();
    if !target_url.starts_with("http") {
        let clean = episode_slug_or_url.trim_matches('/');
        target_url = format!("{}/{}/", BASE_URL, clean);
    }
    let html = fetch_html(&target_url).await?;
    let title = lower_text_of(&html, "title").map(|t| {
        let t = regex::Regex::new(r"(?i)Sub Indo.*$").unwrap().replace(&t, "").to_string();
        regex::Regex::new(r"(?i)^Nonton\s+").unwrap().replace(&t, "").to_string()
    }).unwrap_or_default();
    let episode_number = regex::Regex::new(r"(?i)Episode\s*(\d+)").unwrap().captures(&title)
        .and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<i64>().ok());
    // navigation: prev (.nvs without rght/nvsc), all (.nvs.nvsc), next (.nvs.rght)
    let nav_from = |cls_frag: &str| -> Option<String> {
        let lower = html.to_lowercase();
        let needle = format!("class=\"{}", cls_frag);
        lower.find(&needle).and_then(|p| {
            let seg_end = lower[p..].find("</div").map(|e| p + e).unwrap_or(html.len());
            let seg = &html[p..seg_end];
            seg.to_lowercase().find("<a ").and_then(|ap| {
                let agt = seg.to_lowercase()[ap..].find('>')? + ap;
                find_attr(&seg[ap..=agt], "href")
            }).and_then(|h| to_absolute_url(&h))
        })
    };
    let navigation = json!({
        "prev": nav_from("nvs"),
        "allEpisodes": nav_from("nvs nvsc"),
        "next": nav_from("nvs rght"),
    });
    let streams = collect_player_options(&html, &target_url).await;
    let downloads = extract_download_links(&html);
    Ok(json!({
        "title": title, "episodeNumber": episode_number,
        "url": target_url, "navigation": navigation,
        "streams": streams, "downloads": downloads,
    }))
}

async fn browse_items(url: &str, page: i64, label_key: &str, label_val: &str) -> Result<Value, String> {
    let p = if page < 1 { 1 } else { page };
    let target = if p > 1 { format!("{}/page/{}/", url, p) } else { url.to_string() };
    let html = fetch_html(&target).await?;
    let items = parse_page_items(&html);
    let pagination = extract_pagination(&html, p);
    Ok(json!({
        label_key: label_val, "page": p,
        "totalPages": pagination.get("totalPages").cloned().unwrap_or(json!(p)),
        "hasNextPage": pagination.get("hasNextPage").cloned().unwrap_or(json!(false)),
        "totalFound": items.len(), "items": items,
    }))
}

const ACTIONS: &str = "home, search, series, film, stream, category, genre, genres";

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = { let a = pstr(&params, &["action"]); if a.is_empty() { pstr(&params, &["type"]) } else { a } }
        .trim().to_lowercase();
    if action.is_empty() { return bad(400, &format!("Parameter 'action' wajib: {}", ACTIONS)); }
    let page = ppage(&params, &["page"]);

    let result: Result<Value, (u16, String)> = (|| async {
        match action.as_str() {
            "home" => {
                let mut r = get_home().await.map_err(|e| (500u16, e))?;
                r["action"] = json!("home");
                Ok(r)
            }
            "search" => {
                let q = { let v = pstr(&params, &["query"]); if v.is_empty() { pstr(&params, &["q"]) } else { v } };
                if q.is_empty() { return Err((400, "Parameter 'query' wajib diisi untuk action=search".into())); }
                let mut r = search(&q, page).await.map_err(|e| (500, e))?;
                r["action"] = json!("search");
                Ok(r)
            }
            "series" | "anime" => {
                let target = { let v = pstr(&params, &["url"]); if v.is_empty() { pstr(&params, &["slug"]) } else { v } };
                let target = if target.is_empty() { pstr(&params, &["query"]) } else { target };
                if target.is_empty() { return Err((400, format!("Parameter 'url' atau 'slug' wajib diisi untuk action={}", action))); }
                let mut r = get_series(&target).await.map_err(|e| (500, e))?;
                r["action"] = json!(action);
                Ok(r)
            }
            "film" | "movie" => {
                let target = { let v = pstr(&params, &["url"]); if v.is_empty() { pstr(&params, &["slug"]) } else { v } };
                let target = if target.is_empty() { pstr(&params, &["query"]) } else { target };
                if target.is_empty() { return Err((400, format!("Parameter 'url' atau 'slug' wajib diisi untuk action={}", action))); }
                let mut r = get_film(&target).await.map_err(|e| (500, e))?;
                r["action"] = json!(action);
                Ok(r)
            }
            "stream" | "episode" => {
                let target = { let v = pstr(&params, &["url"]); if v.is_empty() { pstr(&params, &["slug"]) } else { v } };
                let target = if target.is_empty() { pstr(&params, &["query"]) } else { target };
                if target.is_empty() { return Err((400, format!("Parameter 'url' atau 'slug' wajib diisi untuk action={}", action))); }
                let mut r = get_stream(&target).await.map_err(|e| (500, e))?;
                r["action"] = json!(action);
                Ok(r)
            }
            "category" => {
                let cat = { let v = pstr(&params, &["category"]); if v.is_empty() { pstr(&params, &["cat"]) } else { v } };
                let cat = if cat.is_empty() { "film".to_string() } else { cat };
                let url = format!("{}/{}/", BASE_URL, cat.trim_matches('/'));
                let mut r = browse_items(&url, page, "category", &cat).await.map_err(|e| (500, e))?;
                r["action"] = json!("category");
                Ok(r)
            }
            "genre" => {
                let g = { let v = pstr(&params, &["genre"]); if v.is_empty() { pstr(&params, &["slug"]) } else { v } };
                if g.is_empty() { return Err((400, "Parameter 'genre' wajib diisi untuk action=genre".into())); }
                let clean = g.replace("/genre/", "").trim_matches('/').to_string();
                let url = format!("{}/genre/{}/", BASE_URL, clean);
                let mut r = browse_items(&url, page, "genre", &clean).await.map_err(|e| (500, e))?;
                r["action"] = json!("genre");
                Ok(r)
            }
            "genres" => {
                let home = get_home().await.map_err(|e| (500, e))?;
                let genres = home.pointer("/data/genres").cloned().unwrap_or(json!([]));
                let total = genres.as_array().map(|a| a.len()).unwrap_or(0);
                Ok(json!({"action": "genres", "totalGenres": total, "genres": genres}))
            }
            _ => Err((400, format!("Action tidak valid. Gunakan: {}", ACTIONS))),
        }
    })().await;

    match result {
        Ok(mut v) => {
            if let Some(o) = v.as_object_mut() { o.insert("status".into(), json!(true)); }
            Json(v).into_response()
        }
        Err((code, msg)) => bad(code, &msg),
    }
}

// Donghive — native conversion of api/anime/donghive.js
// Scraping donghive.vip: catalog, search, series detail, episode, Dailymotion m3u8 resolver.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://donghive.vip";
const RETRIES: usize = 3;

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

const UAS: [&str; 3] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];

fn ua(i: usize) -> &'static str { UAS[i % UAS.len()] }

async fn req(url: &str, referer: Option<&str>) -> Result<(u16, String), String> {
    let mut last_err = String::new();
    for i in 0..=RETRIES {
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent(ua(i))
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::limited(10));
        let mut rb = {
            let c = builder.build().map_err(|e| e.to_string())?;
            c.get(url)
                            .header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
                            .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        };
        if let Some(r) = referer { rb = rb.header("Referer", r); }
        let res = match rb.send().await {
            Ok(r) => r,
            Err(e) => { last_err = e.to_string(); continue; }
        };
        let status = res.status().as_u16();
        let txt = res.text().await.map_err(|e| e.to_string())?;
        let retryable = [403u16, 408, 425, 429, 500, 502, 503, 504, 520, 522, 524].contains(&status);
        if retryable && i < RETRIES {
            tokio::time::sleep(Duration::from_millis((1500u64 * 2u64.pow(i as u32)).min(10000))).await;
            last_err = format!("HTTP {}", status);
            continue;
        }
        return Ok((status, txt));
    }
    Err(last_err)
}

async fn fetch_html(url: &str, referer: Option<&str>) -> Result<String, String> {
    let (status, txt) = req(url, referer).await?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {} untuk {}", status, url)); }
    Ok(txt)
}

fn abs_url(u: &str) -> Option<String> {
    if u.is_empty() { return None; }
    if u.starts_with("http") { return Some(u.to_string()); }
    url::Url::parse(BASE).ok()?.join(u).ok().map(|x| x.to_string())
}

fn text_of(frag: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    re.replace_all(frag, "").split_whitespace().collect::<Vec<_>>().join(" ")
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

/// Split into (whole-anchor-tag, inner-html) pairs.
fn anchors(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("<a") {
        let start = i + p;
        // ensure <a followed by whitespace or '>'
        if !matches!(lower[start + 2..].chars().next(), Some(c) if c.is_whitespace() || c == '>') {
            i = start + 2; continue;
        }
        let Some(gt) = lower[start..].find('>') else { break };
        let tag = html[start..start + gt].to_string();
        let inner_start = start + gt + 1;
        let Some(close) = lower[inner_start..].find("</a>") else { break };
        out.push((tag, html[inner_start..inner_start + close].to_string()));
        i = inner_start + close + 4;
    }
    out
}

fn parse_card(article: &str) -> Option<Value> {
    let lower = article.to_lowercase();
    // first .bsx a[href], a.tip[href] or plain a[href]
    let mut link: Option<String> = None;
    let mut title_attr: Option<String> = None;
    for (tag, inner) in anchors(article) {
        let cls = find_attr(&tag, "class").unwrap_or_default().to_lowercase();
        let href = find_attr(&tag, "href");
        let Some(href) = href else { continue };
        let is_bsx = cls.contains("bsx") || cls.contains("tip");
        if is_bsx || link.is_none() {
            link = abs_url(&href);
            if title_attr.is_none() { title_attr = find_attr(&tag, "title"); }
            if is_bsx {
                // title from h2 inside
                let h2 = lower_text(&inner, "h2");
                title_attr = Some(h2.or(title_attr.clone()).unwrap_or_default());
                break;
            }
        }
    }
    let link = link?;
    let title = title_attr.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    let poster = {
        let lower = article.to_lowercase();
        lower.find("<img").and_then(|p| {
            let gt = lower[p..].find('>')? + p;
            let tag = &article[p..=gt];
            find_attr(tag, "data-src").or_else(|| find_attr(tag, "src"))
        })
    };
    let tipe = {
        let pat = "class=\"typez";
        article.find(pat).map(|p| {
            let gt = article[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
            let end = article[gt..].find("</").map(|e| gt + e).unwrap_or(article.len());
            text_of(&article[gt..end]).to_lowercase()
        }).or_else(|| {
            let pat = "class=\"epx";
            article.find(pat).map(|p| {
                let gt = article[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
                let end = article[gt..].find("</").map(|e| gt + e).unwrap_or(article.len());
                text_of(&article[gt..end]).to_lowercase()
            })
        }).filter(|s| !s.is_empty())
    };
    let sub = {
        let pat = "class=\"sb";
        article.find(pat).map(|p| {
            let gt = article[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
            let end = article[gt..].find("</").map(|e| gt + e).unwrap_or(article.len());
            text_of(&article[gt..end])
        }).filter(|s| !s.is_empty())
    };
    let slug = link.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
    Some(json!({
        "title": title,
        "url": link.clone(),
        "slug": slug,
        "poster": poster.and_then(|p| abs_url(&p)),
        "type": tipe,
        "sub": sub,
        "hot": article.to_lowercase().contains("hotbadge"),
    }))
}

fn lower_text(frag: &str, tagname: &str) -> Option<String> {
    let open = format!("<{}", tagname);
    let close = format!("</{}>", tagname);
    let lower = frag.to_lowercase();
    let p = lower.find(&open)?;
    let gt = lower[p..].find('>')? + p;
    let end = lower[gt..].find(&close)? + gt;
    let t = text_of(&frag[gt..end]);
    if t.is_empty() { None } else { Some(t) }
}

fn article_blocks(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("<article") {
        let start = i + p;
        let Some(end) = lower[start..].find("</article>") else { break };
        out.push(html[start..start + end + 10].to_string());
        i = start + end + 10;
    }
    out
}

async fn scrape_list_page(url: &str) -> Result<(Vec<Value>, Option<String>), String> {
    let html = fetch_html(url, None).await?;
    let items: Vec<Value> = article_blocks(&html).iter()
        .filter_map(|a| parse_card(a)).collect();
    // find next page link
    let link_re = regex::Regex::new(r#"href="([^"]*page/\d+[^"]*)""#).unwrap();
    let mut next: Option<String> = None;
    for cap in link_re.captures_iter(&html) {
        let u = abs_url(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        if let Some(u) = u { if next.is_none() || next.as_ref() != Some(&u) { next = Some(u); break; } }
    }
    Ok((items, next))
}

async fn scrape_catalog(max_pages: i64) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut url: Option<String> = Some(format!("{}/anime/?status=&type=&order=update", BASE));
    let max_pages = max_pages.clamp(1, 5);
    for page in 1..=max_pages {
        let Some(u) = url.clone() else { break };
        let parsed = scrape_list_page(&u).await;
        let Ok((items, next)) = parsed else { break };
        for it in items {
            let u0 = it.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !u0.is_empty() && seen.insert(u0) { out.push(it); }
        }
        url = if page < max_pages { next } else { None };
    }
    out
}

async fn scrape_series(series_url: &str) -> Result<Value, String> {
    let target_url = if series_url.starts_with("http") { series_url.to_string() }
        else { format!("{}/{}/", BASE, series_url.trim_matches('/')) };
    let html = fetch_html(&target_url, Some(&format!("{}/", BASE))).await?;

    let title = lower_text(&html, "h1")
        .or_else(|| {
            // og:title meta
            let pat = "property=\"og:title\"";
            html.find(pat).and_then(|p| {
                let tag_start = html[..p].rfind('<')?;
                let gt = html[tag_start..].find('>')? + tag_start;
                let tag = &html[tag_start..=gt];
                let c = find_attr(tag, "content")?;
                Some(regex::Regex::new(r"\s*-\s*Donghive$").unwrap().replace(&c, "").to_string())
            })
        }).unwrap_or_default();
    let poster = {
        let pat = "property=\"og:image\"";
        html.find(pat).and_then(|p| {
            let tag_start = html[..p].rfind('<')?;
            let gt = html[tag_start..].find('>')? + tag_start;
            find_attr(&html[tag_start..=gt], "content")
        }).or_else(|| {
            let lower = html.to_lowercase();
            lower.find("<img").and_then(|p| {
                let gt = lower[p..].find('>')? + p;
                find_attr(&html[p..=gt], "src")
            })
        })
    };
    let synopsis = {
        let mut s = String::new();
        for cls in ["entry-content", "synopsis", "desc"] {
            let pat = format!("class=\"{}", cls);
            if let Some(p) = html.find(&pat) {
                let gt = html[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
                let end = html[gt..].find("</").map(|e| gt + e).unwrap_or(html.len());
                s = text_of(&html[gt..end]);
                break;
            }
        }
        if s.is_empty() {
            let pat = "property=\"og:description\"";
            html.find(pat).and_then(|p| {
                let tag_start = html[..p].rfind('<')?;
                let gt = html[tag_start..].find('>')? + tag_start;
                find_attr(&html[tag_start..=gt], "content")
            }).unwrap_or_default()
        } else { s }
    };

    let mut genres = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0;
    while let Some(p) = lower[i..].find("<a ") {
        let a_abs = i + p;
        let gt = lower[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(lower.len());
        let end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(lower.len());
        let tag = &html[a_abs..gt];
        if tag.contains("rel=\"tag\"") && tag.contains("/genres/") {
            let g = text_of(&html[gt..end]);
            if !g.is_empty() && !genres.contains(&g) { genres.push(g); }
        }
        i = end;
    }

    // status from .spe text
    let status = {
        let pat = "class=\"spe";
        html.find(pat).and_then(|p| {
            let gt = html[p..].find('>').map(|g| p + g + 1)?;
            let end = html[gt..].find("</").map(|e| gt + e).unwrap_or(html.len());
            let t = text_of(&html[gt..end]);
            regex::Regex::new(r"Status:\s*([^\t\n]+)").unwrap().captures(&t)
                .and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string())
        })
    };
    let network = {
        let mut n = String::new();
        let mut i = 0;
        while let Some(p) = lower[i..].find("<a ") {
            let a_abs = i + p;
            let gt = lower[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(lower.len());
            let end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(lower.len());
            let tag = &html[a_abs..gt];
            if tag.contains("/network/") { n = text_of(&html[gt..end]); break; }
            i = end;
        }
        if n.is_empty() { None } else { Some(n) }
    };

    let mut episodes = Vec::new();
    // li[data-index] a[href]
    let li_re = regex::Regex::new(r#"(?si)<li[^>]*data-index[^>]*>[\s\S]*?</li>"#).unwrap();
    for li in li_re.find_iter(&html) {
        let li_html = li.as_str();
        for (tag, inner) in anchors(li_html) {
            let Some(href) = find_attr(&tag, "href") else { continue };
            let num = { let pat = "class=\"epl-num"; li_html.find(pat).map(|p| {
                let g = li_html[p..].find('>').map(|x| p + x + 1).unwrap_or(p);
                let e = li_html[g..].find("</").map(|x| g + x).unwrap_or(li_html.len());
                text_of(&li_html[g..e])
            }).unwrap_or_default() };
            let t = { let pat = "class=\"epl-title"; li_html.find(pat).map(|p| {
                let g = li_html[p..].find('>').map(|x| p + x + 1).unwrap_or(p);
                let e = li_html[g..].find("</").map(|x| g + x).unwrap_or(li_html.len());
                text_of(&li_html[g..e])
            }).unwrap_or_default() };
            let date = { let pat = "class=\"epl-date"; li_html.find(pat).map(|p| {
                let g = li_html[p..].find('>').map(|x| p + x + 1).unwrap_or(p);
                let e = li_html[g..].find("</").map(|x| g + x).unwrap_or(li_html.len());
                text_of(&li_html[g..e])
            }).unwrap_or_default() };
            if let Some(u) = abs_url(&href) {
                episodes.push(json!({
                    "number": num.parse::<f64>().ok(),
                    "title": if t.is_empty() { None } else { Some(t) },
                    "url": u,
                    "date": if date.is_empty() { None } else { Some(date) },
                }));
            }
            break; // first anchor per li
        }
    }

    Ok(json!({
        "title": title,
        "url": target_url,
        "poster": poster.and_then(|p| abs_url(&p)),
        "synopsis": synopsis,
        "genres": genres,
        "status": status,
        "network": network,
        "totalEpisodes": episodes.len(),
        "episodes": episodes,
    }))
}

async fn scrape_episode(ep_url: &str) -> Result<Value, String> {
    let target_url = if ep_url.starts_with("http") { ep_url.to_string() }
        else { format!("{}/{}/", BASE, ep_url.trim_matches('/')) };
    let html = fetch_html(&target_url, Some(&format!("{}/", BASE))).await?;
    let title = {
        let h1 = lower_text(&html, "h1");
        h1.or_else(|| lower_text(&html, "title")).unwrap_or_default()
    };
    let mut embed_url: Option<String> = None;
    for cls in ["pembed", "player-embed", "video-content"] {
        let pat = format!("class=\"{}", cls);
        if let Some(p) = html.find(&pat) {
            let gt = html[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
            let end = html[gt..].find("</div").map(|e| gt + e).unwrap_or(html.len());
            let seg = &html[gt..end];
            if let Some(ip) = seg.to_lowercase().find("<iframe") {
                let igt = seg[ip..].find('>').map(|g| ip + g + 1).unwrap_or(ip);
                let tag = &seg[ip..igt];
                if let Some(src) = find_attr(tag, "src") {
                    embed_url = Some(src.replace("&amp;", "&"));
                    break;
                }
            }
        }
    }
    if embed_url.is_none() {
        // any iframe
        let lower = html.to_lowercase();
        if let Some(ip) = lower.find("<iframe") {
            let igt = lower[ip..].find('>').map(|g| ip + g + 1).unwrap_or(ip);
            if let Some(src) = find_attr(&html[ip..igt], "src") { embed_url = Some(src.replace("&amp;", "&")); }
        }
    }
    let video_id = embed_url.as_ref().and_then(|u| {
        regex::Regex::new(r#"[?&]video=([A-Za-z0-9_-]+)"#).unwrap().captures(u)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
    });
    let slug = target_url.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
    let series_slug = regex::Regex::new(r"(?i)^(.+?)-(?:episode|movie|chapter|ova|special|preview)-")
        .unwrap().captures(&slug).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
    let series_url = series_slug.as_ref().map(|s| format!("{}/{}/", BASE, s));
    Ok(json!({
        "title": title,
        "url": target_url,
        "seriesUrl": series_url,
        "embedUrl": embed_url,
        "videoId": video_id,
        "provider": video_id.as_ref().map(|_| "Dailymotion"),
    }))
}

async fn resolve_dailymotion_stream(video_id: &str, embed_url: Option<&str>) -> Result<Value, String> {
    if video_id.is_empty() { return Err("Parameter 'videoId' wajib diisi".into()); }
    let mut page_urls: Vec<String> = Vec::new();
    if let Some(e) = embed_url { if !e.is_empty() { page_urls.push(e.to_string()); } }
    page_urls.push(format!("https://www.dailymotion.com/video/{}", video_id));

    let mut m3u8: Option<String> = None;
    for page_url in &page_urls {
        if let Ok((_, html)) = req(page_url, Some("https://www.dailymotion.com/")).await {
            let re = regex::Regex::new(r#"https?://cdndirector\.dailymotion\.com/[^"'\s<>]+\.m3u8[^"'\s<>]*"#).unwrap();
            let re2 = regex::Regex::new(r#"https?://[^"'\s<>]+\.m3u8[^"'\s<>]*"#).unwrap();
            m3u8 = re.find(&html).or_else(|| re2.find(&html)).map(|m| m.as_str().to_string());
            if m3u8.is_some() { break; }
        }
    }
    let m3u8 = m3u8.ok_or("Manifest m3u8 tidak ditemukan di embed Dailymotion.")?;

    let mut info = serde_json::Map::new();
    if let Ok((_, txt)) = req(&format!("https://api.dailymotion.com/video/{}?fields=id,title,duration,thumbnail_720_url", video_id), None).await {
        if let Ok(Value::Object(m)) = serde_json::from_str::<Value>(&txt) { info = m; }
    }

    let mut out = json!({
        "provider": "Dailymotion",
        "videoId": video_id,
        "pageUrl": format!("https://www.dailymotion.com/video/{}", info.get("id").and_then(|v| v.as_str()).unwrap_or(video_id)),
        "streamType": "hls",
        "streamUrl": m3u8.replace("&amp;", "&"),
    });
    if let Some(o) = out.as_object_mut() {
        for (k, v) in info { if !v.is_null() { o.insert(k, v); } }
    }
    Ok(out)
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action"]).trim().to_lowercase();
    let action = if action.is_empty() { "catalog".to_string() } else { action };

    if action == "catalog" || action == "latest" {
        let pages = {
            let p: i64 = pstr(&params, &["pages"]).parse().unwrap_or(1);
            p.clamp(1, 5)
        };
        let items = scrape_catalog(pages).await;
        return Json(json!({"status": true, "total": items.len(), "pages": pages, "result": items})).into_response();
    }

    let result: Result<Value, String> = match action.as_str() {
        "search" => {
            let q = { let v = pstr(&params, &["query"]); if v.is_empty() { pstr(&params, &["q"]) } else { v } };
            if q.is_empty() { return bad("Parameter 'query' wajib diisi untuk action=search"); }
            let url = format!("{}/?s={}", BASE, urlencoding::encode(&q));
            let (items, _) = match scrape_list_page(&url).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({"status": true, "query": q, "total": items.len(), "result": items}))
        }
        "series" | "detail" => {
            let target = { let v = pstr(&params, &["url"]); if v.is_empty() { pstr(&params, &["query"]) } else { v } };
            if target.is_empty() { return bad("Parameter 'url' wajib diisi (URL series Donghive)."); }
            let d = match scrape_series(&target).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({"status": true, "result": d}))
        }
        "episode" => {
            let target = { let v = pstr(&params, &["url"]); if v.is_empty() { pstr(&params, &["query"]) } else { v } };
            if target.is_empty() { return bad("Parameter 'url' wajib diisi (URL episode Donghive)."); }
            let ep = match scrape_episode(&target).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({"status": true, "result": ep}))
        }
        "stream" => {
            let mut vid = pstr(&params, &["videoId"]);
            let mut embed: Option<String> = None;
            if vid.is_empty() {
                let u = pstr(&params, &["url"]);
                if !u.is_empty() {
                    let ep = match scrape_episode(&u).await { Ok(v) => v, Err(e) => return server_err(&e) };
                    vid = ep.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    embed = ep.get("embedUrl").and_then(|v| v.as_str()).map(|s| s.to_string());
                }
            }
            if vid.is_empty() { return bad("Parameter 'videoId' atau 'url' episode wajib diisi untuk action=stream."); }
            let s = match resolve_dailymotion_stream(&vid, embed.as_deref()).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({"status": true, "result": s}))
        }
        _ => return bad(&format!("Action '{}' tidak valid. Pilihan: catalog, search, series, episode, stream", action)),
    };

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => server_err(&e),
    }
}

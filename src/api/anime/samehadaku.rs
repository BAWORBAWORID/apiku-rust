// Samehadaku — native conversion of api/anime/samehadaku.js
// samehadaku.li scraper: home, latest, search, detail, episode, listgenre, genre, listseason, season.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://samehadaku.li";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
    reqwest::Client::builder().timeout(Duration::from_secs(15))
        .user_agent(UA)
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(8))
        .build().unwrap()
}

async fn fetch_text(url: &str) -> Result<(u16, String), String> {
    let mut last = String::new();
    for attempt in 0..=2 {
        let res = client().get(url)
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                        .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
            .header("Referer", format!("{}/", BASE))
            .send().await;
        match res {
            Ok(r) => {
                let status = r.status().as_u16();
                let text = r.text().await.unwrap_or_default();
                return Ok((status, text));
            }
            Err(e) => {
                last = e.to_string();
                let timed_out = last.to_lowercase().contains("timeout") || last.to_lowercase().contains("timed out");
                if timed_out && attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(1200 * (attempt as u64 + 1))).await;
                    continue;
                }
                return Err(last);
            }
        }
    }
    Err(last)
}

fn abs_url(href: &str) -> String {
    if href.is_empty() { return String::new(); }
    if href.starts_with("http") { return href.to_string(); }
    if href.starts_with("//") { return format!("https:{}", href); }
    if href.starts_with('/') { return format!("{}{}", BASE, href); }
    format!("{}/{}", BASE, href)
}

fn decode_entities(s: &str) -> String {
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
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&apos;", "'").replace("&#8203;", "")
        .replace("&#8211;", "-").replace("&#8212;", "-").replace("&#039;", "'")
}

fn strip_tags(s: &str) -> String {
    let style = regex::Regex::new(r"(?is)<style[\s\S]*?</style>").unwrap();
    let script = regex::Regex::new(r"(?is)<script[\s\S]*?</script>").unwrap();
    let tags = regex::Regex::new(r"<[^>]+>").unwrap();
    let no_style = style.replace_all(s, " ").to_string();
    let no_script = script.replace_all(&no_style, " ").to_string();
    let s2 = tags.replace_all(&no_script, " ").to_string();
    s2.replace("&nbsp;", " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_slug(s: &str) -> String {
    let mut s = s.trim().to_string();
    if s.starts_with("http") {
        if let Ok(u) = url::Url::parse(&s) { s = u.path().to_string(); }
    }
    s.trim_start_matches('/').trim_end_matches('/').to_string()
}

fn slug_to_url(slug: &str) -> String {
    let slug = normalize_slug(slug);
    if slug.is_empty() { return format!("{}/", BASE); }
    if slug.starts_with("http") { return slug; }
    format!("{}/{}/", BASE, slug)
}

fn extract_img(block: &str) -> String {
    if let Some(m) = regex::Regex::new(r#"data-src="([^"]+)""#).unwrap().captures(block) {
        return m.get(1).map(|c| c.as_str().to_string()).unwrap_or_default();
    }
    if let Some(m) = regex::Regex::new(r#"src="([^"]+)""#).unwrap().captures(block) {
        let v = m.get(1).map(|c| c.as_str()).unwrap_or("");
        if v.starts_with("data:image") {
            if let Some(m2) = regex::Regex::new(r#"data-src="([^"]+)""#).unwrap().captures(block) {
                return m2.get(1).map(|c| c.as_str().to_string()).unwrap_or_default();
            }
        }
        return v.to_string();
    }
    String::new()
}

fn build_paged_url(base: &str, page: i64) -> String {
    let b = if base.ends_with('/') { base.to_string() } else { format!("{}/", base) };
    if page <= 1 { b } else { format!("{}page/{}/", b, page) }
}

fn waf_check(status: u16, text: &str, msg: &str) -> Result<(), String> {
    if status == 403 || text.contains("403 Forbidden") { return Err(msg.to_string()); }
    Ok(())
}

// ═══ LATEST / CARD LIST PARSER ═══
fn parse_card_list(html: &str, url: &str, list_type: &str) -> Value {
    let art_re = regex::Regex::new(r#"(?s)<article class="bs"[\s\S]*?</article>"#).unwrap();
    let mut items = Vec::new();
    for b in art_re.find_iter(html) {
        let b = b.as_str();
        let href = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*itemprop="url""#).unwrap().captures(b)
            .or_else(|| regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*class="tip""#).unwrap().captures(b))
            .or_else(|| regex::Regex::new(r#"<a[^>]*href="([^"]+)""#).unwrap().captures(b))
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let title = regex::Regex::new(r#"(?s)<h2[^>]*itemprop="headline"[^>]*>([\s\S]*?)</h2>"#).unwrap().captures(b)
            .or_else(|| regex::Regex::new(r#"title="([^"]+)""#).unwrap().captures(b))
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let epx = regex::Regex::new(r#"(?s)<span class="epx">([\s\S]*?)</span>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let typez = regex::Regex::new(r#"(?s)<div class="typez[^"]*">([\s\S]*?)</div>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let sb = regex::Regex::new(r#"(?s)<span class="sb[^"]*">([\s\S]*?)</span>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let img_block = regex::Regex::new(r#"<img[^>]*>"#).unwrap().captures(b)
            .and_then(|c| c.get(0)).map(|m| m.as_str()).unwrap_or("");
        let img = extract_img(img_block);
        let h2alt = regex::Regex::new(r#"(?s)<div class="tt">[\s\S]*?<h2[^>]*>([\s\S]*?)</h2>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let t = decode_entities(&strip_tags(if title.is_empty() { &h2alt } else { &title }));
        if href.is_empty() { continue; }
        if t.is_empty() && !href.contains("samehadaku.li") { continue; }
        items.push(json!({
            "title": t, "href": href, "url": abs_url(&href),
            "episode": decode_entities(&strip_tags(&epx)),
            "type": decode_entities(&strip_tags(&typez)),
            "sub": decode_entities(&strip_tags(&sb)),
            "poster": abs_url(&img),
        }));
    }
    let next = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*class="r"[^>]*>Next"#).unwrap().captures(html)
        .or_else(|| regex::Regex::new(r#"<a[^>]*href="([^"]+page/2/)"[^>]*>"#).unwrap().captures(html))
        .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
    json!({
        "source": url, "type": list_type, "count": items.len(),
        "items": items.into_iter().take(80).collect::<Vec<_>>(),
        "next": if next.is_empty() { String::new() } else { abs_url(&next) },
    })
}

// ═══ ANIME DETAIL ═══
fn parse_anime(html: &str, url: &str) -> Value {
    let grab = |re: &str| -> String {
        regex::Regex::new(re).ok().and_then(|r| r.captures(html)).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default()
    };
    let grab_multi = |res: &[&str]| -> String {
        for re in res {
            if let Some(s) = grab(re).non_empty() { return s; }
        }
        String::new()
    };
    let title = grab_multi(&[
        r#"(?s)<h1 class="entry-title"[^>]*>([\s\S]*?)</h1>"#,
        r#"(?s)<h1[^>]*>([\s\S]*?)</h1>"#,
        r#"(?s)<title>([\s\S]*?)</title>"#,
    ]);
    let clean_title = decode_entities(&strip_tags(&title));
    let alter = grab(r#"(?s)<span class="alter">([\s\S]*?)</span>"#);
    let poster_block = grab(r#"(?s)<div class="thumb"[^>]*>[\s\S]*?</div>"#);
    let poster_img = extract_img(&poster_block);
    let poster = if poster_img.is_empty() { grab(r#"<meta property="og:image"[^>]*content="([^"]+)""#) } else { poster_img };
    let rating = grab_multi(&[
        r#"(?s)<div class="rating">[\s\S]*?<strong>Rating ([^<]+)</strong>"#,
        r#"<meta itemprop="ratingValue"[^>]*content="([^"]+)""#,
    ]);
    let rating_count = grab(r#"<meta itemprop="ratingCount"[^>]*content="([^"]+)""#);
    let bookmark = grab(r#"<div class="bmc">([^<]+)</div>"#);
    let mindesc = grab(r#"(?s)<div class="mindesc">([\s\S]*?)</div>"#);
    let synopsis = grab_multi(&[
        r#"(?s)<div class="entry-content"[^>]*itemprop="description"[^>]*>([\s\S]*?)</div>"#,
        r#"(?s)<div class="desc[^"]*">([\s\S]*?)</div>"#,
    ]);

    let spe_block = grab_multi(&[
        r#"(?s)<div class="spe">([\s\S]*?)</div>\s*<div class="genxed">"#,
        r#"(?s)<div class="spe">([\s\S]*?)</div>"#,
    ]);
    let mut info = serde_json::Map::new();
    let re_info = regex::Regex::new(r#"(?s)<span><b>([^:]+):</b>\s*([\s\S]*?)</span>"#).unwrap();
    for mm in re_info.captures_iter(&spe_block) {
        let key = decode_entities(&strip_tags(mm.get(1).map(|m| m.as_str()).unwrap_or("")))
            .trim().to_lowercase().replace(' ', "_");
        let val = mm.get(2).map(|m| m.as_str()).unwrap_or("");
        let mut links = Vec::new();
        let re_a = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
        for aa in re_a.captures_iter(val) {
            links.push(json!({
                "name": decode_entities(&strip_tags(aa.get(2).map(|m| m.as_str()).unwrap_or(""))),
                "href": aa.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                "url": abs_url(aa.get(1).map(|m| m.as_str()).unwrap_or("")),
            }));
        }
        let text = decode_entities(&strip_tags(val));
        if !links.is_empty() { info.insert(key, json!({"text": text, "links": links})); }
        else { info.insert(key, json!(text)); }
    }

    let mut genres = Vec::new();
    let genxed = grab(r#"(?s)<div class="genxed">([\s\S]*?)</div>"#);
    let re_g = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*rel="tag"[^>]*>([^<]+)</a>"#).unwrap();
    for mm in re_g.captures_iter(&genxed) {
        genres.push(json!({
            "name": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
            "href": mm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
            "url": abs_url(mm.get(1).map(|m| m.as_str()).unwrap_or("")),
        }));
    }
    let mut tags = Vec::new();
    let tag_block = grab(r#"(?s)<div class="bottom tags">([\s\S]*?)</div>"#);
    let re_t = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
    for mm in re_t.captures_iter(&tag_block) {
        tags.push(json!({
            "name": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
            "href": mm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
            "url": abs_url(mm.get(1).map(|m| m.as_str()).unwrap_or("")),
        }));
    }

    let mut chars = Vec::new();
    let cv_re = regex::Regex::new(
        r#"(?s)<div class="cvitem">[\s\S]*?<span class="charname">([\s\S]*?)</span>[\s\S]*?<span class="charrole">([\s\S]*?)</span>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>[\s\S]*?<span class="charrole">([\s\S]*?)</span>"#).unwrap();
    for mm in cv_re.captures_iter(html) {
        chars.push(json!({
            "character": decode_entities(&strip_tags(mm.get(1).map(|m| m.as_str()).unwrap_or(""))),
            "role": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
            "actor_href": mm.get(3).map(|m| m.as_str().to_string()).unwrap_or_default(),
            "actor_url": abs_url(mm.get(3).map(|m| m.as_str()).unwrap_or("")),
            "actor": decode_entities(&strip_tags(mm.get(4).map(|m| m.as_str()).unwrap_or(""))),
            "actor_role": decode_entities(&strip_tags(mm.get(5).map(|m| m.as_str()).unwrap_or(""))),
        }));
    }
    if chars.is_empty() {
        let re_c = regex::Regex::new(
            r#"(?s)<div class="cvsubitem cvchar">[\s\S]*?<span class="charname">([^<]+)</span>[\s\S]*?<span class="charrole">([^<]+)</span>"#).unwrap();
        for mm in re_c.captures_iter(html) {
            chars.push(json!({
                "character": decode_entities(&strip_tags(mm.get(1).map(|m| m.as_str()).unwrap_or(""))),
                "role": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
            }));
        }
    }

    let mut episodes = Vec::new();
    let list_block = grab_multi(&[
        r#"(?s)<div class="eplister">([\s\S]*?)</ul>"#,
        r#"(?s)<ul>[\s\S]*?<li data-index="1">[\s\S]*?</ul>"#,
    ]);
    let src = if list_block.is_empty() { html } else { &list_block };
    let re_e = regex::Regex::new(
        r#"(?s)<li[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)</div>[\s\S]*?<div class="epl-title">([^<]+)</div>[\s\S]*?<div class="epl-sub">[\s\S]*?<span[^>]*>([^<]+)</span>[\s\S]*?<div class="epl-date">([^<]+)</div>"#).unwrap();
    for mm in re_e.captures_iter(src) {
        episodes.push(json!({
            "href": mm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
            "url": abs_url(mm.get(1).map(|m| m.as_str()).unwrap_or("")),
            "episode": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
            "title": decode_entities(&strip_tags(mm.get(3).map(|m| m.as_str()).unwrap_or(""))),
            "sub": decode_entities(&strip_tags(mm.get(4).map(|m| m.as_str()).unwrap_or(""))),
            "date": decode_entities(&strip_tags(mm.get(5).map(|m| m.as_str()).unwrap_or(""))),
        }));
    }
    if episodes.is_empty() {
        let re_e2 = regex::Regex::new(r#"(?s)<a[^>]*href="([^"]*episode[^"]*)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)</div>"#).unwrap();
        for mm in re_e2.captures_iter(html) {
            episodes.push(json!({
                "href": mm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                "url": abs_url(mm.get(1).map(|m| m.as_str()).unwrap_or("")),
                "episode": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
            }));
        }
    }

    let banner = grab(r#"(?s)<div class="inepcx">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>"#);
    let screenshot = grab(r#"<meta property="og:image"[^>]*content="([^"]+)""#);
    json!({
        "source": url, "type": "anime", "title": clean_title,
        "alternative": decode_entities(&strip_tags(&alter)),
        "poster": abs_url(&poster),
        "rating": decode_entities(&strip_tags(&rating)),
        "rating_count": decode_entities(&strip_tags(&rating_count)),
        "followers": decode_entities(&strip_tags(&bookmark)),
        "description": decode_entities(&strip_tags(&mindesc)),
        "synopsis": decode_entities(&strip_tags(&synopsis)),
        "info": info, "genres": genres, "tags": tags,
        "characters": chars, "episodes": episodes,
        "episodes_count": episodes.len(),
        "latest_url": if banner.is_empty() { String::new() } else { abs_url(&banner) },
        "screenshot": if screenshot.is_empty() { String::new() } else { abs_url(&screenshot) },
    })
}

trait NE { fn non_empty(self) -> Option<String>; }
impl NE for String { fn non_empty(self) -> Option<String> { if self.is_empty() { None } else { Some(self) } } }

// ═══ EPISODE ═══
fn parse_episode(html: &str, url: &str) -> Value {
    let grab = |re: &str| -> String {
        regex::Regex::new(re).ok().and_then(|r| r.captures(html)).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default()
    };
    let grab_multi = |res: &[&str]| -> String {
        for re in res { if let Some(s) = grab(re).non_empty() { return s; } }
        String::new()
    };
    let title = grab_multi(&[r#"(?s)<title>([\s\S]*?)</title>"#, r#"(?s)<h1[^>]*>([\s\S]*?)</h1>"#]);
    let clean_title = decode_entities(&strip_tags(&title));
    let canonical = grab(r#"<link rel="canonical"[^>]*href="([^"]+)""#);
    let thumb = grab(r#"<meta property="og:image"[^>]*content="([^"]+)""#);

    let mut iframe = grab_multi(&[
        r#"(?i)<IFRAME[^>]*SRC="([^"]+)"[^>]*>"#,
        r#"(?i)<iframe[^>]*src="([^"]+)"[^>]*>"#,
        r#"(?i)data-litespeed-src="([^"]+)""#,
    ]);
    if iframe.is_empty() {
        iframe = grab(r#"(?is)<div class="player-embed"[^>]*>[\s\S]*?SRC="([^"]+)""#);
    }
    iframe = decode_entities(&iframe).trim().to_string();

    let mut streams = Vec::new();
    let btn_re = regex::Regex::new(r#"(?is)<button[^>]*class="[^"]*aspd-server[^"]*"[^>]*>[\s\S]*?</button>"#).unwrap();
    for b in btn_re.find_iter(html) {
        let b = b.as_str();
        let s_name = regex::Regex::new(r#"data-label="([^"]+)""#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
            .unwrap_or_else(|| strip_tags(b));
        let s_url = regex::Regex::new(r#"data-url="([^"]+)""#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let mut s_embed = regex::Regex::new(r#"data-embed="([^"]+)""#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        if !s_embed.is_empty() {
            if let Ok(decoded) = base64_decode_utf8(&s_embed) {
                if let Some(m) = regex::Regex::new(r#"(?i)src="([^"]+)""#).unwrap().captures(&decoded) {
                    s_embed = m.get(1).map(|x| x.as_str().to_string()).unwrap_or(s_embed);
                }
            }
        }
        let final_url = if s_url.is_empty() { s_embed.clone() } else { s_url.clone() };
        if !final_url.is_empty() {
            streams.push(json!({
                "server": decode_entities(&s_name),
                "url_stream": final_url, "embed_url": final_url,
            }));
        }
    }
    if streams.is_empty() && !iframe.is_empty() {
        streams.push(json!({"server": "Default", "url_stream": iframe, "embed_url": iframe}));
    }

    let mut download: Vec<Value> = Vec::new();
    let tera = grab_multi(&[
        r#"(?i)<a[^>]*href="(https://terabox\.com[^"]+)"[^>]*>"#,
        r#"(?i)<a[^>]*href="(https://www\.terabox[^"]+)"[^>]*>"#,
    ]);
    if !tera.is_empty() { download.push(json!({"label": "Terabox", "href": tera.clone(), "url": tera})); }
    let dl_re = regex::Regex::new(
        r#"(?s)<a[^>]*href="([^"]+)"[^>]*>\s*<div class="icol"><i[^>]*></i>\s*<span>Download</span></div>\s*</a>"#).unwrap();
    for mm in dl_re.captures_iter(html) {
        let href = mm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        download.push(json!({"label": "Download", "href": href, "url": abs_url(&href)}));
    }
    let dl_blocks = regex::Regex::new(r#"(?s)<div class="soraddlx[^"]*"[\s\S]*?</div>\s*</div>"#).unwrap();
    for dlb in dl_blocks.find_iter(html) {
        let dlb = dlb.as_str();
        let res_title = decode_entities(&strip_tags(&grab_in(dlb, r#"(?s)<div class="sorattlx">([\s\S]*?)</div>"#)));
        let mut links = Vec::new();
        let link_re = regex::Regex::new(r#"(?s)<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#).unwrap();
        for lm in link_re.captures_iter(dlb) {
            links.push(json!({
                "host": decode_entities(&strip_tags(lm.get(2).map(|m| m.as_str()).unwrap_or(""))),
                "url": lm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
            }));
        }
        if !links.is_empty() {
            download.push(json!({"resolution": if res_title.is_empty() { "Direct Download".to_string() } else { res_title }, "links": links}));
        }
    }

    let mut nav = serde_json::Map::new();
    let all_m = grab(r#"(?s)<div class="nvs nvsc"><a[^>]*href="([^"]+)"[^>]*>[\s\S]*?All Episodes"#);
    if !all_m.is_empty() { nav.insert("all_episodes".into(), json!(abs_url(&all_m))); }
    let next_m = grab_multi(&[
        r#"<a[^>]*aria-label="next"[^>]*href="([^"]+)""#,
        r#"<a[^>]*href="([^"]+)"[^>]*rel="next""#,
    ]);
    if !next_m.is_empty() { nav.insert("next".into(), json!(abs_url(&next_m))); }
    let prev_m = grab(r#"(?s)<a[^>]*href="([^"]+)"[^>]*>\s*<span class="tex">\s*Prev"#);
    if !prev_m.is_empty() { nav.insert("prev".into(), json!(abs_url(&prev_m))); }

    let mut anime_info = serde_json::Map::new();
    let info_block = grab(r#"(?s)<h2[^>]*itemprop="partOfSeries"[^>]*>([\s\S]*?)</h2>"#);
    if !info_block.is_empty() { anime_info.insert("title".into(), json!(decode_entities(&strip_tags(&info_block)))); }
    let rating_a = grab(r#"(?s)<div class="rating">[\s\S]*?<strong>Rating ([^<]+)</strong>"#);
    if !rating_a.is_empty() { anime_info.insert("rating".into(), json!(decode_entities(&strip_tags(&rating_a)))); }
    let anime_link = grab_multi(&[
        r#"(?s)<div class="nvs nvsc"><a[^>]*href="([^"]+)"[^>]*>[\s\S]*?All Episodes"#,
        r#"(?s)<a[^>]*href="(https://samehadaku\.li/anime/[^"]+)"[^>]*>[\s\S]*?All Episodes"#,
    ]);
    if !anime_link.is_empty() { anime_info.insert("anime_url".into(), json!(abs_url(&anime_link))); }

    let mut related = Vec::new();
    let rel_block = grab(r#"(?s)<div class="bixbox">[\s\S]*?<h3>Related Episodes</h3>[\s\S]*?<div class="listupd">([\s\S]*?)</div>\s*</div>\s*</div>"#);
    if !rel_block.is_empty() {
        let re_r = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"[^>]*>"#).unwrap();
        for mm in re_r.captures_iter(&rel_block) {
            related.push(json!({
                "title": decode_entities(&strip_tags(mm.get(2).map(|m| m.as_str()).unwrap_or(""))),
                "href": mm.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                "url": abs_url(mm.get(1).map(|m| m.as_str()).unwrap_or("")),
            }));
        }
    }

    let desc = grab(r#"(?s)<div class="bixbox infx">[\s\S]*?<p>([\s\S]*?)</p>"#);
    let stream_url = streams.first().and_then(|s| s.get("url_stream")).and_then(|v| v.as_str())
        .unwrap_or(&iframe).to_string();
    json!({
        "source": if canonical.is_empty() { url.to_string() } else { canonical },
        "type": "episode", "title": clean_title,
        "thumbnail": if thumb.is_empty() { String::new() } else { abs_url(&thumb) },
        "stream_url": stream_url, "embed_url": stream_url, "video_embed": iframe,
        "current_stream": stream_url,
        "streams": streams, "download": download,
        "navigation": Value::Object(nav), "anime": Value::Object(anime_info),
        "description": decode_entities(&strip_tags(&desc)),
        "related": related,
    })
}

fn grab_in(frag: &str, re: &str) -> String {
    regex::Regex::new(re).ok().and_then(|r| r.captures(frag)).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default()
}

fn base64_decode_utf8(s: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

// ═══ SEARCH ═══
fn parse_search(html: &str, url: &str) -> Value {
    let art_re = regex::Regex::new(r#"(?s)<article class="bs"[\s\S]*?</article>"#).unwrap();
    let mut items = Vec::new();
    for b in art_re.find_iter(html) {
        let b = b.as_str();
        let href = regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*itemprop="url""#).unwrap().captures(b)
            .or_else(|| regex::Regex::new(r#"<a[^>]*href="([^"]+)"[^>]*class="tip""#).unwrap().captures(b))
            .or_else(|| regex::Regex::new(r#"<a[^>]*href="([^"]+)""#).unwrap().captures(b))
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let h2 = regex::Regex::new(r#"(?s)<h2[^>]*itemprop="headline"[^>]*>([\s\S]*?)</h2>"#).unwrap().captures(b)
            .or_else(|| regex::Regex::new(r#"(?s)<div class="tt">[\s\S]*?<h2[^>]*>([\s\S]*?)</h2>"#).unwrap().captures(b))
            .or_else(|| regex::Regex::new(r#"title="([^"]+)""#).unwrap().captures(b))
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let epx = regex::Regex::new(r#"<span class="epx">([^<]+)</span>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let typez = regex::Regex::new(r#"<div class="typez[^"]*">([^<]+)</div>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let sb = regex::Regex::new(r#"<span class="sb[^"]*">([^<]+)</span>"#).unwrap().captures(b)
            .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
        let img_block = regex::Regex::new(r#"<img[^>]*>"#).unwrap().captures(b)
            .and_then(|c| c.get(0)).map(|m| m.as_str()).unwrap_or("");
        let img = extract_img(img_block);
        let title = decode_entities(&strip_tags(&h2));
        if href.is_empty() || title.is_empty() { continue; }
        items.push(json!({
            "title": title, "href": href, "url": abs_url(&href),
            "episode": decode_entities(&strip_tags(&epx)),
            "type": decode_entities(&strip_tags(&typez)),
            "sub": decode_entities(&strip_tags(&sb)),
            "poster": abs_url(&img),
        }));
    }
    let q = regex::Regex::new(r"<title>You searched for ([^<]+) - Samehadaku</title>").unwrap().captures(html)
        .or_else(|| regex::Regex::new(r#"<meta property="og:title"[^>]*content="You searched for ([^"]+) -"#).unwrap().captures(html))
        .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
    let canonical = regex::Regex::new(r#"<meta property="og:url"[^>]*content="([^"]+)""#).unwrap().captures(html)
        .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_else(|| url.to_string());
    json!({
        "source": canonical, "type": "search",
        "query": decode_entities(&strip_tags(&q)),
        "count": items.len(), "items": items,
    })
}

// ═══ ACTIONS ═══
async fn scrape_home(page: i64) -> Result<Value, String> {
    let url = build_paged_url(&format!("{}/", BASE), page);
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, "Layanan Samehadaku sedang dibatasi WAF, silakan coba lagi beberapa saat.")?;
    let mut data = parse_card_list(&text, &url, "latest");
    data["type"] = json!("home");
    data["page"] = json!(page);
    Ok(data)
}

async fn scrape_latest(page: i64) -> Result<Value, String> {
    let url = build_paged_url(&format!("{}/", BASE), page);
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, "Layanan Samehadaku sedang dibatasi WAF, silakan coba lagi beberapa saat.")?;
    let mut data = parse_card_list(&text, &url, "latest");
    data["page"] = json!(page);
    Ok(data)
}

async fn search_anime(query: &str) -> Result<Value, String> {
    let q = query.trim();
    if q.is_empty() { return Err("Parameter 'query' wajib diisi untuk pencarian anime".into()); }
    let url = format!("{}/?s={}", BASE, urlencoding::encode(q));
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, "Layanan Samehadaku sedang dibatasi WAF, silakan coba lagi beberapa saat.")?;
    Ok(parse_search(&text, &url))
}

async fn scrape_anime(raw: &str) -> Result<Value, String> {
    let mut url = raw.trim().to_string();
    if !url.starts_with("http") {
        let s = if url.contains("/anime/") { url.clone() } else { format!("anime/{}", normalize_slug(&url)) };
        url = slug_to_url(&s);
    }
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, "Gagal mengambil detail anime (WAF 403), silakan coba lagi nanti.")?;
    Ok(parse_anime(&text, &url))
}

async fn scrape_episode(raw: &str) -> Result<Value, String> {
    let mut url = raw.trim().to_string();
    if !url.starts_with("http") {
        let mut s = normalize_slug(&url);
        if !s.contains("episode") { s = format!("{}-episode-1-subtitle-indonesia", s); }
        url = format!("{}/{}/", BASE, s);
    }
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, "Gagal mengambil episode anime (WAF 403), silakan coba lagi nanti.")?;
    Ok(parse_episode(&text, &url))
}

async fn list_filters(prefix: &str, kind: &str) -> Result<Value, String> {
    let url = format!("{}/anime/", BASE);
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, &format!("Gagal mengambil daftar {} (WAF 403)", kind))?;
    let re = regex::Regex::new(&format!(
        r#"<input[^>]*id="{}-([^"]+)"[^>]*value="([^"]+)"[^>]*>\s*<label[^>]*>([^<]+)</label>"#, prefix)).unwrap();
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for m in re.captures_iter(&text) {
        let slug = m.get(2).map(|x| x.as_str().trim().to_string()).unwrap_or_default();
        if !seen.insert(slug.clone()) { continue; }
        let label = decode_entities(&strip_tags(m.get(3).map(|x| x.as_str()).unwrap_or("")));
        items.push(json!({
            "name": label, "slug": slug.clone(),
            "href": format!("/{}/{}/", prefix, slug),
            "url": format!("{}/{}/{}/", BASE, prefix, slug),
        }));
    }
    if kind == "genre" {
        items.sort_by(|a, b| a.get("name").and_then(|v| v.as_str()).unwrap_or("")
            .cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or("")));
    }
    Ok(json!({"source": url, "type": format!("list{}", kind), "count": items.len(), "items": items}))
}

async fn filter_by(name: &str, kind: &str, page: i64) -> Result<Value, String> {
    let slug = name.trim().to_lowercase().replace(' ', "-");
    if slug.is_empty() { return Err(format!("Parameter '{}' wajib diisi", kind)); }
    let base = format!("{}/{}/{}/", BASE, kind, slug);
    let url = build_paged_url(&base, page);
    let (status, text) = fetch_text(&url).await?;
    waf_check(status, &text, &format!("Gagal mengambil anime by {} (WAF 403)", kind))?;
    let mut data = parse_card_list(&text, &url, kind);
    if kind == "genre" { data["genre"] = json!(slug); } else { data["season"] = json!(slug); }
    data["page"] = json!(page);
    Ok(data)
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let mut action = pstr(&params, &["action"]).trim().to_lowercase();
    let q = { let v = pstr(&params, &["query"]); if v.is_empty() { pstr(&params, &["q"]) } else { v } };
    let q = if q.is_empty() { pstr(&params, &["url"]) } else { q };
    let page: i64 = { let p = pstr(&params, &["page"]); if p.is_empty() { pstr(&params, &["p"]) } else { p } }.parse().unwrap_or(1);
    let page = if page < 1 { 1 } else { page };
    let genre = pstr(&params, &["genre"]);
    let season = pstr(&params, &["season"]);

    if action.is_empty() {
        if !genre.is_empty() { action = "genre".into(); }
        else if !season.is_empty() { action = "season".into(); }
        else if pstr(&params, &["url"]).contains("-episode-") || pstr(&params, &["url"]).contains("/episode/") { action = "episode".into(); }
        else if pstr(&params, &["url"]).contains("/anime/") { action = "detail".into(); }
        else if pstr(&params, &["query"]).is_empty() == false || pstr(&params, &["q"]).is_empty() == false { action = "search".into(); }
        else { action = "home".into(); }
    }

    let result: Result<Value, String> = match action.as_str() {
        "home" => scrape_home(page).await,
        "latest" | "terbaru" => scrape_latest(page).await,
        "search" | "cari" => {
            if q.is_empty() { return bad("Parameter 'query' wajib diisi untuk action=search"); }
            search_anime(&q).await
        }
        "detail" | "anime" => {
            if q.is_empty() { return bad("Parameter 'query' atau 'url' wajib diisi untuk action=detail"); }
            scrape_anime(&q).await
        }
        "episode" | "ep" | "stream" | "play" => {
            if q.is_empty() { return bad("Parameter 'url' atau 'query' episode wajib diisi untuk action=episode/stream"); }
            scrape_episode(&q).await
        }
        "listgenre" | "genres" => list_filters("genre", "genre").await,
        "genre" => {
            let g = if genre.is_empty() { q.clone() } else { genre.clone() };
            if g.is_empty() { return bad("Parameter 'genre' wajib diisi untuk action=genre"); }
            filter_by(&g, "genre", page).await
        }
        "listseason" | "seasons" => list_filters("season", "season").await,
        "season" => {
            let s = if season.is_empty() { q.clone() } else { season.clone() };
            if s.is_empty() { return bad("Parameter 'season' wajib diisi untuk action=season"); }
            filter_by(&s, "season", page).await
        }
        _ => return bad(&format!("Action '{}' tidak valid. Pilihan: home, latest, search, detail, episode, stream, listgenre, genre, listseason, season", action)),
    };

    match result {
        Ok(v) => Json(json!({"status": true, "result": v})).into_response(),
        Err(e) => server_err(&e),
    }
}

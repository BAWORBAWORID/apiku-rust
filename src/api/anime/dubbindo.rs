// Dubbindo — native conversion of api/anime/dubbindo.js
// dubbindo.site scraper: home, trending, latest, shorts, categories, category, search, detail & MP4 streams.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://www.dubbindo.site/";

const CATEGORIES: &str = r##"[
  {"id":"1","slug":"film-movie","name":"Film Movie"},
  {"id":"3","slug":"tv-series","name":"TV Series"},
  {"id":"4","slug":"anime-movie","name":"Anime Movie"},
  {"id":"5","slug":"anime-series","name":"Anime Series"},
  {"id":"790","slug":"shorts","name":"#Shorts"},
  {"id":"other","slug":"other","name":"Other"},
  {"id":"791","slug":"uncategory","name":"Uncategory"}
]"##;

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
    reqwest::Client::builder().timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build().unwrap()
}

async fn fetch_page(url: &str) -> Result<String, String> {
    let res = client().get(url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", BASE_URL)
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {}", status)); }
    Ok(body)
}

fn abs_base(href: &str) -> String {
    if let Some(rest) = href.strip_prefix('/') {
        format!("{}{}", BASE_URL, rest)
    } else { href.to_string() }
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

/// Find inner text of first element whose class contains `cls` in `frag`.
fn inner_by_class(frag: &str, cls: &str) -> Option<(usize, String)> {
    let pat = format!("class=\"", );
    let _ = pat;
    let mut from = 0usize;
    let lower = frag.to_lowercase();
    let needle = format!("class=\"{}", cls);
    while let Some(p) = lower[from..].find(&needle) {
        let abs = from + p;
        let tag_start = frag[..abs].rfind('<').unwrap_or(abs);
        let gt = lower[tag_start..].find('>')? + tag_start;
        let end = lower[gt..].find("</")? + gt;
        return Some((gt, text_of(&frag[gt..end])));
    }
    None
}

/// Extract each container whose class contains `sel` (e.g. "video-list", "video-wrapper").
fn containers(html: &str, sel: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let needle = format!("class=\"{}", sel);
    let mut i = 0usize;
    while let Some(p) = lower[i..].find(&needle) {
        let abs = i + p;
        let tag_start = html[..abs].rfind('<').unwrap_or(abs);
        let gt = match lower[tag_start..].find('>') { Some(g) => tag_start + g + 1, None => break };
        // naive balanced div scan
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

fn parse_video_cards(html: &str, selector: &str) -> Vec<Value> {
    let mut videos = Vec::new();
    for sel in selector.split(", ") {
        for block in containers(html, sel.trim()) {
            let is_search_card = block.contains("video-latest-list") || block.contains("video-thumb");
            // anchor + img
            let (a_tag, a_inner) = {
                let mut found = None;
                let lower = block.to_lowercase();
                let mut i = 0;
                while let Some(p) = lower[i..].find("<a ") {
                    let start = i + p;
                    let gt = match lower[start..].find('>') { Some(g) => start + g, None => break };
                    let tag = block[start..=gt].to_string();
                    let inner_start = gt + 1;
                    let Some(close) = lower[inner_start..].find("</a>") else { break };
                    let tag_inner = block[inner_start..inner_start + close].to_string();
                    // pick anchor within .video-thumb a or .video-list-image a
                    if is_search_card && !block[..start].contains("video-thumb") && block[..start].contains("video-list") {
                        i = inner_start + close + 4; continue;
                    }
                    found = Some((tag, tag_inner));
                    break;
                }
                match found { Some(f) => f, None => continue }
            };
            let href = find_attr(&a_tag, "href").unwrap_or_default();
            let absolute_url = abs_base(&href);
            let img = a_inner.to_lowercase().find("<img").and_then(|p| {
                let gt = a_inner.to_lowercase()[p..].find('>').map(|g| p + g)?;
                let tag = &a_inner[p..=gt];
                find_attr(tag, "alt").map(|alt| (alt, find_attr(tag, "src"))).or(Some((String::new(), find_attr(tag, "src"))))
            });
            let (img_alt, thumbnail) = match img {
                Some((alt, src)) => (alt, src.unwrap_or_default()),
                None => (String::new(), String::new()),
            };
            let title = if !img_alt.is_empty() { img_alt }
                else { inner_by_class(&block, "video-title").map(|(_, t)| t)
                    .or_else(|| inner_by_class(&block, "video-list-title").map(|(_, t)| t))
                    .unwrap_or_default() };
            let duration = if is_search_card {
                inner_by_class(&block, "video-duration").map(|(_, t)| t).unwrap_or_default()
            } else {
                // duration inside anchor
                a_inner.find("duration").map(|_| {
                    let lower = a_inner.to_lowercase();
                    let p = lower.find("duration").unwrap_or(0);
                    let gt = lower[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
                    let end = lower[gt..].find("</").map(|e| gt + e).unwrap_or(a_inner.len());
                    text_of(&a_inner[gt..end])
                }).unwrap_or_default()
            };
            let mut creator_name = String::new();
            let mut creator_url = String::new();
            let mut views: Option<String> = None;
            let mut uploaded_at: Option<String> = None;
            let mut description = String::new();

            if is_search_card {
                if let Some((info_start, _)) = inner_by_class(&block, "video-info") {
                    let info_div = &block[info_start..];
                    // creator link a[href*="/@"]
                    let lower = info_div.to_lowercase();
                    let mut i = 0;
                    while let Some(p) = lower[i..].find("<a ") {
                        let start = i + p;
                        let gt = lower[start..].find('>').map(|g| start + g).unwrap_or(lower.len());
                        let tag = &info_div[start..=gt];
                        let inner_end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(info_div.len());
                        if tag.contains("/@") {
                            creator_name = text_of(&info_div[gt + 1..inner_end]);
                            creator_url = find_attr(tag, "href").unwrap_or_default();
                            break;
                        }
                        i = gt + 1;
                    }
                    // spans
                    let spans = collect_tag_texts(info_div, "span");
                    if !spans.is_empty() { views = Some(spans[0].clone()); }
                    if spans.len() > 1 {
                        if spans[1] != "·" { uploaded_at = Some(spans[1].clone()); }
                        else if spans.len() > 2 { uploaded_at = Some(spans[2].clone()); }
                    }
                    // description p
                    if let Some((_, ptext)) = inner_by_class(info_div, "video-info") { let _ = ptext; }
                    if let Some(pp) = info_div.find("<p") {
                        let gt = info_div[pp..].find('>').map(|g| pp + g + 1).unwrap_or(pp);
                        let end = info_div[gt..].find("</p>").map(|e| gt + e).unwrap_or(info_div.len());
                        description = text_of(&info_div[gt..end]);
                    }
                }
            } else {
                if let Some((by_start, _)) = inner_by_class(&block, "video-list-by") {
                    let by_div = &block[by_start..];
                    let lower = by_div.to_lowercase();
                    let mut i = 0;
                    while let Some(p) = lower[i..].find("<a ") {
                        let start = i + p;
                        let gt = lower[start..].find('>').map(|g| start + g).unwrap_or(lower.len());
                        let tag = &by_div[start..=gt];
                        let inner_end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(by_div.len());
                        creator_name = text_of(&by_div[gt + 1..inner_end]);
                        creator_url = find_attr(tag, "href").unwrap_or_default();
                        break;
                    }
                    // meta text: strip tags of whole by_div
                    let meta_text = text_of(&by_div);
                    let parts: Vec<&str> = meta_text.split('·').map(|p| p.trim()).collect();
                    if !parts.is_empty() && !parts[0].is_empty() { views = Some(parts[0].to_string()); }
                    if parts.len() > 1 { uploaded_at = Some(parts[1].to_string()); }
                }
            }
            if !creator_url.is_empty() { creator_url = abs_base(&creator_url); }

            let mut v = json!({
                "title": title,
                "url": absolute_url,
                "thumbnail": thumbnail,
                "duration": duration,
                "creator": {"name": creator_name, "url": creator_url},
                "views": views,
                "uploadedAt": uploaded_at,
            });
            if is_search_card { v["description"] = json!(description); }
            videos.push(v);
        }
        if !videos.is_empty() { break; }
    }
    videos
}

fn collect_tag_texts(frag: &str, tagname: &str) -> Vec<String> {
    let mut out = Vec::new();
    let open = format!("<{}", tagname);
    let close = format!("</{}>", tagname);
    let lower = frag.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find(&open) {
        let start = i + p;
        let gt = match lower[start..].find('>') { Some(g) => start + g + 1, None => break };
        let Some(end) = lower[gt..].find(&close) else { break };
        out.push(text_of(&frag[gt..gt + end]));
        i = gt + end + close.len();
    }
    out
}

async fn get_homepage() -> Result<Value, String> {
    let html = fetch_page(BASE_URL).await?;
    // featured
    let featured = {
        let pat = "pt_feat_vid_details";
        html.find(pat).and_then(|p| {
            let seg = &html[p..];
            let end = seg.find("</div").unwrap_or(seg.len());
            let seg = &seg[..end];
            let lower = seg.to_lowercase();
            lower.find("<h1").and_then(|h1p| {
                let hgt = lower[h1p..].find('>')? + h1p;
                let hend = lower[hgt..].find("</h1>")? + hgt;
                let h1 = &seg[hgt..hend];
                let mut a_start = None;
                let mut i = 0;
                let hl = h1.to_lowercase();
                while let Some(p) = hl[i..].find("<a ") {
                    let st = i + p;
                    let gt2 = hl[st..].find('>').map(|g| st + g)?; // tag end index
                    let tag = &h1[st..=gt2];
                    let href = find_attr(tag, "href").unwrap_or_default();
                    let inner_end = hl[gt2..].find("</a>").map(|e| gt2 + e).unwrap_or(h1.len());
                    let title = text_of(&h1[gt2 + 1..inner_end]);
                    a_start = Some((title, href));
                    break;
                }
                let (title, url) = a_start?;
                // meta p
                let meta = lower.find("<p").and_then(|pp| {
                    let pgt = lower[pp..].find('>')? + pp;
                    let pend = lower[pgt..].find("</p>")? + pgt;
                    Some(text_of(&seg[pgt..pend]))
                }).unwrap_or_default();
                let mut featured_duration = String::new();
                if !meta.is_empty() {
                    let parts: Vec<&str> = meta.split('·').map(|x| x.trim()).collect();
                    if parts.len() > 2 { featured_duration = parts[2].to_string(); }
                }
                Some(json!({
                    "title": title,
                    "url": abs_base(&url),
                    "duration": featured_duration,
                }))
            })
        })
    };
    let trending = parse_video_cards(&html, ".pt_four_videos_trend .video-list");
    let latest = parse_video_cards(&html, ".pt_four_videos_top .video-list");
    let shorts = parse_video_cards(&html, ".videos .video-list");
    Ok(json!({"featured": featured, "trending": trending, "latest": latest, "shorts": shorts}))
}

async fn search_videos(query: &str) -> Result<Vec<Value>, String> {
    let url = format!("{}search?keyword={}", BASE_URL, urlencoding::encode(query));
    let html = fetch_page(&url).await?;
    Ok(parse_video_cards(&html, ".video-wrapper"))
}

fn category_map(cat: &str) -> String {
    match cat.to_lowercase().as_str() {
        "1" | "film" | "movie" | "film-movie" => "1".into(),
        "3" | "series" | "tv" | "tv-series" => "3".into(),
        "4" | "animemovie" | "anime-movie" => "4".into(),
        "5" | "animeseries" | "anime-series" | "anime" => "5".into(),
        "790" | "shorts" | "#shorts" => "790".into(),
        "other" => "other".into(),
        "791" | "uncategory" => "791".into(),
        _ => cat.to_string(),
    }
}

async fn get_category_videos(category_id: &str) -> Result<(String, Vec<Value>), String> {
    let mapped = category_map(category_id);
    let url = format!("{}videos/category/{}", BASE_URL, mapped);
    let html = fetch_page(&url).await?;
    let videos = parse_video_cards(&html, ".video-wrapper, .video-list");
    Ok((mapped, videos))
}

async fn get_video_details(target_url: &str) -> Result<Value, String> {
    let mut watch_url = target_url.trim().to_string();
    if !watch_url.starts_with("http://") && !watch_url.starts_with("https://") {
        watch_url = if watch_url.starts_with('/') { abs_base(&watch_url) }
            else if watch_url.contains("watch/") { format!("{}{}", BASE_URL, watch_url) }
            else { format!("{}watch/{}", BASE_URL, watch_url) };
    }
    let html = fetch_page(&watch_url).await?;

    let meta_of = |prop: &str| -> String {
        let pat = format!("property=\"{}\"", prop);
        html.find(&pat).or_else(|| html.find(&format!("name=\"{}\"", prop))).and_then(|p| {
            let tag_start = html[..p].rfind('<')?;
            let gt = html[tag_start..].find('>')? + tag_start;
            find_attr(&html[tag_start..=gt], "content").or(Some(String::new())).map(|s| s)
        }).unwrap_or_default()
    };
    let title = { let t = meta_of("og:title"); if t.is_empty() { lower_text(&html, "title") } else { Some(t) } }.unwrap_or_default();
    let description = meta_of("og:description");
    let mut thumbnail = meta_of("og:image");
    if thumbnail.is_empty() { thumbnail = meta_of("thumbnail"); }

    let mut creator_name = String::new();
    let mut creator_avatar = String::new();
    let mut creator_url = String::new();
    {
        let lower = html.to_lowercase();
        let mut i = 0;
        while let Some(p) = lower[i..].find("<a ") {
            let start = i + p;
            let gt = lower[start..].find('>').map(|g| start + g).unwrap_or(lower.len());
            let tag = &html[start..=gt];
            let inner_end = lower[gt..].find("</a>").map(|e| gt + e).unwrap_or(html.len());
            if tag.contains("/@") {
                if creator_url.is_empty() { creator_url = find_attr(tag, "href").unwrap_or_default(); if creator_url.starts_with('/') { creator_url = abs_base(&creator_url); } }
                let text = text_of(&html[gt + 1..inner_end]);
                if !text.is_empty() && creator_name.is_empty() { creator_name = text; }
                if let Some(ip) = lower[gt..inner_end].find("<img") {
                    let igt = lower[gt + ip..].find('>').map(|g| gt + ip + g + 1).unwrap_or(gt);
                    let itag = &html[gt + ip..igt];
                    if creator_avatar.is_empty() { creator_avatar = find_attr(itag, "src").unwrap_or_default(); }
                    if creator_name.is_empty() { creator_name = find_attr(itag, "alt").unwrap_or_default(); }
                }
            }
            i = inner_end;
        }
    }

    let views_text = inner_by_class(&html, "video-views").map(|(_, t)| t).unwrap_or_default();
    let mut views: Option<String> = None;
    let mut uploaded_at: Option<String> = None;
    if !views_text.is_empty() {
        let parts: Vec<&str> = views_text.split('·').map(|p| p.trim()).collect();
        if !parts.is_empty() { views = Some(parts[0].to_string()); }
        if parts.len() > 1 { uploaded_at = Some(parts[1].to_string()); }
    }

    // direct MP4 streams
    let mp4_re = regex::Regex::new(r#"src:\s*['"](https?://[^'"]+\.mp4)['"]"#).unwrap();
    let mut streams = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in mp4_re.captures_iter(&html) {
        let u = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if seen.insert(u.to_string()) {
            let label = if u.contains("_240p") { "240p" } else if u.contains("_360p") { "360p" }
                else if u.contains("_480p") { "480p" } else if u.contains("_720p") { "720p" }
                else if u.contains("_1080p") { "1080p" } else { "SD" };
            streams.push(json!({"quality": label, "url": u}));
        }
    }
    let video_id = regex::Regex::new(r#"video_id:\s*['"]?(\d+)['"]?"#).unwrap()
        .captures(&html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());

    Ok(json!({
        "title": title, "description": description, "thumbnail": thumbnail,
        "creator": {"name": creator_name, "url": creator_url, "avatar": creator_avatar},
        "videoId": video_id, "views": views, "uploadedAt": uploaded_at,
        "streamsCount": streams.len(), "streams": streams,
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

const ACTIONS: &str = "home, trending, latest, shorts, categories, category, search, detail, watch, stream";

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = { let a = pstr(&params, &["action"]); if a.is_empty() { pstr(&params, &["type"]) } else { a } }
        .trim().to_lowercase();
    let action = if action.is_empty() { "home".to_string() } else { action };

    let result: Result<Value, String> = (|| async {
        match action.as_str() {
            "home" => {
                let data = get_homepage().await?;
                Ok(json!({"action": action, "result": data}))
            }
            "trending" => {
                let data = get_homepage().await?;
                let t = data.get("trending").cloned().unwrap_or(json!([]));
                Ok(json!({"action": action, "total": t.as_array().map(|a| a.len()).unwrap_or(0), "result": t}))
            }
            "latest" => {
                let data = get_homepage().await?;
                let l = data.get("latest").cloned().unwrap_or(json!([]));
                Ok(json!({"action": action, "total": l.as_array().map(|a| a.len()).unwrap_or(0), "result": l}))
            }
            "shorts" => {
                let data = get_homepage().await?;
                let s = data.get("shorts").cloned().unwrap_or(json!([]));
                Ok(json!({"action": action, "total": s.as_array().map(|a| a.len()).unwrap_or(0), "result": s}))
            }
            "categories" => {
                let cats: Value = serde_json::from_str(CATEGORIES).unwrap_or(json!([]));
                Ok(json!({"action": action, "total": cats.as_array().map(|a| a.len()).unwrap_or(0), "result": cats}))
            }
            "category" => {
                let cat = { let c = pstr(&params, &["category"]); if c.is_empty() { pstr(&params, &["id"]) } else { c } };
                let cat = if cat.is_empty() { "5".to_string() } else { cat };
                let (category_id, videos) = get_category_videos(&cat).await?;
                Ok(json!({"action": action, "categoryId": category_id, "total": videos.len(), "result": videos}))
            }
            "search" => {
                let q = { let v = pstr(&params, &["query"]); if v.is_empty() { pstr(&params, &["q"]) } else { v } };
                if q.is_empty() { return Err("PARAM:Parameter 'query' wajib diisi untuk action=search".into()); }
                let videos = search_videos(&q).await?;
                Ok(json!({"action": action, "query": q, "total": videos.len(), "result": videos}))
            }
            "detail" | "watch" | "stream" => {
                let target = { let v = pstr(&params, &["url"]); if v.is_empty() { pstr(&params, &["query"]) } else { v } };
                let target = { if target.is_empty() { pstr(&params, &["slug"]) } else { target } };
                if target.is_empty() { return Err(format!("PARAM:Parameter 'url' wajib diisi untuk action={}", action)); }
                let details = get_video_details(&target).await?;
                Ok(json!({"action": action, "result": details}))
            }
            _ => Err(format!("PARAM:Action '{}' tidak valid. Gunakan salah satu: {}", action, ACTIONS)),
        }
    })().await;

    match result {
        Ok(mut v) => {
            if let Some(o) = v.as_object_mut() {
                o.insert("status".into(), json!(true));
            }
            Json(v).into_response()
        }
        Err(e) => {
            if let Some(rest) = e.strip_prefix("PARAM:") {
                bad(rest)
            } else {
                server_err(&e)
            }
        }
    }
}

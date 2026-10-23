// Anichi — native conversion of api/anime/anichi.js
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://anichi.to";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
    reqwest::Client::builder().timeout(Duration::from_secs(25)).user_agent(UA).build().unwrap()
}

async fn fetch_html(url: &str) -> Result<String, String> {
    let res = client().get(url)
        .header("Referer", format!("{}/", BASE_URL))
        .send().await.map_err(|e| format!("{} failed: {}", url, e))?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if status != 200 { return Err(format!("{} failed: HTTP {}", url, status)); }
    Ok(body)
}

fn text_of(frag: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    re.replace_all(frag, "").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_attr(html: &str, selector_classes: &str, attr_name: &str) -> Option<String> {
    // find first element whose class contains any of the space-separated classes, then grab attr
    for cls in selector_classes.split(',') {
        let cls = cls.trim();
        if cls.is_empty() { continue; }
        let pat = format!("\"{}", cls);
        if let Some(p) = html.find(&pat) {
            let tag_start = html[..p].rfind('<').unwrap_or(p);
            let gt = html[tag_start..].find('>')? + tag_start;
            let tag = &html[tag_start..=gt];
            let attr_pat = format!("{}=\"", attr_name);
            if let Some(ap) = tag.find(&attr_pat) {
                let s = &tag[ap + attr_pat.len()..];
                if let Some(e) = s.find('"') { return Some(s[..e].to_string()); }
            }
        }
    }
    None
}

/// Iterate `class="item"` blocks inside a container region of html.
fn item_blocks(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("class=\"item") {
        let abs = i + p;
        let tag_start = html[..abs].rfind('<').unwrap_or(abs);
        let gt = match lower[tag_start..].find('>') { Some(g) => tag_start + g + 1, None => break };
        // find next `<div class="item` or end
        let next = lower[gt..].find("class=\"item").map(|n| gt + n).unwrap_or(html.len());
        out.push(html[tag_start..next].to_string());
        i = next.max(gt);
    }
    out
}

fn parse_items(html: &str, latest_mode: bool) -> Vec<Value> {
    let mut results = Vec::new();
    for block in item_blocks(html) {
        let link = first_attr(&block, "tip, a", "href").or_else(|| {
            let lower = block.to_lowercase();
            lower.find("<a ").and_then(|p| {
                let gt = lower[p..].find('>')? + p;
                let seg = &block[p..=gt];
                let pat = "href=\"";
                seg.find(pat).and_then(|ap| {
                    let s = &seg[ap + pat.len()..];
                    s.find('"').map(|e| s[..e].to_string())
                })
            })
        });
        let href = match link { Some(h) => h, None => continue };
        let slug = regex::Regex::new(r".*/anime/").unwrap().replace(&href, "").to_string();
        // title: class="name" or "title" inner text
        let title = {
            let mut t = String::new();
            for cls in ["name", "title"] {
                let pat = format!("class=\"{}", cls);
                if let Some(p) = block.find(&pat) {
                    let gt = block[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
                    let end = block[gt..].find("</").map(|e| gt + e).unwrap_or(block.len());
                    t = text_of(&block[gt..end]);
                    break;
                }
            }
            t
        };
        if title.is_empty() { continue; }
        let thumbnail = {
            let lower = block.to_lowercase();
            lower.find("<img").and_then(|p| {
                let gt = lower[p..].find('>').map(|e| p + e)?;
                let seg = &block[p..=gt];
                for a in ["src", "data-src"] {
                    let pat = format!("{}=\"", a);
                    if let Some(ap) = seg.find(&pat) {
                        let s = &seg[ap + pat.len()..];
                        if let Some(e) = s.find('"') { return Some(s[..e].to_string()); }
                    }
                }
                None
            })
        };
        let tipe = {
            // class="right" inner text
            let pat = "class=\"right";
            block.find(pat).map(|p| {
                let gt = block[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
                let end = block[gt..].find("</").map(|e| gt + e).unwrap_or(block.len());
                text_of(&block[gt..end])
            }).unwrap_or_default()
        };
        let episode = {
            let pat = "ep-status";
            block.find(pat).and_then(|p| {
                let span = block[p..].find("<span").map(|s| p + s)?;
                let gt = block[span..].find('>').map(|g| span + g + 1)?;
                let end = block[gt..].find("</span>").map(|e| gt + e)?;
                Some(text_of(&block[gt..end]))
            }).unwrap_or_default()
        };
        let id = {
            let pat = "data-id=\"";
            block.find(pat).and_then(|p| {
                let s = &block[p + pat.len()..];
                s.find('"').map(|e| s[..e].to_string())
            }).unwrap_or_default()
        };
        let _ = latest_mode;
        results.push(json!({
            "id": id, "title": title, "slug": slug, "thumbnail": thumbnail,
            "type": tipe, "episode": episode,
            "url": format!("{}/anime/{}", BASE_URL, slug),
        }));
    }
    results
}

fn info_pairs(html: &str) -> serde_json::Map<String, Value> {
    // .series-fact / .meta-row blocks: label + value
    let mut info = serde_json::Map::new();
    let lower = html.to_lowercase();
    for cls in ["series-fact", "meta-row"] {
        let mut i = 0usize;
        let pat = format!("class=\"{}\"", cls);
        while let Some(p) = lower[i..].find(&pat) {
            let abs = i + p;
            let tag_start = html[..abs].rfind('<').unwrap_or(abs);
            let gt = match lower[tag_start..].find('>') { Some(g) => tag_start + g + 1, None => break };
            let end = lower[gt..].find("</div").map(|e| gt + e).unwrap_or(html.len());
            let block = &html[gt..end];
            let label = {
                let lp = "class=\"series-fact__label\"".to_string();
                let lp2 = "class=\"meta-label\"".to_string();
                let lp_at = block.find(&lp).or_else(|| block.find(&lp2));
                lp_at.map(|lp0| {
                    let g2 = block[lp0..].find('>').map(|g| lp0 + g + 1).unwrap_or(lp0);
                    let e2 = block[g2..].find("</").map(|e| g2 + e).unwrap_or(block.len());
                    text_of(&block[g2..e2]).trim_end_matches(':').to_string()
                })
            };
            let value = {
                let vp = "class=\"series-fact__value\"".to_string();
                let vp2 = "class=\"meta-value\"".to_string();
                let vp_at = block.find(&vp).or_else(|| block.find(&vp2));
                vp_at.map(|vp0| {
                    let g2 = block[vp0..].find('>').map(|g| vp0 + g + 1).unwrap_or(vp0);
                    let e2 = block[g2..].find("</").map(|e| g2 + e).unwrap_or(block.len());
                    text_of(&block[g2..e2])
                })
            };
            if let (Some(l), Some(v)) = (label, value) {
                if !l.is_empty() && !v.is_empty() { info.insert(l, json!(v)); }
            }
            i = end.max(gt);
        }
    }
    info
}

async fn detail(url: &str) -> Result<Value, String> {
    let html = fetch_html(url).await?;
    let id = first_attr(&html, "series-page, watch-main", "data-id").unwrap_or_default();
    let mal_id = first_attr(&html, "series-page, watch-main", "data-mal-id").unwrap_or_default();
    let title = first_text(&html, &["series-title", "media-title"]);
    let thumbnail = first_img(&html, &["series-intro__poster", "media-info-poster"]);
    let synopsis = first_text(&html, &["series-blurb__full", "synopsis-full"])
        .or_else(|| first_text(&html, &["series-blurb__short", "synopsis-short"]))
        .unwrap_or_default();
    let rating = first_text(&html, &["series-score", "score-line"]).unwrap_or_default();
    // rating b inner
    let rating = if rating.is_empty() { rating } else {
        let pat = "series-score";
        let _ = pat;
        rating
    };
    let info = info_pairs(&html);
    let mut genres = Vec::new();
    let mut i = 0usize;
    let lower = html.to_lowercase();
    while let Some(p) = lower[i..].find("series-genres__list") {
        let abs = i + p;
        let gt = lower[abs..].find('>').map(|g| abs + g + 1).unwrap_or(abs);
        let end = lower[gt..].find("</div").map(|e| gt + e).unwrap_or(html.len());
        let block = &html[gt..end];
        let mut j = 0;
        let bl = block.to_lowercase();
        while let Some(ap) = bl[j..].find("<a ") {
            let a_abs = j + ap;
            let a_gt = bl[a_abs..].find('>').map(|g| a_abs + g + 1).unwrap_or(bl.len());
            let a_end = bl[a_gt..].find("</a>").map(|e| a_gt + e).unwrap_or(bl.len());
            let name = text_of(&block[a_gt..a_end]);
            if !name.is_empty() { genres.push(name); }
            j = a_end;
        }
        i = end;
    }
    let alt_title = first_attr(&html, "series-title, media-title", "data-en")
        .or_else(|| first_attr(&html, "series-title, media-title", "data-jp")).unwrap_or_default();
    Ok(json!({
        "id": id, "malId": mal_id, "title": title, "altTitle": alt_title,
        "thumbnail": thumbnail, "synopsis": synopsis, "rating": rating,
        "genres": genres, "info": info, "url": url,
    }))
}

fn first_text(html: &str, classes: &[&str]) -> Option<String> {
    let lower = html.to_lowercase();
    for cls in classes {
        let pat = format!("class=\"{}\"", cls);
        if let Some(p) = lower.find(&pat) {
            let gt = lower[p..].find('>').map(|g| p + g + 1).unwrap_or(p);
            let end = lower[gt..].find("</").map(|e| gt + e).unwrap_or(html.len());
            let t = text_of(&html[gt..end]);
            if !t.is_empty() { return Some(t); }
        }
    }
    None
}

fn first_img(html: &str, container_classes: &[&str]) -> Option<String> {
    let lower = html.to_lowercase();
    for cls in container_classes {
        let pat = format!("class=\"{}\"", cls);
        if let Some(p) = lower.find(&pat) {
            let seg_end = lower[p..].find("</div").map(|e| p + e).unwrap_or(html.len());
            let seg = &lower[p..seg_end];
            if let Some(ip) = seg.find("<img") {
                let gt = seg[ip..].find('>')? + ip;
                let tag = &seg[ip..=gt];
                for a in ["src", "data-src"] {
                    let ap_pat = format!("{}=\"", a);
                    if let Some(ap) = tag.find(&ap_pat) {
                        let s = &tag[ap + ap_pat.len()..];
                        if let Some(e) = s.find('"') { return Some(s[..e].to_string()); }
                    }
                }
            }
        }
    }
    None
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action", "type"]).to_lowercase();

    let result: Result<Value, String> = match action.as_str() {
        "search" => {
            let q = pstr(&params, &["query"]);
            if q.is_empty() { return bad("Parameter 'query' wajib diisi untuk action search"); }
            let html = match fetch_html(&format!("{}/filter?keyword={}", BASE_URL, urlencoding::encode(&q))).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!(parse_items(&html, false)))
        }
        "detail" => {
            let u = pstr(&params, &["url"]);
            if u.is_empty() { return bad("Parameter 'url' wajib diisi untuk action detail"); }
            detail(&u).await
        }
        "latest" => {
            let html = match fetch_html(&format!("{}/latest-updated", BASE_URL)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!(parse_items(&html, true)))
        }
        "popular" => {
            let html = match fetch_html(&format!("{}/most-viewed", BASE_URL)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!(parse_items(&html, true)))
        }
        "genre" => {
            let g = pstr(&params, &["genre"]);
            if g.is_empty() { return bad("Parameter 'genre' wajib diisi untuk action genre"); }
            let html = match fetch_html(&format!("{}/genre/{}", BASE_URL, g)).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!(parse_items(&html, true)))
        }
        "watch" => {
            let u = pstr(&params, &["url"]);
            if u.is_empty() { return bad("Parameter 'url' wajib diisi untuk action watch"); }
            let html = match fetch_html(&u).await { Ok(v) => v, Err(e) => return server_err(&e) };
            let id = first_attr(&html, "watch-main", "data-id").unwrap_or_default();
            let mal_id = first_attr(&html, "watch-main", "data-mal-id").unwrap_or_default();
            let title = first_text(&html, &["media-title"]).unwrap_or_default();
            let thumbnail = first_img(&html, &["media-info-poster"]);
            let synopsis = first_text(&html, &["synopsis-full", "synopsis-short"]).unwrap_or_default();
            let rating = first_text(&html, &["score-line"]).unwrap_or_default();
            let ep_num = first_attr(&html, "watch-main", "data-ep-num").unwrap_or_default();
            Ok(json!({"id": id, "malId": mal_id, "title": title, "thumbnail": thumbnail,
                      "synopsis": synopsis, "rating": rating, "episodeNum": ep_num, "url": u}))
        }
        _ => return bad("Invalid action. Use: search, detail, latest, popular, genre, watch"),
    };

    match result {
        Ok(v) => Json(json!({"status": true, "result": v})).into_response(),
        Err(e) => server_err(&e),
    }
}

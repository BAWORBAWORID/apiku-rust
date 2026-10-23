// Anichin Help — native conversion of api/anime/anichin-help.js
// Scraper donghua anichin.help: latest, popular, search, detail, episode, download.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE: &str = "https://anichin.help/";
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
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "error": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "error": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap()
}

async fn fetch_html(url: &str) -> Result<String, String> {
    let res = client().get(url)
                    .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                    .header("accept-language", "en-US,en;q=0.9,id;q=0.8")
        .header("user-agent", UA)
        .send().await.map_err(|e| format!("Gagal mengambil data: {}", e))?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("Gagal mengambil data: HTTP {}", status)); }
    Ok(body)
}

fn text_of(html: &str) -> String {
    // inner text of the current fragment: strip tags, collapse whitespace
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    re.replace_all(html, "").split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

/// Extract attribute value from an opening tag string.
fn attr<'a>(tag: &'a str, name: &str) -> Option<String> {
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

/// Split HTML into (open-tag, inner) pairs for all <a ...> ... </a>.
fn anchors(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_lowercase();
    let mut i = 0usize;
    while let Some(p) = lower[i..].find("<a") {
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

/// Find the innermost section whose h2 heading contains `keyword`.
fn section_by_heading(html: &str, keyword: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut search_from = 0usize;
    while let Some(h2p) = lower[search_from..].find("<h2") {
        let h2_start = search_from + h2p;
        let Some(gt) = lower[h2_start..].find('>') else { break };
        let Some(end) = lower[h2_start..].find("</h2>") else { break };
        let heading = text_of(&html[h2_start + gt + 1..h2_start + end]);
        if heading.contains(keyword) {
            // walk outwards to the enclosing <section
            let section_start = lower[..h2_start].rfind("<section").map(|p| p).unwrap_or(h2_start);
            // find matching </section> (assume no deep nesting of sections)
            let close = lower[section_start..].find("</section>").map(|p| section_start + p + 10).unwrap_or(html.len());
            return Some(html[section_start..close].to_string());
        }
        search_from = h2_start + 4;
    }
    None
}

fn card_from_anchor(tag: &str, inner: &str, with_new: bool) -> Option<Value> {
    let href = attr(&tag, "href")?;
    let title = {
        // h3 inside inner
        let h3 = inner.to_lowercase().find("<h3").map(|p| {
            let s = &inner[p..];
            let gt = s.find('>').unwrap_or(0);
            let end = s.to_lowercase().find("</h3>").unwrap_or(s.len());
            text_of(&s[gt + 1..end])
        }).unwrap_or_default();
        if h3.is_empty() { text_of(inner) } else { h3 }
    };
    let img = {
        let lower = inner.to_lowercase();
        lower.find("<img").and_then(|p| {
            let end = lower[p..].find('>').map(|e| p + e)?;
            attr(&inner[p..=end], "src")
        })
    };
    let badge = |cls: &str| -> Option<String> {
        let lower = inner.to_lowercase();
        let pat = format!("class=\"");
        // find span/div with badge class and take its text
        let mut from = 0usize;
        while let Some(p) = lower[from..].find(&pat) {
            let abs = from + p + pat.len();
            let end = lower[abs..].find('"').map(|e| abs + e)?;
            let classes = &lower[abs..end];
            if classes.contains(cls) {
                let gt = lower[end..].find('>')? + end;
                let close = lower[gt..].find("</")?;
                return Some(text_of(&inner[gt..gt + close]).replace("★", "").trim().to_string());
            }
            from = end;
        }
        None
    };
    let mut out = json!({
        "title": title,
        "url": href,
        "episode": badge("badge-sub").unwrap_or_default(),
        "thumbnail": img,
        "rating": badge("badge-rating").unwrap_or_default(),
    });
    if with_new {
        out["isNew"] = json!(inner.to_lowercase().contains("badge-new"));
    }
    Some(out)
}

async fn latest() -> Result<Value, String> {
    let html = fetch_html(BASE).await?;
    let section = section_by_heading(&html, "Episode Terbaru").ok_or("Gagal mengambil data episode terbaru")?;
    let mut results = Vec::new();
    for (tag, inner) in anchors(&section) {
        if tag.contains("card-netflix") {
            if let Some(c) = card_from_anchor(&tag, &inner, true) { results.push(c); }
        }
    }
    Ok(json!(results))
}

async fn popular() -> Result<Value, String> {
    let html = fetch_html(BASE).await?;
    let section = section_by_heading(&html, "Ongoing").ok_or("Gagal mengambil data populer")?;
    let mut results = Vec::new();
    for (tag, inner) in anchors(&section) {
        if tag.contains("card-netflix") {
            if let Some(c) = card_from_anchor(&tag, &inner, false) { results.push(c); }
        }
    }
    Ok(json!(results))
}

async fn search(q: &str) -> Result<Value, String> {
    let html = fetch_html(&format!("{}?s={}", BASE, urlencoding::encode(q))).await?;
    let mut results = Vec::new();
    for (tag, inner) in anchors(&html) {
        if tag.contains("card-netflix") {
            if let Some(c) = card_from_anchor(&tag, &inner, false) { results.push(c); }
        }
    }
    Ok(json!(results))
}

async fn episode(target: &str) -> Result<Value, String> {
    if target.is_empty() { return Err("Parameter URL episode wajib diisi.".into()); }
    let html = fetch_html(target).await?;
    let mut episodes = Vec::new();
    // Find section with heading "Daftar Episode" / "Pilih Episode", fallback whole page
    let scope = section_by_heading(&html, "Daftar Episode")
        .or_else(|| section_by_heading(&html, "Pilih Episode"))
        .unwrap_or(html.clone());
    let ep_re = regex::Regex::new(r"(?i)^(Episode\s*[\d.]+(?:\s*[-\u2013]\s*[\d.]+)?)(?:\s+(.*))?$").unwrap();
    for (tag, inner) in anchors(&scope) {
        let href = match attr(&tag, "href") { Some(h) => h, None => continue };
        if !href.contains("episode") { continue; }
        let raw = text_of(&inner);
        let ep_num = match ep_re.captures(&raw) {
            Some(c) => {
                let m1 = c.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_else(|| raw.clone());
                m1
            }
            None => raw.clone(),
        };
        if ep_num.is_empty() { continue; }
        let date = ep_re.captures(&raw).and_then(|c| c.get(2)).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        episodes.push(json!({"episodeNumber": ep_num, "date": date, "link": href}));
    }
    Ok(json!(episodes))
}

async fn download(target: &str) -> Result<Value, String> {
    if target.is_empty() { return Err("Parameter URL download wajib diisi.".into()); }
    let html = fetch_html(target).await?;
    let mut sources = Vec::new();
    // find <template x-ref="embN"> blocks paired with buttons calling show(N)
    let btn_re = regex::Regex::new(r#"@click="show\((\d+)\)""#).unwrap();
    for cap in btn_re.captures_iter(&html) {
        let label_start = {
            // walk back to the start of this <button
            let idx = cap.get(0).map(|m| m.start()).unwrap_or(0);
            html[..idx].rfind("<button").map(|p| &html[p..idx + cap.get(0).map(|m| m.len()).unwrap_or(0)])
        };
        let label = label_start.map(|seg| text_of(seg)).unwrap_or_default();
        let tpl_ref = format!("emb{}", cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        let tpl_pat = format!("x-ref=\"{}\"", tpl_ref);
        if let Some(tp) = html.find(&tpl_pat) {
            let gt = match html[tp..].find('>') { Some(g) => g + tp, None => continue };
            let close = match html[gt..].to_lowercase().find("</template>") { Some(c) => c + gt, None => continue };
            let content = &html[gt..close];
            let iframe_src = content.to_lowercase().find("<iframe").and_then(|p| {
                let seg = &content[p..];
                let gt2 = seg.find('>')?;
                attr(&seg[..=gt2], "src")
            }).unwrap_or_default();
            if !iframe_src.is_empty() {
                let src = if iframe_src.starts_with("//") { format!("https:{}", iframe_src) } else { iframe_src };
                sources.push(json!({"label": label, "source": src.trim()}));
            }
        }
    }
    Ok(json!(sources))
}

async fn detail(target: &str) -> Result<Value, String> {
    if target.is_empty() { return Err("Parameter URL detail wajib diisi.".into()); }
    let html = fetch_html(target).await?;
    // article.card-netflix (first)
    let article = {
        let lower = html.to_lowercase();
        let p = lower.find("<article").ok_or("Gagal mengambil detail donghua")?;
        let end = lower[p..].find("</article>").map(|e| p + e + 10).unwrap_or(html.len());
        html[p..end].to_string()
    };
    let tag_text = |frag: &str| text_of(frag);
    let first_tag_of = |cls: &str| -> Option<usize> {
        let pat = format!("\"{}\"", cls);
        let lower = article.to_lowercase();
        lower.find(&pat.to_lowercase()).and_then(|p| {
            // find enclosing tag start
            let tag_start = article[..p].rfind('<')?;
            let gt = lower[tag_start..].find('>')? + tag_start;
            Some(gt)
        })
    };
    let title = article.to_lowercase().find("<h1").map(|p| {
        let seg = &article[p..];
        let gt = seg.find('>').unwrap_or(0);
        let end = seg.to_lowercase().find("</h1>").unwrap_or(seg.len());
        tag_text(&seg[gt + 1..end])
    }).unwrap_or_default();
    let thumb = article.to_lowercase().find("<img").and_then(|p| {
        let seg = &article[p..];
        let gt = seg.find('>')?;
        attr(&seg[..=gt], "src")
    });
    let badge_of = |cls: &str| -> String {
        let lower = article.to_lowercase();
        let pat = format!("class=\"{}", cls);
        if let Some(p) = lower.find(&pat) {
            let gt = lower[p..].find('>').map(|e| p + e).unwrap_or(p);
            let close = lower[gt..].find("</").map(|e| gt + e).unwrap_or(gt);
            return tag_text(&article[gt..close]).replace("★", "").trim().to_string();
        }
        String::new()
    };
    let year = first_tag_of("badge-glass").map(|gt| {
        let close = article[gt..].find("</a>").map(|e| gt + e).unwrap_or(article.len());
        tag_text(&article[gt..close])
    }).unwrap_or_default();
    // dl > div (dt/dd pairs)
    let mut dl_info = serde_json::Map::new();
    let dl_re = regex::Regex::new(r#"(?is)<dt>([\s\S]*?)</dt>\s*<dd>([\s\S]*?)</dd>"#).unwrap();
    for cap in dl_re.captures_iter(&article) {
        let k = tag_text(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        let v = tag_text(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if !k.is_empty() && !v.is_empty() { dl_info.insert(k, json!(v)); }
    }
    let mut genres = Vec::new();
    for (tag, inner) in anchors(&article) {
        if tag.contains("/genre/") { genres.push(tag_text(&inner)); }
    }
    let synopsis = article.to_lowercase().find("sinopsis").and_then(|p| {
        let seg = &article[p..];
        let prose = seg.to_lowercase().find("class=\"prose\"")? + p;
        let gt = article[prose..].find('>')? + prose;
        let close = article[gt..].to_lowercase().find("</div>").map(|e| gt + e).unwrap_or(article.len());
        Some(tag_text(&article[gt..close]))
    }).unwrap_or_default();
    let alternative_titles = {
        // h1 next <p> text, take after last "·"
        let lower = article.to_lowercase();
        lower.find("</h1>").and_then(|p| {
            let after = &article[p + 5..];
            let pe = lower[p + 5..].find("<p")?;
            let seg = &after[pe..];
            let gt = seg.find('>')?;
            let end = seg.to_lowercase().find("</p>").unwrap_or(seg.len());
            let t = tag_text(&seg[gt + 1..end]);
            Some(t.rsplit('·').next().map(|s| s.trim().to_string()).unwrap_or_default())
        }).unwrap_or_default()
    };
    Ok(json!({
        "title": title,
        "thumbnail": thumb,
        "rating": badge_of("badge-rating"),
        "type": badge_of("badge-sub"),
        "status": badge_of("badge"),
        "year": year,
        "alternativeTitles": alternative_titles,
        "episodes": dl_info.get("Episode").cloned().unwrap_or(json!("")),
        "duration": dl_info.get("Durasi").cloned().unwrap_or(json!("")),
        "studio": dl_info.get("Studio").cloned().unwrap_or(json!("")),
        "genres": genres,
        "synopsis": synopsis,
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action", "type"]).to_lowercase();
    if action.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "error": "Parameter 'action' atau 'type' wajib diisi.",
            "available_actions": {"anichin_actions": ["latest", "popular", "search", "detail", "episode", "download"]},
        }))).into_response();
    }
    let target = { let t = pstr(&params, &["url"]); if t.is_empty() { pstr(&params, &["link"]) } else { t } };
    let q = { let s = pstr(&params, &["query"]); if s.is_empty() { pstr(&params, &["s"]) } else { s } };

    let result: Result<Value, String> = match action.as_str() {
        "latest" => latest().await,
        "popular" => popular().await,
        "search" => {
            if q.is_empty() { return bad("Kata kunci pencarian ('query' atau 's') wajib diisi."); }
            search(&q).await
        }
        "detail" => detail(&target).await,
        "episode" => episode(&target).await,
        "download" => download(&target).await,
        _ => return bad(&format!("Action/Type '{}' tidak valid.", action)),
    };

    match result {
        Ok(v) => Json(json!({"status": true, "result": v})).into_response(),
        Err(e) => server_err(&e),
    }
}

// Badan Gizi Nasional (BGN) — native conversion of api/search/bgn.js
// Regex scraping bgn.go.id: actions home, news, nasional, kolaborasi, sasaran.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE: &str = "https://bgn.go.id";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
        .default_headers(reqwest::header::HeaderMap::from_iter([
            ("Accept".parse().unwrap(), "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8".parse().unwrap()),
            ("Accept-Language".parse().unwrap(), "id-ID,id;q=0.9,en;q=0.8".parse().unwrap()),
        ]))
        .build()
        .map_err(|e| e.to_string())
}

async fn curl(c: &reqwest::Client, url: &str) -> Result<String, String> {
    c.get(url)
        .send()
        .await
        .map_err(|e| format!("Gagal fetch URL ({}) : {}", url, e))?
        .text()
        .await
        .map_err(|e| format!("Gagal fetch URL ({}) : {}", url, e))
}

fn strip_tags(s: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    let stripped = re.replace_all(s, "");
    let decoded = stripped
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#8217;", "'")
        .replace("&#8211;", "\u{2013}")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&#8230;", "\u{2026}")
        .replace("&#8220;", "\"")
        .replace("&#8221;", "\"");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn dedupe(items: Vec<Value>, key: &str) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter(|x| {
            let k = x.get(key).and_then(Value::as_str).unwrap_or("").to_string();
            !k.is_empty() && seen.insert(k)
        })
        .collect()
}

fn cap_of(s: &str) -> String {
    s.to_string()
}

fn parse_hero(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for block in html.split("<article class=\"relative w-full flex-shrink-0").skip(1) {
        let yt = regex::Regex::new(r#"data-video-id="([^"]+)""#).unwrap().captures(block);
        let img = regex::Regex::new(r#"<img src="([^"]+)"[^>]*class="[^"]*object-cover[^"]*""#).unwrap().captures(block);
        let title = regex::Regex::new(r"(?s)<h1[^>]*>([^<]*)</h1>").unwrap().captures(block);
        let sub = regex::Regex::new(r#"(?s)<p class="text-base text-gray-200[^>]*>([^<]*)</p>"#).unwrap().captures(block);
        out.push(json!({
            "youtube_id": yt.as_ref().map(|m| m[1].to_string()),
            "youtube_url": yt.as_ref().map(|m| format!("https://www.youtube.com/watch?v={}", &m[1])),
            "image_mobile": img.as_ref().map(|m| m[1].to_string()),
            "title": title.as_ref().map(|m| strip_tags(&m[1])),
            "subtitle": sub.as_ref().map(|m| strip_tags(&m[1])),
        }));
    }
    out
}

fn parse_pinned_news(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for block in html.split("<a class=\"min-w-full h-full relative\"").skip(1) {
        let href = regex::Regex::new(r#"href="([^"]+)""#).unwrap().captures(block);
        let img = regex::Regex::new(r#"<img src="([^"]+)""#).unwrap().captures(block);
        let title = regex::Regex::new(r"(?s)<h3[^>]*>([^<]+)</h3>").unwrap().captures(block);
        if let (Some(h), Some(t)) = (href, title) {
            let url = if h[1].starts_with("http") { h[1].to_string() } else { format!("{}{}", BASE, &h[1]) };
            out.push(json!({
                "title": strip_tags(&t[1]),
                "url": url,
                "thumbnail": img.as_ref().map(|m| m[1].to_string()),
            }));
        }
    }
    dedupe(out, "url")
}

fn parse_news(html: &str, filter: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for block in html.split("<div class=\"fade-up\"").skip(1) {
        let Some(hm) = regex::Regex::new(r#"<a href="([^"]+)""#).unwrap().captures(block) else { continue };
        let mut url = hm[1].to_string();
        if !url.starts_with("http") {
            url = format!("{}{}", BASE, url);
        }
        let is_internal = url.starts_with("https://bgn.go.id") || url.starts_with("https://www.bgn.go.id");
        if filter == "internal" && !is_internal {
            continue;
        }
        if filter == "nasional" && is_internal {
            continue;
        }

        let img = regex::Regex::new(r#"<img src="([^"]+)""#).unwrap().captures(block);
        let title = regex::Regex::new(r"(?s)<h3[^>]*>([\s\S]*?)</h3>").unwrap().captures(block);
        let mut source: Option<String> = None;
        let mut date: Option<String> = None;
        if let Some(pm) = regex::Regex::new(r#"(?s)<p class="text-base text-gray-600[^"]*"[^>]*>([\s\S]*?)</p>"#).unwrap().captures(block) {
            let text = strip_tags(&pm[1]);
            let parts: Vec<&str> = text.split('\u{2022}').map(str::trim).collect();
            source = parts.first().map(|s| cap_of(s)).filter(|s| !s.is_empty());
            date = parts.get(1).map(|s| cap_of(s)).filter(|s| !s.is_empty());
        }
        if source.is_none() {
            if let Some(gm) = regex::Regex::new(r#"<span class="font-semibold text-gold"[^>]*>([^<]+)</span>"#).unwrap().captures(block) {
                source = Some(strip_tags(&gm[1]));
            }
        }
        if let (Some(t), true) = (title, !url.is_empty()) {
            out.push(json!({
                "title": strip_tags(&t[1]),
                "url": url,
                "thumbnail": img.as_ref().map(|m| m[1].to_string()),
                "source": source,
                "date": date,
            }));
        }
    }
    dedupe(out, "url")
}

fn parse_kolaborasi(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let re = regex::Regex::new(r#"<img src="(/logo_instansi/[^"]+)"[^>]+alt="([^"]*)""#).unwrap();
    for m in re.captures_iter(html) {
        out.push(json!({"name": m[2].to_string(), "logo": format!("{}{}", BASE, &m[1])}));
    }
    dedupe(out, "logo")
}

fn parse_sasaran(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for block in html.split("<div class=\"group min-w-[256px] max-h-96").skip(1) {
        let title = regex::Regex::new(r#"(?s)<h2 class="text-3xl text-gray-900"[^>]*>([^<]+)</h2>"#).unwrap().captures(block);
        let desc = regex::Regex::new(r#"(?s)<p class="text-sm text-gray-600"[^>]*>([^<]+)</p>"#).unwrap().captures(block);
        let img = regex::Regex::new(r#"<img src="(/background/[^"]+)"[^>]+alt="([^"]*)""#).unwrap().captures(block);
        if let Some(t) = title {
            out.push(json!({
                "title": strip_tags(&t[1]),
                "description": desc.as_ref().map(|m| strip_tags(&m[1])),
                "image": img.as_ref().map(|m| format!("{}{}", BASE, &m[1])),
            }));
        }
    }
    out
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

    let custom_url = get_param(&["url"]).map(|u| u.trim().to_string()).unwrap_or_default();
    let mut action = get_param(&["action"]).map(|a| a.trim().to_lowercase()).unwrap_or_default();
    if action.is_empty() {
        action = if !custom_url.is_empty() && custom_url.contains("/news") { "news".into() } else { "home".into() };
    }
    let page: i64 = get_param(&["page", "p"]).and_then(|p| p.parse().ok()).unwrap_or(1).max(1);

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result = async {
        if action == "home" || action == "all" {
            let target = if custom_url.is_empty() { format!("{}/", BASE) } else { custom_url.clone() };
            let html = curl(&c, &target).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            Ok::<_, (StatusCode, String)>(json!({
                "source": target,
                "type": "home",
                "scraped_at": chrono::Utc::now().to_rfc3339(),
                "hero": parse_hero(&html),
                "pinned_news": parse_pinned_news(&html),
                "berita_bgn": parse_news(&html, "internal"),
                "berita_nasional": parse_news(&html, "nasional"),
                "kolaborasi": parse_kolaborasi(&html),
                "sasaran": parse_sasaran(&html),
            }))
        } else if action == "news" || action == "berita" {
            let url = if page == 1 { format!("{}/news/", BASE) } else { format!("{}/news/page/{}/", BASE, page) };
            let html = curl(&c, &url).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let news = parse_news(&html, "internal");
            let total = news.len();
            Ok(json!({
                "source": url,
                "type": "news_bgn",
                "page": page,
                "scraped_at": chrono::Utc::now().to_rfc3339(),
                "total": total,
                "news": news,
            }))
        } else if action == "nasional" || action == "news-nasional" {
            let url = if page == 1 { format!("{}/news/", BASE) } else { format!("{}/news/page/{}/", BASE, page) };
            let html = curl(&c, &url).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let news = parse_news(&html, "nasional");
            let total = news.len();
            Ok(json!({
                "source": url,
                "type": "news_nasional",
                "page": page,
                "scraped_at": chrono::Utc::now().to_rfc3339(),
                "total": total,
                "news": news,
            }))
        } else if action == "kolaborasi" || action == "mitra" {
            let html = curl(&c, &format!("{}/", BASE)).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let list = parse_kolaborasi(&html);
            let total = list.len();
            Ok(json!({
                "source": format!("{}/", BASE),
                "type": "kolaborasi",
                "scraped_at": chrono::Utc::now().to_rfc3339(),
                "total": total,
                "partners": list,
            }))
        } else if action == "sasaran" || action == "target" {
            let html = curl(&c, &format!("{}/", BASE)).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            let list = parse_sasaran(&html);
            let total = list.len();
            Ok(json!({
                "source": format!("{}/", BASE),
                "type": "sasaran",
                "scraped_at": chrono::Utc::now().to_rfc3339(),
                "total": total,
                "targets": list,
            }))
        } else {
            Err((StatusCode::BAD_REQUEST, format!("Action '{}' tidak valid. Pilihan: home, news, nasional, kolaborasi, sasaran", action)))
        }
    }
    .await;

    match result {
        Ok(r) => Json(json!({"status": true, "result": r})).into_response(),
        Err((status, msg)) => err(status, &msg),
    }
}

// APKModY Downloader — native conversion of api/downloader/apkmody.js
// Actions: search | detail | history | download over apkmody.mobi (HTML scraping).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE: &str = "https://apkmody.mobi";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

fn fetch_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    h.insert("user-agent", mk(UA));
    h.insert("accept", mk("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
    h.insert("accept-language", mk("id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6"));
    h.insert("referer", mk("https://apkmody.mobi/"));
    h
}

async fn fetch_page(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).headers(fetch_headers()).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

fn meta_content(html: &str, attr_pattern: &str) -> String {
    // find attr_pattern (e.g. "property=\"og:image\""), then its content="..."
    match html.find(attr_pattern) {
        Some(i) => {
            let seg = &html[i..];
            match seg.find("content=\"") {
                Some(j) => {
                    let rest = &seg[j + 9..];
                    rest.split('"').next().unwrap_or("").to_string()
                }
                None => String::new(),
            }
        }
        None => String::new(),
    }
}

fn package_from_icon(icon: &str) -> String {
    // /packages/<pkg>/icon_
    if let Some(i) = icon.find("/packages/") {
        let rest = &icon[i + 10..];
        if rest.contains("/icon_") {
            return rest.split('/').next().unwrap_or("").to_string();
        }
    }
    String::new()
}

fn parse_size_bytes(size: &str) -> i64 {
    // e.g. "123.4 MB"
    let lower = size.to_lowercase();
    let mult: i64 = if lower.contains("tb") { 1099511627776 }
        else if lower.contains("gb") { 1073741824 }
        else if lower.contains("mb") { 1048576 }
        else if lower.contains("kb") { 1024 } else { 1 };
    let num: String = size.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    let n: f64 = num.replace(',', ".").parse().unwrap_or(0.0);
    (n * mult as f64).round() as i64
}

fn parse_search_items(html: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut rest = html;
    while let Some(i) = rest.find("article") {
        let chunk = &rest[i..];
        // take next ~3000 chars as article scope
        let scope = &chunk[..chunk.len().min(3000)];
        if let Some(a_start) = scope.find("<a ") {
            let href = {
                let seg = &scope[a_start..];
                match seg.find("href=\"") {
                    Some(j) => seg[j + 6..].split('"').next().unwrap_or("").to_string(),
                    None => String::new(),
                }
            };
            // slug check /games/ or /apps/
            let slug_match = href.find("/games/").or_else(|| href.find("/apps/")).map(|p| {
                let seg = &href[p..];
                seg.split('"').next().unwrap_or("").to_string()
            });
            if let Some(slug) = slug_match {
                let url = format!("{BASE}{slug}");
                if seen.insert(url.clone()) {
                    let cover = {
                        let seg = &scope[a_start..];
                        match seg.find("<img") {
                            Some(k) => {
                                let iseg = &seg[k..];
                                match iseg.find("src=\"") {
                                    Some(j) => iseg[j + 5..].split('"').next().unwrap_or("").to_string(),
                                    None => String::new(),
                                }
                            }
                            None => String::new(),
                        }
                    };
                    let title = {
                        let seg = &scope[a_start..];
                        match seg.find("card-title") {
                            Some(k) => {
                                let tseg = &seg[k..];
                                match tseg.find("truncate") {
                                    Some(m) => text_after_tag(&tseg[m..], '>'),
                                    None => String::new(),
                                }
                            }
                            None => String::new(),
                        }
                    };
                    let version = {
                        let seg = &scope[a_start..];
                        match seg.find("card-excerpt") {
                            Some(k) => text_after_tag(&seg[k..], '>'),
                            None => String::new(),
                        }
                    };
                    items.push(json!({
                        "title": clean(&title),
                        "version": clean(&version),
                        "cover": if cover.is_empty() { Value::Null } else { json!(cover) },
                        "url": url
                    }));
                }
            }
        }
        rest = &chunk[7.min(chunk.len())..];
    }
    items
}

fn text_after_tag(html: &str, _c: char) -> String {
    match html.find('>') {
        Some(j) => {
            let rest = &html[j + 1..];
            rest.split('<').next().unwrap_or("").trim().to_string()
        }
        None => String::new(),
    }
}

fn parse_files(html: &str) -> Vec<Value> {
    let mut files = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut rest = html;
    while let Some(i) = rest.find("https://cdn.topmongo.com/packages/") {
        // get full href value
        let start = rest[..i].rfind("href=\"").map(|p| p + 6).unwrap_or(i);
        let seg = &rest[start..];
        let url = seg.split('"').next().unwrap_or("").to_string();
        if !url.is_empty() && seen.insert(url.clone()) {
            let is_file = ["apk", "obb", "zip", "rar", "7z", "xapk"]
                .iter()
                .any(|ext| url.to_lowercase().ends_with(&format!(".{ext}")));
            if is_file {
                // size: look in following text
                let after = &seg[..seg.len().min(2000)];
                let text = {
                    let mut t = String::new();
                    let mut r2 = after;
                    for _ in 0..10 {
                        match r2.find('>') {
                            Some(j) => {
                                let chunk_end = r2[j + 1..].find('<').map(|e| j + 1 + e).unwrap_or(r2.len());
                                t.push_str(r2[j + 1..chunk_end].trim());
                                t.push(' ');
                                r2 = &r2[chunk_end.min(r2.len())..];
                            }
                            None => break,
                        }
                    }
                    t.trim().to_string()
                };
                // extract "123.4 MB" style
                let size: Option<String> = {
                    let mut found = None;
                    let words: Vec<&str> = text.split_whitespace().collect();
                    for (idx, w) in words.iter().enumerate() {
                        let wl = w.to_lowercase();
                        if ["tb", "gb", "mb", "kb"].iter().any(|u| wl.ends_with(u)) && idx > 0 {
                            found = Some(format!("{} {}", words[idx - 1], w));
                            break;
                        }
                    }
                    found
                };
                let size_str = size.unwrap_or_default();
                let ftype = url.rsplit('.').next().unwrap_or("").to_string();
                let fname = url.rsplit('/').next().unwrap_or("").to_string();
                files.push(json!({
                    "fileName": fname,
                    "size": if size_str.is_empty() { Value::Null } else { json!(size_str) },
                    "sizeBytes": if size_str.is_empty() { Value::Null } else { json!(parse_size_bytes(&size_str)) },
                    "type": ftype,
                    "url": url
                }));
            }
        }
        rest = &rest[i + 34..];
    }
    files
}

fn parse_detail(html: &str) -> Value {
    let title = {
        // h1 <strong>...</strong>
        let mut t = String::new();
        if let Some(i) = html.find("<h1") {
            let seg = &html[i..];
            if let Some(k) = seg.find("<strong") {
                t = text_after_tag(&seg[k..], '>');
            }
        }
        if t.is_empty() {
            // <title> fallback, strip APKMODY suffix
            t = match html.find("<title>") {
                Some(i) => {
                    let rest = &html[i + 7..];
                    let raw = rest.split('<').next().unwrap_or("").trim().to_string();
                    raw.replace(" - APKMODY", "").replace(" | APKMODY", "")
                }
                None => String::new(),
            };
        }
        clean(&t)
    };
    let version = {
        // span inside h1 strong parent: find "v<digits...>" pattern in h1 segment
        let mut v = String::new();
        if let Some(i) = html.find("<h1") {
            let seg_end = html[i..].find("</h1>").map(|e| i + e).unwrap_or(html.len());
            let seg = &html[i..seg_end];
            if let Some(k) = seg.find("<span") {
                let span_text = text_after_tag(&seg[k..], '>');
                if let Some(vp) = span_text.find('v') {
                    let rest = &span_text[vp + 1..];
                    let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                    if num.contains('.') {
                        v = num;
                    }
                }
            }
        }
        if v.is_empty() { Value::Null } else { json!(v) }
    };
    let icon = {
        let candidates = [
            "https://cdn.topmongo.com/packages/",
            "property=\"og:image\"",
            "name=\"og:image\"",
            "name=\"twitter:image\"",
        ];
        let mut found = String::new();
        for cand in candidates {
            if cand.starts_with("http") {
                if let Some(i) = html.find(cand) {
                    let start = html[..i].rfind("src=\"").map(|p| p + 5).unwrap_or(i);
                    found = html[start..].split('"').next().unwrap_or("").to_string();
                }
            } else {
                found = meta_content(html, cand);
            }
            if !found.is_empty() {
                break;
            }
        }
        found
    };
    let updated = {
        let mut u = String::new();
        let mut rest = html;
        while let Some(i) = rest.find("<time") {
            let seg = &rest[i..];
            if let Some(j) = seg.find("datetime=\"") {
                u = seg[j + 10..].split('"').next().unwrap_or("").to_string();
                break;
            }
            rest = &rest[i + 5..];
        }
        if u.is_empty() { Value::Null } else { json!(u) }
    };
    json!({
        "title": title,
        "version": version,
        "mod": Value::Null,
        "icon": if icon.is_empty() { Value::Null } else { json!(icon) },
        "package": if icon.is_empty() { Value::Null } else { json!(package_from_icon(&icon)) },
        "updated": updated
    })
}

fn parse_history(html: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("historyItem") {
        let chunk_end = rest[i..].find("historyItem").map(|e| i + e).unwrap_or(rest.len().min(i + 4000));
        let seg = &rest[i..chunk_end];
        if let Some(a) = seg.find("<a") {
            let a_seg = &seg[a..];
            let href = match a_seg.find("href=\"") {
                Some(j) => a_seg[j + 6..].split('"').next().unwrap_or("").to_string(),
                None => String::new(),
            };
            if href.contains("/history/") {
                let version = clean(&text_after_tag(&{
                    let f = a_seg.find("font18").map(|k| &a_seg[k..]).unwrap_or(a_seg);
                    f.to_string()
                }, '>'));
                let name = clean(&text_after_tag(&{
                    let f = seg.find("gameTitle").map(|k| &seg[k..]).unwrap_or(seg);
                    f.to_string()
                }, '>'));
                items.push(json!({
                    "version": version,
                    "date": Value::Null,
                    "name": name,
                    "size": Value::Null,
                    "sizeBytes": Value::Null,
                    "url": if href.starts_with("http") { href } else { format!("{BASE}{href}") }
                }));
            }
        }
        rest = &rest[chunk_end.min(rest.len())..];
        if chunk_end >= rest.len() + i {
            break;
        }
        if items.len() > 200 {
            break;
        }
    }
    items
}

fn classify_path(path: &str) -> &'static str {
    if path.contains("/history/") && path.matches('/').count() >= 4 && !path.ends_with("/history/") {
        // /games|apps/<slug>/history/<id>
        if path.split("history/").nth(1).map(|s| !s.trim_matches('/').is_empty()).unwrap_or(false) {
            return "version";
        }
    }
    if path.ends_with("/history") || path.ends_with("/history/") { return "history"; }
    if path.ends_with("/download") || path.ends_with("/download/") { return "download"; }
    if path.contains("/games/") || path.contains("/apps/") { return "detail"; }
    "other"
}

async fn detail(client: &reqwest::Client, url: &str, with_history: bool) -> Result<Value, String> {
    let lower = url.to_lowercase();
    let is_app = lower.contains("/apps/");
    let kind = if is_app { "app" } else { "game" };
    let ctype = classify_path(&lower);

    let body = fetch_page(client, url).await?;
    if ctype != "other" && body.len() < 500 && !body.contains("<html") {
        return Err(format!("Halaman tidak ditemukan: {url}"));
    }

    let parsed = parse_detail(&body);
    match ctype {
        "version" => Ok(json!({
            "type": kind,
            "title": parsed.get("title"),
            "version": parsed.get("version"),
            "mod": parsed.get("mod"),
            "icon": parsed.get("icon"),
            "package": parsed.get("package"),
            "updated": parsed.get("updated"),
            "source": url,
            "downloads": parse_files(&body),
            "history": if with_history { parse_history(&body) } else { vec![] }
        })),
        "history" | "download" => {
            let mut files = parse_files(&body);
            let mut page_body = body.clone();
            if files.is_empty() && ctype == "download" {
                let slug = url.split("/games/").nth(1).or_else(|| url.split("/apps/").nth(1))
                    .and_then(|s| s.split('/').next()).unwrap_or("");
                if !slug.is_empty() {
                    let hist_url = format!("{BASE}/{}/{}/history", if is_app { "apps" } else { "games" }, slug);
                    page_body = fetch_page(client, &hist_url).await?;
                    files = parse_files(&page_body);
                }
            }
            let hist = if with_history { parse_history(&page_body) } else { vec![] };
            Ok(json!({
                "type": kind,
                "title": parsed.get("title"),
                "version": parsed.get("version"),
                "mod": parsed.get("mod"),
                "icon": parsed.get("icon"),
                "package": parsed.get("package"),
                "updated": parsed.get("updated"),
                "source": url,
                "downloads": files,
                "history": hist
            }))
        }
        _ => {
            // detail: fetch history page for files+history
            let slug = url.split("/games/").nth(1).or_else(|| url.split("/apps/").nth(1))
                .and_then(|s| s.split('/').next()).unwrap_or("");
            let (files, hist) = if !slug.is_empty() {
                let hist_url = format!("{BASE}/{}/{}/history", if is_app { "apps" } else { "games" }, slug);
                match fetch_page(client, &hist_url).await {
                    Ok(hb) => (parse_files(&hb), if with_history { parse_history(&hb) } else { vec![] }),
                    Err(_) => (vec![], vec![]),
                }
            } else {
                (vec![], vec![])
            };
            Ok(json!({
                "type": kind,
                "title": parsed.get("title"),
                "version": parsed.get("version"),
                "mod": parsed.get("mod"),
                "icon": parsed.get("icon"),
                "package": parsed.get("package"),
                "updated": parsed.get("updated"),
                "source": url,
                "downloads": files,
                "history": hist
            }))
        }
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["action", "query", "url", "page"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let s = |k: &str| merged.get(k).map(|v| v.to_string()).unwrap_or_default();
    let action = s("action");

    if action.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'action' wajib: search, detail, history, download"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    match action.as_str() {
        "search" => {
            let q = s("query").trim().to_string();
            if q.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'query' wajib untuk search"
                }))).into_response();
            }
            let page: u32 = s("page").parse().unwrap_or(1);
            let mut url = format!("{BASE}/?s={}", urlencoding::encode(&q));
            if page > 1 {
                url.push_str(&format!("&page={page}"));
            }
            let body_html = fetch_page(&client, &url).await.unwrap_or_default();
            let items = parse_search_items(&body_html);
            Json(json!({
                "status": true,
                "result": {
                    "type": "search", "query": q, "source": url,
                    "count": items.len(), "page": page, "items": items
                }
            }))
            .into_response()
        }
        "detail" | "history" | "download" => {
            let url = s("url").trim().to_string();
            if url.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": format!("Parameter 'url' wajib untuk {action}")
                }))).into_response();
            }
            match detail(&client, &url, action != "download").await {
                Ok(result) => {
                    if action == "history" {
                        Json(json!({
                            "status": true,
                            "result": {
                                "title": result.get("title"),
                                "version": result.get("version"),
                                "history": result.get("history")
                            }
                        }))
                        .into_response()
                    } else {
                        Json(json!({ "status": true, "result": result })).into_response()
                    }
                }
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                    "status": false, "message": e
                }))).into_response(),
            }
        }
        other => (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": format!("Action tidak dikenal: {other}")
        }))).into_response(),
    }
}

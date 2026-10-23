// ApkCombo Search — native conversion of api/search/apkcombo.js
// Scraping hasil search apkcombo.com, parse teks app card (developer · kategori, dll).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://apkcombo.com";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn parse_app_text(raw: &str) -> (Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>) {
    // (name, developer, category, installs, rating, size)
    let lines: Vec<String> = raw
        .split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let name = lines.first().cloned();

    let mut developer = None;
    let mut category = None;
    let mut installs = None;
    let mut rating = None;
    let mut size = None;

    let re_rating = regex::Regex::new(r"([\d,\.]+|N/A)\s*★").unwrap();
    let re_size = regex::Regex::new(r"(?i)([\d\.,]+\s*(?:MB|GB|KB))").unwrap();
    let re_inst = regex::Regex::new(r"(?i)([\d\.,]+\s*(?:M|jt|rb|K)\+)").unwrap();

    for line in &lines {
        if line.contains('\u{00b7}') {
            let parts: Vec<&str> = line.split('\u{00b7}').map(str::trim).collect();
            if parts.len() >= 2 {
                developer = Some(parts[0].to_string());
                category = Some(parts[1].to_string());
            }
        }
        if let Some(c) = re_rating.captures(line) {
            rating = Some(c[1].to_string());
        }
        if let Some(c) = re_size.captures(line) {
            size = Some(c[1].to_string());
        }
        if let Some(c) = re_inst.captures(line) {
            installs = Some(c[1].to_string());
        }
    }
    (name, developer, category, installs, rating, size)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let search_query = match query
        .get("query")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("query").and_then(Value::as_str).map(str::to_string)))
    {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari di ApkCombo: {e}")),
    };

    let html = match client
        .get(format!("{}/id/search/{}", BASE, urlencoding::encode(&search_query)))
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", format!("{}/id/", BASE))
        .send()
        .await
    {
        Ok(r) if r.status().as_u16() == 200 => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari di ApkCombo: {e}")),
        },
        Ok(r) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP {}", r.status().as_u16())),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari di ApkCombo: {e}")),
    };

    let document = scraper::Html::parse_document(&html);
    let href_re = regex::Regex::new(r"^/id/[^/]+/[^/]+/?$").unwrap();
    let skip_re = regex::Regex::new(r"(?i)/(topic|search|how-to-install)/").unwrap();

    let mut results: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(sel_a) = scraper::Selector::parse("a") {
        for a in document.select(&sel_a) {
            let href = a.value().attr("href").unwrap_or("");
            if !href_re.is_match(href) || skip_re.is_match(href) {
                continue;
            }
            let full_link = format!("{}{}", BASE, href);
            if !seen.insert(full_link.clone()) {
                continue;
            }
            let raw_text = a.text().collect::<String>();
            let (name, developer, category, installs, rating, size) = parse_app_text(&raw_text);
            let (name, developer, category) = match (name, developer, category) {
                (Some(n), Some(d), Some(c)) => (n, d, c),
                _ => continue,
            };
            let mut icon = scraper::Selector::parse("img")
                .ok()
                .and_then(|sel| {
                    a.select(&sel).next().and_then(|img| {
                        img.value()
                            .attr("data-src")
                            .or_else(|| img.value().attr("src"))
                            .map(str::to_string)
                    })
                });
            if let Some(ic) = &icon {
                if ic.ends_with("/1.gif") || ic.contains("placeholder") {
                    icon = None;
                }
            }
            if let Some(ic) = &icon {
                if !ic.starts_with("http") {
                    icon = Some(format!("{}{}", BASE, ic));
                }
            }
            results.push(json!({
                "name": name,
                "developer": developer,
                "category": category,
                "installs": installs,
                "rating": rating,
                "size": size,
                "icon": icon,
                "link": full_link,
            }));
        }
    }

    Json(json!({
        "status": true,
        "query": search_query,
        "total": results.len(),
        "result": results,
    })).into_response()
}

// Search Wallpaper 4K — native conversion of api/search/4kwallpapers.js
// 4kwallpapers.com: recent/popular/featured/random/search/category/categories/collections/collection.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://4kwallpapers.com";
const ACTIONS: [&str; 9] = ["recent", "popular", "featured", "random", "search", "category", "categories", "collections", "collection"];

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_html(c: &reqwest::Client, path: &str) -> Result<String, String> {
    let url = if path.starts_with("http") {
        path.to_string()
    } else if path.starts_with('/') {
        format!("{}{}", BASE_URL, path)
    } else {
        format!("{}/{}", BASE_URL, path)
    };
    let res = c.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    res.text().await.map_err(|e| e.to_string())
}

fn abs(link: &str) -> String {
    if link.starts_with("http") {
        link.to_string()
    } else {
        format!("{}{}", BASE_URL, link)
    }
}

fn parse_wallpapers(html: &str, page: i64) -> Value {
    let doc = scraper::Html::parse_document(html);
    let s = |s: &str| scraper::Selector::parse(s).unwrap();
    let mut wallpapers = Vec::new();
    for el in doc.select(&s(".wallpapers__item")) {
        let Some(href) = el.select(&s("a.wallpapers__canvas_image")).next().and_then(|a| a.value().attr("href")) else { continue };
        if href.contains("collections-packs") || href.ends_with("-wallpapers/") {
            continue;
        }
        let img = el.select(&s("img")).next();
        let srcset = img.and_then(|i| i.value().attr("srcset")).unwrap_or("");
        let src2x = regex::Regex::new(r"(https://[^\s]+thumbs_2t/[^\s]+)").unwrap().captures(srcset).and_then(|cm| cm.get(1)).map(|m| m.as_str().to_string());
        let keywords: Vec<Value> = el
            .select(&s("meta[itemprop=\"keywords\"]"))
            .next()
            .and_then(|m| m.value().attr("content"))
            .map(|content| content.split(',').map(|k| json!(k.trim())).filter(|k| !k.as_str().unwrap_or("").is_empty()).collect())
            .unwrap_or_default();
        let id = regex::Regex::new(r"-([0-9]+)\.html").unwrap().captures(href).and_then(|cm| cm.get(1)).map(|m| m.as_str().to_string());
        let title = el.select(&s(".title2, .title")).next().map(|t| t.text().collect::<String>().trim().to_string()).filter(|t| !t.is_empty())
            .or_else(|| img.and_then(|i| i.value().attr("alt")).map(str::to_string))
            .unwrap_or_default();
        wallpapers.push(json!({
            "id": id,
            "title": title,
            "url": abs(href),
            "thumbnail": img.and_then(|i| i.value().attr("src")),
            "thumbnail2x": src2x.or_else(|| img.and_then(|i| i.value().attr("src")).map(str::to_string)),
            "keywords": keywords,
        }));
    }
    json!({
        "total": wallpapers.len(),
        "page": page.max(1),
        "hasNext": doc.select(&s("a[href*=\"page=\"]")).next().is_some(),
        "wallpapers": wallpapers,
    })
}

async fn get_wallpapers(c: &reqwest::Client, path: &str, page: i64) -> Result<Value, String> {
    let sep = if path.contains('?') { "&" } else { "?" };
    let query_path = if page > 1 { format!("{}{}page={}", path, sep, page) } else { path.to_string() };
    let html = fetch_html(c, &query_path).await?;
    Ok(parse_wallpapers(&html, page))
}

async fn get_collections(c: &reqwest::Client, page: i64) -> Result<Value, String> {
    let path = if page > 1 { format!("/collections-packs/?page={}", page) } else { "/collections-packs/".to_string() };
    let html = fetch_html(c, &path).await?;
    let doc = scraper::Html::parse_document(&html);
    let s = |s: &str| scraper::Selector::parse(s).unwrap();
    let mut collections = Vec::new();
    for el in doc.select(&s("#packs-list p, .pics p")) {
        let Some(link) = el.select(&s("a")).next().and_then(|a| a.value().attr("href")) else { continue };
        let title = el.select(&s("a")).next().and_then(|a| a.value().attr("title")).map(|t| t.to_string())
            .or_else(|| el.select(&s(".packtitle")).next().map(|t| t.text().collect::<String>().trim().to_string()))
            .unwrap_or_default()
            .split_whitespace().collect::<Vec<_>>().join(" ");
        let title = regex::Regex::new(r"(?i)Wallpapers\s*$").unwrap().replace_all(&title, "").trim().to_string();
        collections.push(json!({
            "title": title,
            "slug": link.trim_matches('/'),
            "url": abs(link),
            "thumbnail": el.select(&s("img")).next().and_then(|i| i.value().attr("src")),
        }));
    }
    Ok(json!({"total": collections.len(), "page": page.max(1), "collections": collections}))
}

async fn get_collection_details(c: &reqwest::Client, slug: &str) -> Result<Value, String> {
    let clean_slug = slug.trim_matches('/');
    let html = fetch_html(c, &format!("/{}/", clean_slug)).await?;
    let doc = scraper::Html::parse_document(&html);
    let s = |s: &str| scraper::Selector::parse(s).unwrap();
    let mut wallpapers = Vec::new();
    for el in doc.select(&s(".wallpapers__item")) {
        let dl = el.select(&s("a[href*=\"/images/wallpapers/\"]")).next().and_then(|a| a.value().attr("href"));
        let title = el.select(&s(".title.tags")).next().map(|t| t.text().collect::<String>().trim().to_string()).filter(|t| !t.is_empty())
            .or_else(|| el.select(&s("img")).next().and_then(|i| i.value().attr("alt")).map(str::to_string))
            .unwrap_or_default();
        let preview = el.select(&s("img")).next().and_then(|i| i.value().attr("src")).map(str::to_string);
        let download = dl.map(|d| json!(abs(d))).unwrap_or(Value::Null);
        if preview.is_some() || !download.is_null() {
            wallpapers.push(json!({"title": title, "preview": preview, "download": download}));
        }
    }
    let title = doc.select(&s("h1")).next().map(|h| h.text().collect::<String>().trim().to_string()).unwrap_or_default();
    Ok(json!({"title": title, "total": wallpapers.len(), "wallpapers": wallpapers}))
}

async fn get_categories(c: &reqwest::Client) -> Result<Value, String> {
    let html = fetch_html(c, "/").await?;
    let doc = scraper::Html::parse_document(&html);
    let sel = scraper::Selector::parse(".section-dropdown a").unwrap();
    let cats: Vec<Value> = doc
        .select(&sel)
        .map(|el| {
            json!({
                "name": el.text().collect::<String>().trim().to_string(),
                "slug": el.value().attr("href").unwrap_or("").trim_matches('/').to_string(),
            })
        })
        .collect();
    Ok(json!(cats))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let action = get_param("action").unwrap_or_else(|| "recent".to_string());
    if !ACTIONS.contains(&action.as_str()) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Action tidak dikenal: {}", action));
    }
    let p: i64 = get_param("page").and_then(|pg| pg.parse().ok()).unwrap_or(1);
    let query_str = get_param("query");
    let slug = get_param("slug");

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result = async {
        match action.as_str() {
            "recent" => get_wallpapers(&c, "", p).await,
            "popular" => get_wallpapers(&c, "/most-popular-4k-wallpapers/", p).await,
            "featured" => get_wallpapers(&c, "/best-4k-wallpapers/", p).await,
            "random" => get_wallpapers(&c, "/random-wallpapers/", 1).await,
            "search" => {
                let Some(q) = query_str.as_deref().filter(|s| !s.is_empty()) else {
                    return Err("Parameter query wajib untuk action=search".to_string());
                };
                get_wallpapers(&c, &format!("/search/?q={}", urlencoding::encode(q)), p).await
            }
            "category" => {
                let Some(sl) = slug.as_deref().filter(|s| !s.is_empty()) else {
                    return Err("Parameter slug wajib untuk action=category".to_string());
                };
                get_wallpapers(&c, &format!("/{}/", sl), p).await
            }
            "categories" => Ok(json!({"categories": get_categories(&c).await?})),
            "collections" => get_collections(&c, p).await,
            "collection" => {
                let Some(sl) = slug.as_deref().filter(|s| !s.is_empty()) else {
                    return Err("Parameter slug wajib untuk action=collection".to_string());
                };
                get_collection_details(&c, sl).await
            }
            _ => unreachable!(),
        }
    }
    .await;

    match result {
        Ok(r) => {
            let mut obj = json!({
                "status": true,
                "result": {"action": action},
                "timestamp": chrono::Utc::now().timestamp_millis(),
            });
            if let (Some(dst), Some(src)) = (obj.pointer_mut("/result").and_then(Value::as_object_mut), r.as_object()) {
                dst.extend(src.clone());
            }
            Json(obj).into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

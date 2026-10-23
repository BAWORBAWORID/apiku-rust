// News Detail — native conversion of api/vtuberspace/news-detail.js
// Self-contained: replicates lib.js getNewsDetail + cleanNews + ld+json fallback.
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://vtuberspace.id";
const API_BASE: &str = "https://vtuberspace.id/api/v1";

fn default_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".parse().unwrap());
    h.insert("Accept", "application/json, text/plain, */*".parse().unwrap());
    h.insert("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h.insert("Referer", format!("{}/", BASE_URL).parse().unwrap());
    h
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap()
}

fn to_absolute_url(path: Option<&Value>) -> Value {
    let Some(s) = path.and_then(|v| v.as_str()) else { return Value::Null };
    if regex::Regex::new(r"(?i)^https?://").unwrap().is_match(s) { return json!(s); }
    if s.starts_with("//") { return json!(format!("https:{}", s)); }
    if s.starts_with('/') { return json!(format!("{}{}", BASE_URL, s)); }
    json!(format!("{}/{}", BASE_URL, s))
}

fn sval(v: &Value, key: &str) -> Value {
    v.get(key).cloned().unwrap_or(Value::Null)
}

fn nval_or(v: &Value, key: &str, default: i64) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(default)
}

fn clean_vtuber(item: &Value) -> Value {
    if !item.is_object() { return Value::Null; }
    let gender = if item.get("female").and_then(|f| f.as_bool()).unwrap_or(false) {
        json!("Female")
    } else if item.get("male").and_then(|m| m.as_bool()).unwrap_or(false) {
        json!("Male")
    } else {
        Value::Null
    };
    let agency = item.get("agency").filter(|a| a.is_object()).map(|a| json!({
        "id": sval(a, "id"),
        "name": sval(a, "name"),
        "slug": sval(a, "slug"),
        "description": a.get("description").cloned().unwrap_or(Value::Null),
        "logo": to_absolute_url(a.get("logo")),
        "banner": to_absolute_url(a.get("banner")),
        "is_indie": a.get("is_indie").and_then(|x| x.as_bool()).unwrap_or(false),
    })).unwrap_or(Value::Null);
    let images: Vec<Value> = item.get("images").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(|img| json!({
            "id": sval(img, "id"),
            "title": img.get("title").cloned().unwrap_or(Value::Null),
            "url": to_absolute_url(img.get("url")),
        })).collect();
    json!({
        "id": sval(item, "id"),
        "name": sval(item, "name"),
        "original_name": item.get("original_name").cloned().unwrap_or(Value::Null),
        "slug": sval(item, "slug"),
        "bio": item.get("bio").cloned().unwrap_or(Value::Null),
        "avatar": to_absolute_url(item.get("avatar")),
        "banner": to_absolute_url(item.get("banner")),
        "oshi_color": item.get("oshi_color").cloned().unwrap_or(Value::Null),
        "oshi_mark": item.get("oshi_mark").cloned().unwrap_or(Value::Null),
        "tgl_debut": item.get("tgl_debut").cloned().unwrap_or(Value::Null),
        "date_debut": item.get("date_debut").cloned().unwrap_or(Value::Null),
        "gender": gender,
        "artist": item.get("artist").cloned().unwrap_or(Value::Null),
        "rigging": item.get("rigging").cloned().unwrap_or(Value::Null),
        "link_perkenalan": item.get("link_perkenalan").cloned().unwrap_or(Value::Null),
        "link_youtube": item.get("link_youtube").cloned().unwrap_or(Value::Null),
        "social_links": item.get("social_links").cloned().unwrap_or(json!({})),
        "email": item.get("email").cloned().unwrap_or(Value::Null),
        "agency": agency,
        "images": images,
    })
}

fn clean_news(item: &Value) -> Value {
    if !item.is_object() { return Value::Null; }
    let author = item.get("author").filter(|a| a.is_object()).map(|a| json!({
        "id": sval(a, "id"),
        "name": sval(a, "display_name"),
        "slug": sval(a, "slug"),
        "avatar": to_absolute_url(a.get("avatar")),
    })).unwrap_or(Value::Null);
    let categories: Vec<Value> = item.get("categories").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(|c| json!({
            "id": sval(c, "id"),
            "name": sval(c, "name"),
            "slug": sval(c, "slug"),
            "description": c.get("description").cloned().unwrap_or(Value::Null),
        })).collect();
    let tags: Vec<Value> = item.get("tags").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(|t| json!({"id": sval(t, "id"), "name": sval(t, "name"), "slug": sval(t, "slug")})).collect();
    let related: Vec<Value> = item.get("related_vtubers").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(clean_vtuber).collect();
    let images: Vec<Value> = item.get("images").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(|img| json!({
            "id": sval(img, "id"),
            "name": sval(img, "name"),
            "url": to_absolute_url(img.get("url")),
        })).collect();
    json!({
        "id": sval(item, "id"),
        "title": sval(item, "title"),
        "slug": sval(item, "slug"),
        "excerpt": item.get("excerpt").cloned().unwrap_or(Value::Null),
        "content": item.get("content").cloned().unwrap_or(Value::Null),
        "thumbnail": to_absolute_url(item.get("thumbnail")),
        "status": item.get("status").cloned().unwrap_or(Value::Null),
        "published_at": item.get("published_at").cloned().unwrap_or(Value::Null),
        "created_at": item.get("created_at").cloned().unwrap_or(Value::Null),
        "updated_at": item.get("updated_at").cloned().unwrap_or(Value::Null),
        "is_featured": item.get("is_featured").and_then(|v| v.as_bool()).unwrap_or(false),
        "view_count": nval_or(item, "view_count", 0),
        "like_count": nval_or(item, "like_count", 0),
        "reading_time": item.get("reading_time").cloned().unwrap_or(Value::Null),
        "author": author,
        "categories": categories,
        "tags": tags,
        "related_vtubers": related,
        "images": images,
    })
}

async fn fetch_json(url: &str) -> Result<Value, String> {
    let res = client().get(url).headers(default_headers())
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {}", status)); }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// ld+json BlogPosting fallback when API + list lookup both miss.
fn news_from_ld_json(html: &str, target_slug: &str) -> Option<Value> {
    let re = regex::Regex::new(r#"(?is)<script\b[^>]*type="application/ld\+json"[^>]*>(.*?)</script>"#).unwrap();
    for cap in re.captures_iter(html) {
        let content = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if !content.contains(r#""@type":"BlogPosting""#) { continue; }
        let Ok(ld) = serde_json::from_str::<Value>(content.trim()) else { continue };
        let categories: Vec<Value> = ld.get("articleSection").and_then(|v| v.as_str()).map(|sec| {
            vec![json!({"id": Value::Null, "name": sec, "slug": sec.to_lowercase(), "description": Value::Null})]
        }).unwrap_or_default();
        let tags: Vec<Value> = ld.get("keywords").and_then(|v| v.as_str()).map(|kw| {
            kw.split(',').enumerate().map(|(idx, t)| json!({
                "id": idx, "name": t.trim(), "slug": t.trim().to_lowercase()
            })).collect::<Vec<_>>()
        }).unwrap_or_default();
        return Some(json!({
            "id": Value::Null,
            "title": ld.get("headline").cloned().unwrap_or(Value::Null),
            "slug": target_slug,
            "excerpt": ld.get("description").cloned().unwrap_or(Value::Null),
            "content": Value::Null,
            "thumbnail": to_absolute_url(ld.get("image")),
            "status": "published",
            "published_at": ld.get("datePublished").cloned().unwrap_or(Value::Null),
            "created_at": ld.get("datePublished").cloned().unwrap_or(Value::Null),
            "updated_at": ld.get("dateModified").cloned().unwrap_or(Value::Null),
            "is_featured": false,
            "view_count": 0,
            "like_count": 0,
            "reading_time": Value::Null,
            "author": ld.get("author").filter(|a| a.is_object()).map(|a| json!({
                "id": Value::Null, "name": a.get("name").cloned().unwrap_or(Value::Null),
                "slug": Value::Null, "avatar": Value::Null,
            })).unwrap_or(Value::Null),
            "categories": categories,
            "tags": tags,
            "related_vtubers": [],
            "images": [],
        }));
    }
    None
}

async fn get_news_detail(id_or_slug: &str) -> Result<Value, String> {
    if id_or_slug.trim().is_empty() { return Err("News ID or slug is required".into()); }

    if regex::Regex::new(r"^\d+$").unwrap().is_match(id_or_slug.trim()) {
        let data = fetch_json(&format!("{}/posts/{}", API_BASE, id_or_slug.trim())).await
            .map_err(|_| format!("News article with ID {} not found", id_or_slug.trim()))?;
        return Ok(json!({"success": true, "data": clean_news(&data.get("data").cloned().unwrap_or(json!({})))}));
    }

    let target_slug = id_or_slug.trim().to_lowercase();
    // try list lookup by slug
    if let Ok(list) = fetch_json(&format!("{}/posts?page=1&page_size=100", API_BASE)).await {
        let items = list.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let found = items.iter().find(|p| {
            p.get("slug").and_then(|s| s.as_str()).map(|s| s.to_lowercase()) == Some(target_slug.clone())
        });
        if let Some(found) = found {
            let found_id = found.get("id").cloned().unwrap_or(Value::Null);
            let id_str = found_id.as_str().map(|s| s.to_string())
                .or_else(|| found_id.as_i64().map(|n| n.to_string()))
                .unwrap_or_default();
            if let Ok(detail) = fetch_json(&format!("{}/posts/{}", API_BASE, id_str)).await {
                return Ok(json!({"success": true, "data": clean_news(&detail.get("data").cloned().unwrap_or(found.clone()))}));
            }
            return Ok(json!({"success": true, "data": clean_news(found)}));
        }
    }

    // HTML fallback
    let url = format!("{}/blog/{}", BASE_URL, urlencoding::encode(&target_slug));
    let res = client().get(&url).headers(default_headers()).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("News article with slug '{}' not found", target_slug));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    if let Some(data) = news_from_ld_json(&html, &target_slug) {
        return Ok(json!({"success": true, "data": data}));
    }
    Err(format!("Unable to resolve news article details for '{}'", target_slug))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let mut id = query.get("id").cloned().unwrap_or_default();
    if id.is_empty() {
        if let Some(Json(b)) = &body { id = b.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(); }
    }
    if id.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "error": "Parameter 'id' wajib diisi"}))).into_response();
    }
    match get_news_detail(&id).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": e}))).into_response(),
    }
}

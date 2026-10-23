
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://vtuberspace.id";
const API_BASE: &str = "https://vtuberspace.id/api/v1";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

fn merged(query: &HashMap<String, String>, body: Option<&Value>) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in query { m.insert(k.clone(), json!(v)); }
    if let Some(Value::Object(b)) = body { for (k, v) in b { m.insert(k.clone(), v.clone()); } }
    m
}

fn pstr<'a>(m: &'a serde_json::Map<String, Value>, k: &str) -> Option<&'a str> {
    m.get(k).and_then(|v| v.as_str())
}

fn pint(m: &serde_json::Map<String, Value>, k: &str, dflt: i64) -> i64 {
    m.get(k)
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(dflt)
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"success": false, "error": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": msg}))).into_response()
}

fn vs_client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap()
}

async fn api_get(path: &str) -> Result<Value, String> {
    let res = vs_client()
        .get(format!("{}{}", API_BASE, path))
        .header("User-Agent", UA)
                    .header("Accept", "application/json, text/plain, */*")
        .header("Referer", format!("{}/", BASE_URL))
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| format!("invalid JSON response: {}", e))?;
    if !status.is_success() { return Err(format!("HTTP {}", status.as_u16())); }
    Ok(v)
}

async fn get_text(url: &str) -> Result<String, String> {
    let res = vs_client()
        .get(url)
        .header("User-Agent", UA)
        .header("Referer", format!("{}/", BASE_URL))
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let t = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("HTTP {}", status.as_u16())); }
    Ok(t)
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty() && s != "false" && s != "0",
        _ => false,
    }
}

fn abs_url(v: &Value) -> Value {
    let s = match v.as_str() { Some(s) if !s.is_empty() => s, _ => return Value::Null };
    if s.starts_with("http://") || s.starts_with("https://") { return json!(s); }
    if s.starts_with("//") { return json!(format!("https:{}", s)); }
    if s.starts_with('/') { return json!(format!("{}{}", BASE_URL, s)); }
    json!(format!("{}/{}", BASE_URL, s))
}

fn or_null(v: &Value, k: &str) -> Value {
    match v.get(k) { Some(Value::Null) | None => Value::Null, Some(x) => x.clone() }
}

fn clean_vtuber(item: &Value) -> Value {
    if !item.is_object() { return Value::Null; }
    let agency = match item.get("agency") {
        Some(a) if a.is_object() => json!({
            "id": or_null(a, "id"),
            "name": or_null(a, "name"),
            "slug": or_null(a, "slug"),
            "description": or_null(a, "description"),
            "logo": abs_url(a.get("logo").unwrap_or(&Value::Null)),
            "banner": abs_url(a.get("banner").unwrap_or(&Value::Null)),
            "is_indie": truthy(a.get("is_indie").unwrap_or(&Value::Bool(false))),
        }),
        _ => Value::Null,
    };
    let images = item.get("images").and_then(|v| v.as_array()).map(|arr| {
        Value::Array(arr.iter().filter(|i| i.is_object()).map(|i| json!({
            "id": or_null(i, "id"),
            "title": or_null(i, "title"),
            "url": abs_url(i.get("url").unwrap_or(&Value::Null)),
        })).collect())
    }).unwrap_or_else(|| json!([]));
    let gender = if truthy(item.get("female").unwrap_or(&Value::Bool(false))) {
        json!("Female")
    } else if truthy(item.get("male").unwrap_or(&Value::Bool(false))) {
        json!("Male")
    } else {
        Value::Null
    };
    json!({
        "id": or_null(item, "id"),
        "name": or_null(item, "name"),
        "original_name": or_null(item, "original_name"),
        "slug": or_null(item, "slug"),
        "bio": or_null(item, "bio"),
        "avatar": abs_url(item.get("avatar").unwrap_or(&Value::Null)),
        "banner": abs_url(item.get("banner").unwrap_or(&Value::Null)),
        "oshi_color": or_null(item, "oshi_color"),
        "oshi_mark": or_null(item, "oshi_mark"),
        "tgl_debut": or_null(item, "tgl_debut"),
        "date_debut": or_null(item, "date_debut"),
        "gender": gender,
        "artist": or_null(item, "artist"),
        "rigging": or_null(item, "rigging"),
        "link_perkenalan": or_null(item, "link_perkenalan"),
        "link_youtube": or_null(item, "link_youtube"),
        "social_links": or_null(item, "social_links"),
        "email": or_null(item, "email"),
        "agency": agency,
        "images": images,
    })
}

fn clean_news(item: &Value) -> Value {
    if !item.is_object() { return Value::Null; }
    let author = match item.get("author") {
        Some(a) if a.is_object() => json!({
            "id": or_null(a, "id"),
            "name": or_null(a, "display_name"),
            "slug": or_null(a, "slug"),
            "avatar": abs_url(a.get("avatar").unwrap_or(&Value::Null)),
        }),
        _ => Value::Null,
    };
    let categories = item.get("categories").and_then(|v| v.as_array()).map(|arr| {
        Value::Array(arr.iter().filter(|c| c.is_object()).map(|c| json!({
            "id": or_null(c, "id"), "name": or_null(c, "name"), "slug": or_null(c, "slug"),
            "description": or_null(c, "description"),
        })).collect())
    }).unwrap_or_else(|| json!([]));
    let tags = item.get("tags").and_then(|v| v.as_array()).map(|arr| {
        Value::Array(arr.iter().filter(|t| t.is_object()).map(|t| json!({
            "id": or_null(t, "id"), "name": or_null(t, "name"), "slug": or_null(t, "slug"),
        })).collect())
    }).unwrap_or_else(|| json!([]));
    let related = item.get("related_vtubers").and_then(|v| v.as_array()).map(|arr| {
        Value::Array(arr.iter().map(clean_vtuber).collect())
    }).unwrap_or_else(|| json!([]));
    let images = item.get("images").and_then(|v| v.as_array()).map(|arr| {
        Value::Array(arr.iter().filter(|i| i.is_object()).map(|i| json!({
            "id": or_null(i, "id"), "name": or_null(i, "name"),
            "url": abs_url(i.get("url").unwrap_or(&Value::Null)),
        })).collect())
    }).unwrap_or_else(|| json!([]));
    json!({
        "id": or_null(item, "id"),
        "title": or_null(item, "title"),
        "slug": or_null(item, "slug"),
        "excerpt": or_null(item, "excerpt"),
        "content": or_null(item, "content"),
        "thumbnail": abs_url(item.get("thumbnail").unwrap_or(&Value::Null)),
        "status": or_null(item, "status"),
        "published_at": or_null(item, "published_at"),
        "created_at": or_null(item, "created_at"),
        "updated_at": or_null(item, "updated_at"),
        "is_featured": truthy(item.get("is_featured").unwrap_or(&Value::Bool(false))),
        "view_count": item.get("view_count").cloned().unwrap_or(json!(0)),
        "like_count": item.get("like_count").cloned().unwrap_or(json!(0)),
        "reading_time": or_null(item, "reading_time"),
        "author": author,
        "categories": categories,
        "tags": tags,
        "related_vtubers": related,
        "images": images,
    })
}

fn views(v: &Value) -> i64 {
    v.get("view_count").and_then(|x| x.as_i64()).unwrap_or(0)
}

fn sort_news(list: &mut Vec<Value>, sort: &str) {
    match sort {
        "popular" => list.sort_by(|a, b| views(b).cmp(&views(a))),
        "oldest" => list.sort_by(|a, b| pub_at(a).cmp(&pub_at(b))),
        _ => list.sort_by(|a, b| pub_at(b).cmp(&pub_at(a))),
    }
}

fn pub_at(v: &Value) -> String {
    v.get("published_at").and_then(|x| x.as_str()).unwrap_or("").to_string()
}

// Re-implements lib.js getNews (fetch full list, filter, sort, paginate).
async fn get_news(category: Option<&str>, tag: Option<&str>, search: Option<&str>, featured_only: bool, sort: &str, page: i64, page_size: i64) -> Result<Value, String> {
    let json = api_get("/posts?page=1&page_size=100").await?;
    let mut list: Vec<Value> = json.get("data").and_then(|d| d.as_array())
        .map(|a| a.iter().map(clean_news).filter(|v| v.is_object()).collect())
        .unwrap_or_default();
    if let Some(cat) = category {
        let c = cat.to_lowercase();
        if c != "all" && c != "semua" {
            let c = c.trim().to_string();
            list.retain(|p| p.get("categories").and_then(|v| v.as_array()).map(|cats| cats.iter().any(|x| {
                x.get("slug").and_then(|s| s.as_str()).map(|s| s.to_lowercase() == c).unwrap_or(false)
                    || x.get("name").and_then(|s| s.as_str()).map(|s| s.to_lowercase() == c).unwrap_or(false)
            })).unwrap_or(false));
        }
    }
    if let Some(t) = tag {
        let t = t.to_lowercase().trim().to_string();
        list.retain(|p| p.get("tags").and_then(|v| v.as_array()).map(|tags| tags.iter().any(|x| {
            x.get("slug").and_then(|s| s.as_str()).map(|s| s.to_lowercase() == t).unwrap_or(false)
                || x.get("name").and_then(|s| s.as_str()).map(|s| s.to_lowercase() == t).unwrap_or(false)
        })).unwrap_or(false));
    }
    if featured_only {
        list.retain(|p| p.get("is_featured").and_then(|v| v.as_bool()).unwrap_or(false));
    }
    if let Some(q) = search {
        let q = q.to_lowercase().trim().to_string();
        list.retain(|p| {
            let title = p.get("title").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            let excerpt = p.get("excerpt").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            let tag_hit = p.get("tags").and_then(|v| v.as_array()).map(|tags| tags.iter().any(|t| {
                t.get("name").and_then(|s| s.as_str()).map(|s| s.to_lowercase().contains(&q)).unwrap_or(false)
            })).unwrap_or(false);
            title.contains(&q) || excerpt.contains(&q) || tag_hit
        });
    }
    sort_news(&mut list, sort);
    let total = list.len() as i64;
    let total_pages = ((total + page_size - 1) / page_size).max(1);
    let start = ((page - 1) * page_size) as usize;
    let data: Vec<Value> = list.into_iter().skip(start).take(page_size as usize).collect();
    Ok(json!({
        "success": true,
        "filter": { "category": category.unwrap_or("all"), "tag": tag, "sort": sort, "search": search },
        "meta": { "page": page, "page_size": page_size, "total": total, "total_page": total_pages },
        "data": data,
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_deref());
    let page = pint(&params, "page", 1);
    let page_size = pint(&params, "pageSize", 100);
    let path = format!("/agencies?page={}&page_size={}", page, page_size);
    match api_get(&path).await {
        Ok(json) => {
            let cleaned: Vec<Value> = json.get("data").and_then(|d| d.as_array()).map(|a| a.iter().map(|ag| json!({
                "id": or_null(ag, "id"),
                "name": or_null(ag, "name"),
                "slug": or_null(ag, "slug"),
                "description": or_null(ag, "description"),
                "logo": abs_url(ag.get("logo").unwrap_or(&Value::Null)),
                "banner": abs_url(ag.get("banner").unwrap_or(&Value::Null)),
                "is_indie": truthy(ag.get("is_indie").unwrap_or(&Value::Bool(false))),
            })).collect()).unwrap_or_default();
            Json(json!({
                "success": true,
                "data": cleaned,
                "meta": json.get("meta").cloned().unwrap_or_else(|| json!({"page": page, "page_size": page_size, "total": 0, "total_page": 1})),
            })).into_response()
        }
        Err(e) => server_err(&format!("Failed to fetch agencies list ({})", e)),
    }
}

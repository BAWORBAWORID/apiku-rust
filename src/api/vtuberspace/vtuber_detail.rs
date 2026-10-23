// VTuber Detail — native conversion of api/vtuberspace/vtuber-detail.js
// Self-contained: replicates lib.js getVtuberDetail + cleanVtuber + searchVtuber + ld+json fallback.
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

async fn fetch_json(url: &str) -> Result<Value, String> {
    let res = client().get(url).headers(default_headers())
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("HTTP {}", status)); }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Mirrors lib.js searchVtuber: q with dashes replaced by spaces.
async fn search_vtuber(query: &str, limit: u32) -> Result<Vec<Value>, String> {
    let normalized = query.trim().replace('-', " ");
    let url = format!("{}/vtubers/search?q={}&limit={}", API_BASE, urlencoding::encode(&normalized), limit);
    let json = fetch_json(&url).await.map_err(|_| format!("Failed to search VTuber"))?;
    let raw = json.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(raw.iter().map(clean_vtuber).collect())
}

/// ld+json Person fallback.
fn vtuber_from_ld_json(html: &str, target_slug: &str) -> Option<Value> {
    let re = regex::Regex::new(r#"(?is)<script\b[^>]*type="application/ld\+json"[^>]*>(.*?)</script>"#).unwrap();
    for cap in re.captures_iter(html) {
        let content = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if !content.contains(r#""@type":"Person""#) && !content.contains("jobTitle") { continue; }
        let Ok(ld) = serde_json::from_str::<Value>(content.trim()) else { continue };
        let agency = ld.get("memberOf").filter(|a| a.is_object()).map(|a| json!({
            "id": Value::Null, "name": a.get("name").cloned().unwrap_or(Value::Null),
            "slug": Value::Null, "description": Value::Null,
            "logo": Value::Null, "banner": Value::Null, "is_indie": false,
        })).unwrap_or(Value::Null);
        return Some(json!({
            "id": Value::Null,
            "name": ld.get("name").cloned().unwrap_or(Value::Null),
            "original_name": Value::Null,
            "slug": target_slug,
            "bio": ld.get("description").cloned().unwrap_or(Value::Null),
            "avatar": to_absolute_url(ld.get("image")),
            "banner": Value::Null,
            "oshi_color": Value::Null,
            "oshi_mark": Value::Null,
            "tgl_debut": Value::Null,
            "date_debut": Value::Null,
            "gender": Value::Null,
            "artist": Value::Null,
            "rigging": Value::Null,
            "link_perkenalan": Value::Null,
            "link_youtube": Value::Null,
            "social_links": {},
            "email": Value::Null,
            "agency": agency,
            "images": [],
        }));
    }
    None
}

async fn get_vtuber_detail(id_or_slug: &str) -> Result<Value, String> {
    if id_or_slug.trim().is_empty() { return Err("VTuber ID or slug is required".into()); }

    if regex::Regex::new(r"^\d+$").unwrap().is_match(id_or_slug.trim()) {
        let data = fetch_json(&format!("{}/vtubers/{}", API_BASE, id_or_slug.trim())).await
            .map_err(|_| format!("VTuber with ID {} not found", id_or_slug.trim()))?;
        return Ok(json!({"success": true, "data": clean_vtuber(&data.get("data").cloned().unwrap_or(json!({})))}));
    }

    let target_slug = id_or_slug.trim().to_lowercase();
    // search + match slug or dash-to-space name
    let candidates = search_vtuber(&target_slug, 10).await.unwrap_or_default();
    let found = candidates.iter().find(|v| {
        let slug_ok = v.get("slug").and_then(|s| s.as_str()).map(|s| s.to_lowercase()) == Some(target_slug.clone());
        let name_ok = v.get("name").and_then(|s| s.as_str())
            .map(|s| s.to_lowercase() == target_slug.replace('-', " "))
            .unwrap_or(false);
        slug_ok || name_ok
    });
    if let Some(found) = found {
        let fid = found.get("id").cloned().unwrap_or(Value::Null);
        let id_str = fid.as_str().map(|s| s.to_string())
            .or_else(|| fid.as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        if let Ok(detail) = fetch_json(&format!("{}/vtubers/{}", API_BASE, id_str)).await {
            return Ok(json!({"success": true, "data": clean_vtuber(&detail.get("data").cloned().unwrap_or(found.clone()))}));
        }
        return Ok(json!({"success": true, "data": found.clone()}));
    }

    // HTML fallback
    let url = format!("{}/vtuber/{}", BASE_URL, urlencoding::encode(&target_slug));
    let res = client().get(&url).headers(default_headers()).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("VTuber with slug '{}' not found", target_slug));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    if let Some(data) = vtuber_from_ld_json(&html, &target_slug) {
        return Ok(json!({"success": true, "data": data}));
    }
    Err(format!("Unable to resolve VTuber details for '{}'", target_slug))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let mut id = query.get("id").cloned().unwrap_or_default();
    if id.is_empty() {
        if let Some(Json(b)) = &body { id = b.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(); }
    }
    if id.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "error": "Parameter 'id' wajib diisi"}))).into_response();
    }
    match get_vtuber_detail(&id).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": e}))).into_response(),
    }
}

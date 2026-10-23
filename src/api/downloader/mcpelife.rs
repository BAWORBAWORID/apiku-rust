// MCPelife Scraper — native conversion of api/downloader/mcpelife.js
// Info/menu/schema/boxes extraction from mcpelife.com HTML.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn attr_from<'a>(html: &'a str, start: usize, attr: &str) -> String {
    let seg = &html[start..];
    let pat = format!("{attr}=\"");
    match seg.find(&pat) {
        Some(j) => seg[j + pat.len()..].split('"').next().unwrap_or("").to_string(),
        None => String::new(),
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "action"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let target_url = merged.get("url").cloned().unwrap_or_else(|| "https://mcpelife.com/".into());
    if !target_url.starts_with("https://mcpelife.com/") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL harus dari domain mcpelife.com"
        }))).into_response();
    }
    let action = merged.get("action").cloned().unwrap_or_else(|| "all".into());

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal fetch: {e}")
        }))).into_response(),
    };

    let html = match client.get(&target_url).header("User-Agent", UA).send().await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal fetch: {e}")
        }))).into_response(),
    };
    if html.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Gagal mengambil halaman"
        }))).into_response();
    }

    // extractInfo
    let title = html.find("<title>").map(|i| {
        let rest = &html[i + 7..];
        rest.split('<').next().unwrap_or("").trim().to_string()
    }).unwrap_or_else(|| "Tidak ditemukan".into());
    let meta_desc = html.find("name=\"description\"").map(|i| attr_from(&html, i, "content")).unwrap_or_default().chars().take(200).collect::<String>();
    let schema: Value = html.find("application/ld+json").and_then(|i| {
        let seg = &html[i..];
        let gt = seg.find('>')?;
        let end = seg[gt..].find("</script>")?;
        let raw = seg[gt + 1..gt + end].trim();
        serde_json::from_str(raw).ok()
    }).unwrap_or(Value::Null);
    let logo = html.find("a.logo").and_then(|i| Some(attr_from(&html, i, "href"))).filter(|s| !s.is_empty()).unwrap_or_else(|| "https://mcpelife.com/".into());
    let menu: Vec<String> = {
        let mut items = Vec::new();
        if let Some(i) = html.find("mainmenu") {
            let seg = &html[i..];
            let end = seg.find("</nav>").unwrap_or(seg.len().min(50_000));
            let mut rest = &seg[..end];
            while let Some(a) = rest.find("<a ") {
                let href = attr_from(rest, a, "href");
                if !href.is_empty() {
                    items.push(href);
                }
                rest = &rest[a + 3..];
                if items.len() >= 10 {
                    break;
                }
            }
        }
        items
    };
    let box_count = html.matches("class=\"box\"").count() + html.matches("class='box'").count();
    let first_box_preview = html.find("class=\"box\"").map(|i| {
        let seg = &html[i..];
        let gt = seg.find('>').map(|p| p + 1).unwrap_or(0);
        let end = seg[gt..].find("</div>").unwrap_or(200.min(seg.len() - gt));
        seg[gt..gt + end].trim().chars().take(200).collect::<String>()
    }).unwrap_or_else(|| "Kosong".into());

    let result = match action.as_str() {
        "info" => json!({ "title": title, "meta_description": meta_desc, "logo": logo }),
        "menu" => json!({ "menu": menu }),
        "schema" => json!({ "schema": schema }),
        "boxes" => json!({ "box_count": box_count, "first_box_preview": first_box_preview }),
        _ => json!({
            "title": title, "meta_description": meta_desc, "schema_json_ld": schema,
            "logo": logo, "menu": menu, "box_count": box_count, "first_box_preview": first_box_preview
        }),
    };

    Json(json!({ "status": true, "result": result })).into_response()
}

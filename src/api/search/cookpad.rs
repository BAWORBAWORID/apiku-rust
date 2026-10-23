// Cookpad — native conversion of api/search/cookpad.js
// actions: search (resep) dan detail (JSON-LD Recipe) dari cookpad.com/id.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

async fn search_recipes(client: &reqwest::Client, q: &str, page: u32) -> Result<Vec<Value>, String> {
    let url = if page > 1 {
        format!("https://cookpad.com/id/cari/{}?page={}", urlencoding::encode(q), page)
    } else {
        format!("https://cookpad.com/id/cari/{}", urlencoding::encode(q))
    };
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = scraper::Html::parse_document(&html);
    let mut results = Vec::new();
    if let (Ok(sel_li), Ok(sel_a)) = (
        scraper::Selector::parse("#search-recipes-list > li[id^=\"recipe_\"]"),
        scraper::Selector::parse("a.block-link__main"),
    ) {
        for li in document.select(&sel_li) {
            let id = li.value().attr("id").unwrap_or("").replace("recipe_", "");
            if id.is_empty() {
                continue;
            }
            let title = li
                .select(&sel_a)
                .next()
                .map(|a| a.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            if title.is_empty() {
                continue;
            }
            let author = scraper::Selector::parse("img[alt][title]")
                .ok()
                .and_then(|sel| li.select(&sel).last().and_then(|img| img.value().attr("alt").map(str::to_string)))
                .or_else(|| {
                    scraper::Selector::parse("span.break-all span")
                        .ok()
                        .and_then(|sel| li.select(&sel).last().map(|s| s.text().collect::<String>().trim().to_string()))
                });
            let mise_text = |icon_class: &str| -> Option<String> {
                scraper::Selector::parse(&format!(".{} .mise-icon-text", icon_class))
                    .ok()
                    .and_then(|sel| li.select(&sel).next().map(|s| s.text().collect::<String>().trim().to_string()))
            };
            let duration = mise_text("mise-icon-time");
            let servings = mise_text("mise-icon-user");

            let mut ingredients_preview = Vec::new();
            if let Ok(sel) = scraper::Selector::parse("[data-ingredients-redesign-target=\"ingredients\"] .line-clamp-2") {
                if let Some(el) = li.select(&sel).next() {
                    let text = el.text().collect::<String>();
                    for t in text.split('\u{2022}') {
                        let clean = t.trim();
                        if clean.len() > 1 {
                            ingredients_preview.push(clean.to_string());
                        }
                    }
                }
            }
            ingredients_preview.truncate(8);

            let image = scraper::Selector::parse("img[src*=\"cpcdn.com/recipes\"]")
                .ok()
                .and_then(|sel| li.select(&sel).next().and_then(|img| img.value().attr("src").map(str::to_string)));

            results.push(json!({
                "id": id,
                "title": title,
                "author": author,
                "duration": duration,
                "servings": servings,
                "ingredientsPreview": ingredients_preview,
                "image": image,
                "url": format!("https://cookpad.com/id/resep/{}", id),
            }));
        }
    }
    Ok(results)
}

async fn recipe_detail(client: &reqwest::Client, id_or_url: &str) -> Result<Value, String> {
    let digits: String = id_or_url.chars().filter(|c| c.is_ascii_digit()).collect();
    let id = if digits.is_empty() { id_or_url.to_string() } else { digits };
    let html = client
        .get(format!("https://cookpad.com/id/resep/{}", id))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let document = scraper::Html::parse_document(&html);
    let mut recipe: Option<Value> = None;
    if let Ok(sel) = scraper::Selector::parse("script[type=\"application/ld+json\"]") {
        for script in document.select(&sel) {
            let text = script.text().collect::<String>();
            if let Ok(j) = serde_json::from_str::<Value>(text.trim()) {
                if j.get("@type").and_then(Value::as_str) == Some("Recipe") {
                    recipe = Some(j);
                    break;
                }
            }
        }
    }
    let recipe = recipe.ok_or("Recipe not found")?;

    let steps: Vec<Value> = recipe
        .get("recipeInstructions")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|s| {
                    let images: Vec<Value> = match s.get("image") {
                        Some(Value::Array(a)) => a.clone(),
                        Some(img) if !img.is_null() => vec![img.clone()],
                        _ => vec![],
                    };
                    json!({
                        "text": s.get("text").cloned().unwrap_or_else(|| s.clone()),
                        "images": images,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let ingredients: Vec<String> = recipe
        .get("recipeIngredient")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    Ok(json!({
        "id": id,
        "title": recipe.get("name").cloned().unwrap_or(Value::Null),
        "description": recipe.get("description").cloned().unwrap_or(json!("")),
        "image": match recipe.get("image") {
            Some(Value::Array(a)) => a.first().cloned().unwrap_or(Value::Null),
            Some(img) => img.clone(),
            None => Value::Null,
        },
        "author": recipe.pointer("/author/name").cloned().unwrap_or(json!("")),
        "authorUrl": recipe.pointer("/author/url").cloned().unwrap_or(json!("")),
        "yield": recipe.get("recipeYield").cloned().unwrap_or(json!("")),
        "cuisine": recipe.get("recipeCuisine").cloned().unwrap_or(json!("")),
        "datePublished": recipe.get("datePublished").cloned().unwrap_or(json!("")),
        "ingredients": ingredients,
        "steps": steps,
        "url": format!("https://cookpad.com/id/resep/{}", id),
    }))
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

    let action = get_param("action").unwrap_or_else(|| "search".to_string());
    let page: u32 = get_param("page").and_then(|p| p.parse().ok()).unwrap_or(1).max(1);

    let http = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mengakses Cookpad: {e}")),
    };

    if action == "detail" {
        let id = match get_param("id").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(i) => i,
            None => return err(StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=detail"),
        };
        return match recipe_detail(&http, &id).await {
            Ok(v) => Json(json!({"status": true, "result": v})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    if action == "search" {
        let q = match get_param("query").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(q) => q,
            None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk action=search"),
        };
        return match search_recipes(&http, &q, page).await {
            Ok(recipes) if !recipes.is_empty() => Json(json!({
                "status": true,
                "result": {"query": q, "page": page, "total": recipes.len(), "recipes": recipes}
            }))
            .into_response(),
            Ok(_) => err(StatusCode::NOT_FOUND, "Resep tidak ditemukan"),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mengakses Cookpad: {e}")),
        };
    }

    err(StatusCode::BAD_REQUEST, "action harus 'search' atau 'detail'")
}

// Kodepos — native conversion of api/tools/kodepos.js (posindonesia scraper)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    };

    let location = match get("location") {
        Some(l) if !l.trim().is_empty() => l.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'location' is required",
                "example": {
                    "GET": "/api/tools/kodepos?location=pasiran%20jaya",
                    "POST": { "location": "pasiran jaya" }
                }
            }))
            .into_response()
        }
    };

    let type_param = get("type").unwrap_or_else(|| "all".to_string());
    let valid_types = ["all", "province", "city", "district", "village"];
    if !valid_types.contains(&type_param.as_str()) {
        return Json(json!({
            "status": false,
            "message": format!("Invalid type '{}'", type_param),
            "valid_types": valid_types,
        }))
        .into_response();
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| state.client.clone());

    let resp = client
        .post("https://kodepos.posindonesia.co.id/CariKodepos")
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Cache-Control", "max-age=0")
                    .header("Origin", "https://kodepos.posindonesia.co.id")
                    .header("Referer", "https://kodepos.posindonesia.co.id/")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .body(format!("kodepos={}", urlencoding::encode(&location)))
        .send()
        .await;

    let html = match resp {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(h) => h,
            Err(e) => return Json(json!({"status": false, "message": format!("Scraping failed: {}", e), "suggestion": "Try again later or use a different search term"})).into_response(),
        },
        Ok(r) => {
            return Json(json!({
                "status": false,
                "message": format!("Website responded with status: {}", r.status().as_u16()),
                "suggestion": "Try again later or use a different search term"
            }))
            .into_response()
        }
        Err(e) => {
            return Json(json!({
                "status": false,
                "message": format!("No response from postal code website: {}", e),
                "suggestion": "Try again later or use a different search term"
            }))
            .into_response()
        }
    };

    // Parse tbody rows via regex (each <td>...</td>)
    let td_re = Regex::new(r"(?is)<td[^>]*>(.*?)</td>").unwrap();
    let tr_re = Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").unwrap();
    let tag_re = Regex::new(r"(?s)<[^>]+>").unwrap();

    let mut results: Vec<Value> = Vec::new();
    for cap in tr_re.captures_iter(&html) {
        let row = &cap[1];
        let tds: Vec<String> = td_re
            .captures_iter(row)
            .map(|c| tag_re.replace_all(&c[1], "").trim().to_string())
            .collect();
        if tds.len() >= 5 {
            let kodepos = &tds[1];
            let desa = &tds[2];
            let kecamatan = &tds[3];
            let kota = &tds[4];
            let provinsi = tds.get(5).cloned().unwrap_or_default();
            if !kodepos.is_empty() && !desa.is_empty() {
                results.push(json!({
                    "kodepos": kodepos,
                    "desa": desa,
                    "kecamatan": kecamatan,
                    "kota": kota,
                    "provinsi": provinsi,
                }));
            }
        }
    }

    if results.is_empty() {
        return Json(json!({
            "status": false,
            "message": "No postal codes found for the given location",
            "suggestion": "Try a more specific location name or check spelling"
        }))
        .into_response();
    }

    let mut filtered: Vec<Value> = results;
    if type_param != "all" {
        let location_lower = location.to_lowercase();
        filtered = filtered
            .into_iter()
            .filter(|item| {
                let f = |k: &str| {
                    item.get(k)
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_lowercase().contains(&location_lower))
                        .unwrap_or(false)
                };
                match type_param.as_str() {
                    "province" => f("provinsi"),
                    "city" => f("kota"),
                    "district" => f("kecamatan"),
                    "village" => f("desa"),
                    _ => true,
                }
            })
            .collect();
    }

    let unique = |items: &[Value], key: &str| -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        items
            .iter()
            .filter_map(|v| v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string()))
            .filter(|s| seen.insert(s.clone()))
            .collect()
    };

    Json(json!({
        "status": true,
        "result": {
            "query": location,
            "type": type_param,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "data": filtered,
            "summary": {
                "total_results": filtered.len(),
                "unique_provinces": unique(&filtered, "provinsi"),
                "unique_cities": unique(&filtered, "kota"),
                "unique_districts": unique(&filtered, "kecamatan"),
                "postal_codes": unique(&filtered, "kodepos"),
                "search_query": location,
                "search_type": type_param,
            },
            "note": "Official Indonesian postal code database"
        }
    })).into_response()

}

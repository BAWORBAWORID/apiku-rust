use axum::{extract::State, response::IntoResponse, Json};
use rand::seq::SliceRandom;
use serde_json::{json, Value};
use std::sync::OnceLock;
use crate::state::AppState;

// ==================== Local Dataset ====================
// File: src/api/random/assets/quotesanime.json (disertakan saat compile via include_str!)
const QUOTES_JSON: &str = include_str!("assets/quotesanime.json");

// In-memory cache: parse sekali saat startup, simpan selamanya
static QUOTES_CACHE: OnceLock<Vec<Value>> = OnceLock::new();

fn get_quotes() -> &'static Vec<Value> {
    QUOTES_CACHE.get_or_init(|| {
        let raw: Value = serde_json::from_str(QUOTES_JSON)
            .expect("quotesanime.json parse error");

        // Ambil array dari berbagai format
        let arr: Vec<Value> = if let Some(a) = raw.as_array() {
            a.clone()
        } else if let Some(a) = raw.get("quotes").and_then(|v| v.as_array()) {
            a.clone()
        } else if let Some(a) = raw.get("data").and_then(|v| v.as_array()) {
            a.clone()
        } else if let Some(a) = raw.get("result").and_then(|v| v.as_array()) {
            a.clone()
        } else {
            panic!("Format quotesanime.json tidak dikenali");
        };

        // Normalisasi ke { quotes, karakter, anime }
        arr.iter()
            .filter_map(|item| {
                let quote = item.get("quote")
                    .or_else(|| item.get("text"))
                    .or_else(|| item.get("kata"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let karakter = item.get("character")
                    .or_else(|| item.get("char"))
                    .or_else(|| item.get("tokoh"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let anime = item.get("anime")
                    .or_else(|| item.get("title"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());

                quote.map(|q| json!({
                    "quotes": q,
                    "karakter": karakter,
                    "anime": anime,
                }))
            })
            .collect()
    })
}

pub async fn handler(_state: axum::extract::State<AppState>) -> impl IntoResponse {
    let quotes = get_quotes();
    let mut rng = rand::thread_rng();

    match quotes.choose(&mut rng) {
        Some(selected) => Json(json!({
            "status": true,
            "result": selected
        })),
        None => Json(json!({
            "status": false,
            "message": "Quotes kosong",
            "attribution": "@zyvorapi"
        })),
    }
}

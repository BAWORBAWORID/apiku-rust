// Tebak Hero ML — native conversion of api/games/tebakheroml.js
// Node version used Puppeteer+Stealth to scrape fandom HTML. Rust version uses the
// official MediaWiki API (api.php images + imageinfo) — no browser needed, faster
// and not Cloudflare-blocked.
use axum::{
    extract::{Query, State},
    response::{IntoResponse, Json},
};
use rand::seq::SliceRandom;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Instant;

use crate::state::AppState;
use super::common::random_game_handler;

const HEROES: &[&str] = &[
    "Aamon", "Akai", "Aldous", "Alice", "Alpha", "Alucard", "Angela", "Argus",
    "Arlott", "Atlas", "Aulus", "Aurora", "Badang", "Balmond", "Bane", "Barats",
    "Baxia", "Beatrix", "Belerick", "Benedetta", "Brody", "Bruno", "Carmilla",
    "Cecilion", "Chou", "Cici", "Claude", "Clint", "Cyclops", "Diggie", "Dyrroth",
    "Edith", "Esmeralda", "Estes", "Eudora", "Fanny", "Faramis", "Floryn",
    "Franco", "Fredrinn", "Freya", "Gatotkaca", "Gloo", "Gord", "Granger",
    "Grock", "Guinevere", "Gusion", "Hanabi", "Hanzo", "Harith", "Harley",
    "Hayabusa", "Helcurt", "Hilda", "Hylos", "Irithel", "Ixia", "Jawhead",
    "Johnson", "Joy", "Julian", "Kadita", "Kagura", "Kaja", "Karina", "Karrie",
    "Khaleed", "Khufra", "Kimmy", "Lancelot", "Layla", "Leomord", "Lesley",
    "Ling", "Lolita", "Lunox", "Luo Yi", "Lylia", "Martis", "Masha", "Mathilda",
    "Melissa", "Minotaur", "Minsitthar", "Miya", "Moskov", "Nana", "Natalia",
    "Natan", "Novaria", "Odette", "Paquito", "Pharsa", "Phoveus",
    "Popol and Kupa", "Rafaela", "Roger", "Ruby", "Saber", "Selena", "Silvanna",
    "Sun", "Terizla", "Thamuz", "Tigreal", "Uranus", "Vale", "Valentina",
    "Valir", "Vexana", "Wanwan", "Xavier", "Yin", "Yu Zhong", "Yve", "Zhask",
    "Zilong",
];

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let start = Instant::now();

    // Optional ?hero= for a specific hero; otherwise random
    let hero = query.get("hero").cloned().filter(|h| !h.trim().is_empty());
    let hero = match hero {
        Some(h) => h,
        None => (*HEROES.choose(&mut rand::thread_rng()).unwrap()).to_string(),
    };
    let formatted = hero.replace(' ', "_");
    let _ = &state;
    let client = &state.client;

    // 1. List audio files on the /Audio/id subpage via MediaWiki API
    let list_url = format!(
        "https://mobile-legends.fandom.com/api.php?action=query&titles={}%2FAudio%2Fid&prop=images&format=json&imlimit=200",
        urlencoding::encode(&formatted)
    );
    let list_json: Value = match client
        .get(&list_url)
        .header("User-Agent", UA)
        
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(e) => {
                return Json(json!({
                    "status": false, "code": "API_ERROR",
                    "message": format!("Gagal mengambil daftar audio: {e}"),
                    "responseTime": format!("{}ms", start.elapsed().as_millis())
                })).into_response();
            }
        },
        Err(e) => {
            return Json(json!({
                "status": false, "code": "REQUEST_ERROR",
                "message": format!("Gagal menghubungi fandom: {e}"),
                "responseTime": format!("{}ms", start.elapsed().as_millis())
            })).into_response();
        }
    };

    let files: Vec<String> = list_json["query"]["pages"]
        .as_object()
        .map(|pages| {
            pages
                .values()
                .filter_map(|p| p.get("images").and_then(Value::as_array))
                .flatten()
                .filter_map(|img| img.get("title").and_then(Value::as_str))
                .filter(|t| {
                    let tl = t.to_lowercase();
                    tl.ends_with(".ogg") || tl.ends_with(".mp3")
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    if files.is_empty() {
        return Json(json!({
            "status": false,
            "code": "NO_AUDIO_FOUND",
            "message": format!("Tidak ada audio ditemukan untuk hero {hero}"),
            "responseTime": format!("{}ms", start.elapsed().as_millis())
        })).into_response();
    }

    // 2. Pick one file and resolve its direct URL via imageinfo
    let chosen = files.choose(&mut rand::thread_rng()).unwrap().clone();
    let info_url = format!(
        "https://mobile-legends.fandom.com/api.php?action=query&titles={}&prop=imageinfo&iiprop=url&format=json",
        urlencoding::encode(&chosen)
    );
    let audio_url = match client
        .get(&info_url)
        .header("User-Agent", UA)
        
        .send()
        .await
    {
        Ok(r) => match r.json::<Value>().await {
            Ok(j) => j["query"]["pages"]
                .as_object()
                .and_then(|pages| pages.values().next())
                .and_then(|p| p.pointer("/imageinfo/0/url").and_then(Value::as_str))
                .map(str::to_string),
            Err(_) => None,
        },
        Err(_) => None,
    };

    let audio_url = match audio_url {
        Some(u) => u,
        None => {
            return Json(json!({
                "status": false, "code": "NO_AUDIO_URL",
                "message": "Gagal mendapatkan URL audio",
                "responseTime": format!("{}ms", start.elapsed().as_millis())
            }))
            .into_response();
        }
    };

    Json(json!({
        "status": true,
        "result": {
            "hero": hero,
            "file": chosen,
            "audio": audio_url
        },
        "responseTime": format!("{}ms", start.elapsed().as_millis())
    })).into_response()
}

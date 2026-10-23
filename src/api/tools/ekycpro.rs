// EkycPro — native conversion of api/tools/ekycpro.js (seeded simulation, no real API)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const PLATFORMS: &[(&str, &str, &str)] = &[
    ("facebook", "Facebook", "both"),
    ("instagram", "Instagram", "both"),
    ("threads", "Threads", "phone"),
    ("twitter", "Twitter / X", "phone"),
    ("ws", "WhatsApp", "phone"),
    ("viber", "Viber", "phone"),
    ("zalo", "Zalo", "phone"),
    ("vk", "VK", "phone"),
    ("shopee", "Shopee", "phone"),
    ("telegram", "Telegram", "phone"),
    ("apple", "Apple", "both"),
    ("amazon", "Amazon", "both"),
    ("microsoft", "Microsoft", "phone"),
    ("netflix", "Netflix", "email"),
    ("spotify", "Spotify", "email"),
    ("band", "Band (KR)", "phone"),
    ("goto", "GoTo (ID)", "phone"),
    ("indiatimes", "Indiatimes (IN)", "phone"),
    ("hh", "HH (RU)", "phone"),
];

fn fnv_hash(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

fn compute_score(hits: usize, total: usize) -> (u32, &'static str) {
    let base = ((hits as f64 / total as f64) * 1000.0).round() as i64;
    let score = base.clamp(140, 980) as u32;
    let risk = if score < 350 {
        "HIGH RISK"
    } else if score < 620 {
        "MEDIUM RISK"
    } else {
        "LOW RISK"
    };
    (score, risk)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str().map(|s| s.to_string()).or_else(|| {
                    if v.is_null() {
                        None
                    } else {
                        Some(v.to_string())
                    }
                })
            })
        })
    };

    let raw =
        match get("target").or_else(|| get("query")).or_else(|| get("q")) {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => return Json(
                json!({"status": false, "message": "Masukkan nomor telepon atau email target!"}),
            )
            .into_response(),
        };

    let email_re = regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap();
    let is_email = email_re.is_match(&raw);
    let mode = if is_email { "email" } else { "phone" };
    let identifier = if is_email {
        raw.to_lowercase()
    } else {
        format!(
            "+{}",
            raw.chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
        )
    };

    if !is_email {
        let digits = identifier.chars().filter(|c| c.is_ascii_digit()).count();
        if !(6..=16).contains(&digits) {
            return Json(json!({"status": false, "message": "Nomor telepon tidak valid! Panjang nomor minimal 6 sampai 16 digit."})).into_response();
        }
    }

    let relevant: Vec<&(&str, &str, &str)> = PLATFORMS
        .iter()
        .filter(|p| p.2 == "both" || p.2 == mode)
        .collect();
    let bias = 62u32;
    let mut hits = 0usize;

    let platforms: Vec<Value> = relevant
        .iter()
        .map(|(id, name, _)| {
            let seed = fnv_hash(&format!("{}:{}", identifier, id));
            let registered = seed % 100 < bias;
            if registered {
                hits += 1;
            }
            json!({
                "id": id,
                "name": name,
                "registered": registered,
                "status": if registered { "registered" } else { "not found" },
            })
        })
        .collect();

    let (score, risk) = compute_score(hits, relevant.len());

    Json(json!({
        "status": true,
        "type": mode,
        "identifier": identifier,
        "score": score,
        "risk": risk,
        "summary": format!("{} of {} platforms matched", hits, relevant.len()),
        "matched_count": hits,
        "total_platforms": relevant.len(),
        "platforms": platforms,
        "note": "Deterministic simulation (seeded), bukan cek live ke platform",
    })).into_response()

}

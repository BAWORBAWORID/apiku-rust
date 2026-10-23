use axum::{
    extract::{Query, State},
    response::Json,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use tracing::{error, info, warn};

use crate::state::AppState;
use axum::response::{IntoResponse, Response};

const KEY_FILE: &str = "../data/key-reach.json";
const API_ENDPOINT: &str = "https://apiv2.reactionwa.online/api/v2/react";
const GENERATE_ENDPOINT: &str = "https://apiv2.reactionwa.online/api/v2/generate_key";

static LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:https?://)?(?:www\.)?whatsapp\.com/channel/([A-Za-z0-9_-]+)/(\d+)").unwrap()
});

static EMOJI_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}]+").unwrap()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VipProfile {
    pub vip_key: &'static str,
    pub email: &'static str,
    pub uid: &'static str,
    pub domain: &'static str,
}

const VIP_PROFILES: &[VipProfile] = &[
    VipProfile {
        vip_key: "VIP-SYNOZG8C",
        email: "abovezephyrax@gmail.com",
        uid: "syNOzg8C4dfMq8CwnE0inNDNdwn1",
        domain: "https://reactionwa.online",
    },
    VipProfile {
        vip_key: "VIP-G3FA579P",
        email: "berrymodapk@gmail.com",
        uid: "G3FA579Px5MLiC4zISunSqergX43",
        domain: "https://berrymodapk.com",
    },
    VipProfile {
        vip_key: "VIP-D68JICP0",
        email: "pribadiarep@gmail.com",
        uid: "n6eaa7vLSWdexXeCzDnThjqxHps1",
        domain: "https://api.rech.v2.zfile.web.id",
    },
    VipProfile {
        vip_key: "VIP-VIP-D68J",
        email: "pribadiarep@gmail.com",
        uid: "VIP-D68JICPO",
        domain: "https://reactv2.zfile.web.id",
    },
    VipProfile {
        vip_key: "VIP-H9PQGDBA",
        email: "kenznan123@gmail.com",
        uid: "h9PQgdbApBWe1E3p3ZXffnpWOdm1",
        domain: "https://anzzmodsofficial.edgeone.dev/reaction/wa",
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyData {
    #[serde(rename = "vipKey")]
    pub vip_key: String,
    pub email: String,
    pub uid: String,
    pub domain: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub usage_today: Option<u32>,
    pub limit: Option<u32>,
    #[serde(rename = "lastUsedAt")]
    pub last_used_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ReachParams {
    pub link: Option<String>,
    pub url: Option<String>,
    pub emoji: Option<String>,
    pub emojis: Option<String>,
    pub apikey: Option<String>,
}

fn load_key() -> KeyData {
    if Path::new(KEY_FILE).exists() {
        if let Ok(raw) = fs::read_to_string(KEY_FILE) {
            if let Ok(key) = serde_json::from_str::<KeyData>(&raw) {
                return key;
            }
        }
    }
    let p = &VIP_PROFILES[0];
    KeyData {
        vip_key: p.vip_key.to_string(),
        email: p.email.to_string(),
        uid: p.uid.to_string(),
        domain: p.domain.to_string(),
        api_key: String::new(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        usage_today: Some(0),
        limit: Some(50),
        last_used_at: None,
    }
}

fn save_key(key: &KeyData) {
    if let Ok(json) = serde_json::to_string_pretty(key) {
        let _ = fs::write(KEY_FILE, json);
    }
}

pub async fn generate_api_key(client: &reqwest::Client, start_idx: usize) -> Result<KeyData, String> {
    for i in 0..VIP_PROFILES.len() {
        let idx = (start_idx + i) % VIP_PROFILES.len();
        let prof = &VIP_PROFILES[idx];

        let payload = json!({
            "vipKey": prof.vip_key,
            "email": prof.email,
            "domain": prof.domain,
            "uid": prof.uid
        });

        match client.post(GENERATE_ENDPOINT)
            .json(&payload)
                        .header("Content-Type", "application/json")
            .send()
            .await
        {
            Ok(res) => {
                if let Ok(val) = res.json::<Value>().await {
                    if val.get("success").and_then(Value::as_bool).unwrap_or(false) {
                        if let Some(api_key) = val.get("apiKey").and_then(Value::as_str) {
                            let key_data = KeyData {
                                vip_key: prof.vip_key.to_string(),
                                email: prof.email.to_string(),
                                uid: prof.uid.to_string(),
                                domain: prof.domain.to_string(),
                                api_key: api_key.to_string(),
                                updated_at: chrono::Utc::now().to_rfc3339(),
                                usage_today: Some(0),
                                limit: Some(50),
                                last_used_at: None,
                            };
                            save_key(&key_data);
                            return Ok(key_data);
                        }
                    }
                }
            }
            Err(e) => {
                warn!("[REACH-RS] Failed generating key with profile {}: {}", prof.vip_key, e);
            }
        }
    }

    Err("Semua VIP profile gagal meregenerasi API Key baru.".to_string())
}

fn normalize_url(raw: &str) -> Option<String> {
    LINK_RE.captures(raw).map(|cap| {
        format!("https://whatsapp.com/channel/{}/{}", &cap[1], &cap[2])
    })
}

fn parse_emojis(raw: &str) -> Option<String> {
    let matches: Vec<&str> = EMOJI_RE.find_iter(raw).map(|m| m.as_str()).take(5).collect();
    if matches.is_empty() {
        None
    } else {
        Some(matches.join(", "))
    }
}

pub async fn execute_reaction(client: reqwest::Client, target_url: String, emoji_str: String) {
    let mut key_data = load_key();
    if key_data.api_key.is_empty() {
        if let Ok(new_key) = generate_api_key(&client, 0).await {
            key_data = new_key;
        } else {
            error!("[REACH-RS] Background error: failed generating initial API key");
            return;
        }
    }

    let origin = if key_data.domain == "*" { "https://reactionwa.online" } else { &key_data.domain };
    let referer = if origin.ends_with('/') { origin.to_string() } else { format!("{}/", origin) };

    let payload = json!({
        "url": target_url,
        "reaction": emoji_str
    });

    match client.post(API_ENDPOINT)
                    .header("Content-Type", "application/json")
        .header("Origin", origin)
        .header("Referer", referer)
        .header("x-api-key", &key_data.api_key)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .json(&payload)
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(val) = res.json::<Value>().await {
                if val.get("success").and_then(Value::as_bool).unwrap_or(false) {
                    info!("[REACH-RS] Background reaction queued successfully: {}", target_url);
                } else if let Some(err) = val.get("error").and_then(Value::as_str) {
                    warn!("[REACH-RS] Upstream reaction error: {}", err);
                    let lower = err.to_lowercase();
                    if lower.contains("limit") || lower.contains("habis") || lower.contains("kuota") || lower.contains("sibuk") {
                        let curr_idx = VIP_PROFILES.iter().position(|p| p.vip_key == key_data.vip_key).unwrap_or(0);
                        let next_idx = (curr_idx + 1) % VIP_PROFILES.len();
                        let _ = generate_api_key(&client, next_idx).await;
                    }
                }
            }
        }
        Err(e) => {
            error!("[REACH-RS] Request error: {}", e);
        }
    }
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query_params): Query<ReachParams>,
    body: Option<Json<ReachParams>>,
) -> Response {
    let start_time = std::time::Instant::now();
    let body_params = body.map(|b| b.0).unwrap_or_default();

    let raw_link = body_params.link
        .or(body_params.url)
        .or(query_params.link)
        .or(query_params.url)
        .unwrap_or_default();

    let raw_emoji = body_params.emoji
        .or(body_params.emojis)
        .or(query_params.emoji)
        .or(query_params.emojis)
        .unwrap_or_default();

    if raw_link.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'link' wajib diisi dengan link WhatsApp Channel."
        })).into_response();
    }

    let normalized_url = match normalize_url(&raw_link) {
        Some(u) => u,
        None => {
            return Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": "Format URL WhatsApp Channel tidak valid. Contoh: https://whatsapp.com/channel/0029VbDyL6d9RZAh3JjEM325/158"
            })).into_response();
        }
    };

    let emoji_string = match parse_emojis(&raw_emoji) {
        Some(e) => e,
        None => {
            return Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": "Emoji tidak valid atau kosong. Masukkan minimal 1 emoji (contoh: \"👍\" atau \"❤️\")."
            })).into_response();
        }
    };

    let mut key_data = load_key();
    let current_usage = key_data.usage_today.unwrap_or(0);
    let limit_count = key_data.limit.unwrap_or(50);
    let next_usage = if current_usage >= limit_count { limit_count } else { current_usage + 1 };

    key_data.usage_today = Some(next_usage);
    key_data.last_used_at = Some(chrono::Utc::now().to_rfc3339());
    save_key(&key_data);

    // Spawn non-blocking background reaction in Tokio thread pool
    let client_clone = state.client.clone();
    let url_clone = normalized_url.clone();
    let emoji_clone = emoji_string.clone();
    tokio::spawn(async move {
        execute_reaction(client_clone, url_clone, emoji_clone).await;
    });

    let elapsed = start_time.elapsed().as_millis();

    Json(json!({
        "status": true,
        "time": format!("{}ms", elapsed),
        "message": "Reaction VIP API masuk antrean.",
        "result": {
            "target": normalized_url,
            "emojis": emoji_string,
            "vip_package": "VIP Permanent",
            "usage_today": next_usage,
            "limit": limit_count
        },
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })).into_response()
}

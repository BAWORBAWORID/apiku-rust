// Large json! literal needs a higher recursion limit
#![recursion_limit = "512"]


fn truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => !s.is_empty() && s != "0" && s != "false",
        serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        serde_json::Value::Null => false,
        _ => true,
    }
}
// Free Fire Stalker — native conversion of api/stalker/freefire.js
// Primary: freefire.my.id (PoW challenge: token + sha256 brute force + sig).
// Fallback: adenpedia.my.id. Merges both into a single profile result.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const FF_BASE_URL: &str = "https://freefire.my.id";
const ADEN_BASE_URL: &str = "https://adenpedia.my.id/update01";
const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

fn server_name(region: &str) -> String {
    match region {
        "ID" => "Indonesia",
        "IND" => "India",
        "BD" => "Bangladesh",
        "PK" => "Pakistan",
        "SG" => "Singapore",
        "TH" => "Thailand",
        "VN" => "Vietnam",
        "TW" => "Taiwan",
        "BR" => "Brazil",
        "NA" => "North America",
        "EU" => "Europe",
        "ME" => "Middle East",
        other => other,
    }
    .to_string()
}

const BR_RANKS: &[(i64, &str, i64)] = &[
    (5200, "Grandmaster I", 31), (5400, "Grandmaster II", 32), (5600, "Grandmaster III", 33),
    (5800, "Grandmaster IV", 34), (6000, "Grandmaster V", 35),
    (1000, "Bronze I", 1), (1100, "Bronze II", 2), (1200, "Bronze III", 3),
    (1310, "Silver I", 4), (1410, "Silver II", 5), (1600, "Silver III", 6),
    (1610, "Gold I", 7), (1735, "Gold II", 8), (1860, "Gold III", 9), (1985, "Gold IV", 10),
    (2110, "Platinum I", 11), (2235, "Platinum II", 12), (2360, "Platinum III", 13),
    (2485, "Platinum IV", 14), (2610, "Platinum V", 15),
    (2760, "Diamond I", 16), (2910, "Diamond II", 17), (3060, "Diamond III", 18),
    (3210, "Diamond IV", 19), (3350, "Diamond V", 20),
    (3510, "Heroic I", 21), (3670, "Heroic II", 22), (3830, "Heroic III", 23),
    (3990, "Heroic IV", 24), (4150, "Heroic V", 25),
    (4320, "Master I", 26), (4490, "Master II", 27), (4660, "Master III", 28),
    (4830, "Master IV", 29), (5000, "Master V", 30),
];

fn get_br_rank(points: i64) -> (String, i64) {
    // JS iterates descending keys; emulate: find the highest threshold <= points
    let mut best: Option<&(i64, &str, i64)> = None;
    for e in BR_RANKS {
        if points >= e.0 {
            match best {
                Some(b) if b.0 >= e.0 => {}
                _ => best = Some(e),
            }
        }
    }
    // threshold 1000 (Bronze I) is the floor; below that keep Bronze I
    match best {
        Some(e) => (e.1.to_string(), e.2),
        None => ("Bronze I".to_string(), 1),
    }
}

const CS_RANKS: &[(i64, &str, i64)] = &[
    (0, "None", 0), (100, "Bronze I", 1), (110, "Bronze II", 2), (120, "Bronze III", 3),
    (130, "Bronze IV", 4), (140, "Silver I", 5), (150, "Silver II", 6), (160, "Silver III", 7),
    (170, "Silver IV", 8), (180, "Gold I", 9), (190, "Gold II", 10), (200, "Gold III", 11),
    (210, "Gold IV", 12), (220, "Platinum I", 13), (230, "Platinum II", 14),
    (240, "Platinum III", 15), (250, "Platinum IV", 16), (260, "Diamond I", 17),
    (270, "Diamond II", 18), (280, "Diamond III", 19), (290, "Diamond IV", 20),
    (300, "Heroic", 21), (310, "Grandmaster", 22), (320, "Master", 23),
];

fn get_cs_rank(cs_rank: i64, cs_points: i64) -> (String, i64, i64) {
    let mut best = CS_RANKS[0];
    for e in CS_RANKS {
        if cs_rank >= e.0 {
            best = *e;
        }
    }
    let star = if best.2 >= 1 && best.2 <= 20 { ((cs_rank - 100) % 10) + 1 } else { 0 };
    (best.1.to_string(), best.2, star.max(0))
}

fn prime_level_diamonds(level: i64) -> Option<i64> {
    match level {
        1 => Some(100), 2 => Some(1000), 3 => Some(3000), 4 => Some(10000),
        5 => Some(30000), 6 => Some(60000), 7 => Some(120000), 8 => Some(200000),
        _ => None,
    }
}

const PRICE_PER_POINT: i64 = 128;
const PRICE_PER_DIAMOND: i64 = 126;
const BOOYAH_DIAMONDS_PER_LEVEL: i64 = 20;

fn rupiah(n: i64) -> String {
    // id-ID grouping with dots
    let neg = n < 0;
    let s = n.abs().to_string();
    let mut grouped = String::new();
    for (i, c) in s.chars().enumerate() {
        grouped.push(c);
        let rem = s.len() - i - 1;
        if rem > 0 && rem % 3 == 0 {
            grouped.push('.');
        }
    }
    format!("Rp{}{}", if neg { "-" } else { "" }, grouped)
}

fn calc_prime_price(prime_level: i64, prime_points: i64) -> Value {
    let mut price = json!({ "primeLevel": Value::Null, "primePoints": Value::Null, "booyahPass": Value::Null });
    if (1..=8).contains(&prime_level) {
        if let Some(diamonds) = prime_level_diamonds(prime_level) {
            let total = diamonds * PRICE_PER_DIAMOND;
            price["primeLevel"] = json!({
                "level": prime_level, "diamonds": diamonds,
                "ratePerDiamond": PRICE_PER_DIAMOND, "total": total,
                "totalFormatted": rupiah(total),
            });
        }
    }
    if prime_points > 0 {
        let total = prime_points * PRICE_PER_POINT;
        price["primePoints"] = json!({
            "points": prime_points, "ratePerPoint": PRICE_PER_POINT,
            "total": total, "totalFormatted": rupiah(total),
        });
    }
    let estimated_diamonds = if prime_points > 0 {
        (prime_points as f64 * (PRICE_PER_POINT as f64 / PRICE_PER_DIAMOND as f64)).floor() as i64
    } else if (1..=8).contains(&prime_level) {
        prime_level_diamonds(prime_level).unwrap_or(0)
    } else {
        0
    };
    if estimated_diamonds > 0 {
        let total = estimated_diamonds * PRICE_PER_DIAMOND;
        price["booyahPass"] = json!({
            "estimatedDiamonds": estimated_diamonds,
            "diamondsPerLevel": BOOYAH_DIAMONDS_PER_LEVEL,
            "estimatedLevels": estimated_diamonds / BOOYAH_DIAMONDS_PER_LEVEL,
            "ratePerDiamond": PRICE_PER_DIAMOND, "total": total,
            "totalFormatted": rupiah(total),
        });
    }
    price
}

fn solve_pow(challenge: &str, difficulty: usize) -> String {
    let prefix = "0".repeat(difficulty);
    let mut t = 0u64;
    loop {
        let pow = radix36(t);
        if sha256_hex(&format!("{}:{}", challenge, pow)).starts_with(&prefix) {
            return pow;
        }
        t += 1;
    }
}

fn radix36(mut n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(CHARS[(n % 36) as usize]);
        n /= 36;
    }
    out.iter().rev().map(|b| *b as char).collect()
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .user_agent(DEFAULT_UA)
        .build()
        .map_err(|e| e.to_string())
}

async fn get_auth_headers(api_path: &str, referer: &str) -> Result<Vec<(String, String)>, String> {
    let c = client(10)?;
    let res = c
        .get(format!("{}/api/token", FF_BASE_URL))
        .header("Referer", referer)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Gagal mengambil challenge token: HTTP {}", res.status()));
    }
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    let token = j
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or("token tidak ada di response challenge")?
        .to_string();
    let challenge = j
        .get("challenge")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let difficulty = j.get("difficulty").and_then(|d| d.as_u64()).unwrap_or(1) as usize;
    let pow = solve_pow(&challenge, difficulty);
    let sig = sha256_hex(&format!("{}|{}|{}", token, api_path, pow));
    Ok(vec![
        ("x-fp-token".into(), token),
        ("x-fp-pow".into(), pow),
        ("x-fp-sig".into(), sig),
        ("Referer".into(), referer.to_string()),
    ])
}

fn get_permanent_icon(id: &Value) -> Option<String> {
    let id = id.as_str().map(|s| s.to_string()).or_else(|| id.as_i64().map(|i| i.to_string()))?;
    if id.is_empty() {
        return None;
    }
    Some(format!(
        "https://cdn.jsdelivr.net/gh/ShahGCreator/icon@main/PNG/{}.png",
        id
    ))
}

fn fmt_full_date(ts: &Value) -> Value {
    let s_owned = ts.as_str().map(|s| s.to_string()).or_else(|| ts.as_i64().map(|i| i.to_string())).unwrap_or_default();
    let s = s_owned.as_str();
    if s.is_empty() || s == "0" {
        return Value::Null;
    }
    let Some(num): Option<i64> = s.parse().ok() else { return Value::Null };
    let secs = if num > 100_000_000_000 { num / 1000 } else { num };
    // id-ID long month format
    let (y, mo, d) = epoch_to_ymd(secs as u64);
    let months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    if (1..=12).contains(&mo) {
        json!(format!("{:02} {} {}", d, months[mo as usize - 1], y))
    } else {
        Value::Null
    }
}

fn epoch_to_ymd(secs: u64) -> (i64, i64, i64) {
    let days = secs / 86400;
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d)
}

fn fmt_iso_date(ts: &Value) -> Value {
    let s_owned = ts.as_str().map(|s| s.to_string()).or_else(|| ts.as_i64().map(|i| i.to_string())).unwrap_or_default();
    let s = s_owned.as_str();
    if s.is_empty() || s == "0" {
        return Value::Null;
    }
    let Some(num): Option<i64> = s.parse().ok() else { return Value::Null };
    let secs = if num > 100_000_000_000 { num / 1000 } else { num } as u64;
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, sec) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = epoch_to_ymd(days);
    json!(format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC", y, mo, d, h, m, sec))
}

fn fmt_last_login(ts: &Value) -> Value {
    let s_owned = ts.as_str().map(|s| s.to_string()).or_else(|| ts.as_i64().map(|i| i.to_string())).unwrap_or_default();
    let s = s_owned.as_str();
    if s.is_empty() || s == "0" {
        return Value::Null;
    }
    let Some(num): Option<i64> = s.parse().ok() else { return Value::Null };
    let secs = if num > 100_000_000_000 { num / 1000 } else { num } as u64;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let diff = now - secs as i64;
    if diff < 0 {
        return Value::Null;
    }
    if diff < 60 {
        return json!(format!("{} detik lalu", diff));
    }
    if diff < 3600 {
        return json!(format!("{} menit lalu", diff / 60));
    }
    if diff < 86400 {
        return json!(format!("{} jam lalu", diff / 3600));
    }
    if diff < 2_592_000 {
        return json!(format!("{} hari lalu", diff / 86400));
    }
    let (y, mo, d) = epoch_to_ymd(secs);
    let hh = (secs % 86400) / 3600;
    let mm = (secs % 3600) / 60;
    let months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    if (1..=12).contains(&mo) {
        json!(format!("{:02} {} {} {:02}.{:02}", d, months[mo as usize - 1], y, hh, mm))
    } else {
        Value::Null
    }
}

fn format_battle_tag(tag: &str) -> String {
    let re = regex::Regex::new(r"(?i)^PlayerBattleTagID_").unwrap();
    let s = re.replace_all(tag, "").replace('_', " ").to_lowercase();
    s.split(' ')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_battle_tags(tags: Option<&Value>, counts: Option<&Value>) -> Vec<Value> {
    let Some(arr) = tags.and_then(|t| t.as_array()) else { return vec![] };
    let cnts = counts.and_then(|c| c.as_array());
    arr.iter()
        .enumerate()
        .map(|(idx, t)| {
            let raw = t.as_str().unwrap_or("");
            let count = cnts
                .and_then(|c| c.get(idx))
                .cloned()
                .unwrap_or(json!(1));
            json!({ "tag": format_battle_tag(raw), "rawTag": t.clone(), "count": count })
        })
        .collect()
}

fn format_language(lang: &Value) -> Value {
    let Some(s) = lang.as_str() else { return Value::Null };
    if s.is_empty() {
        return Value::Null;
    }
    let re = regex::Regex::new(r"(?i)^Language_").unwrap();
    let lower = re.replace_all(s, "").to_lowercase();
    let mut c = lower.chars();
    match c.next() {
        Some(f) => json!(f.to_uppercase().collect::<String>() + c.as_str()),
        None => Value::Null,
    }
}

fn format_rank_show(show: &Value) -> Value {
    let Some(s) = show.as_str() else { return Value::Null };
    let re = regex::Regex::new(r"(?i)^RankShow_").unwrap();
    json!(re.replace_all(s, "").to_string())
}

async fn fetch_primary_ff(uid: &str) -> Result<Result<Value, String>, String> {
    // Ok(Ok(json)) = found; Ok(Err(msg)) = not found; Err = network failure
    let api_path = "/api/ff";
    let referer = format!("{}/stalk/{}", FF_BASE_URL, uid);
    let headers = get_auth_headers(api_path, &referer).await?;
    let c = client(15)?;
    let mut req = c.get(format!("{}{}?uid={}", FF_BASE_URL, api_path, uid));
    for (k, v) in headers {
        req = req.header(&k, &v);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let json: Value = res.json().await.unwrap_or(Value::Null);
    let has_error = json.get("error").is_some();
    let has_player = json.get("player").map(|p| !p.is_null()).unwrap_or(false);
    if status == 404 || (has_error && !has_player) {
        return Ok(Err(json
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("Player tidak ditemukan.")
            .to_string()));
    }
    if !(200..300).contains(&status) || !has_player {
        return Err(json
            .get("error")
            .and_then(|e| e.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Primary HTTP {}", status)));
    }
    Ok(Ok(json))
}

async fn fetch_fallback_ff(uid: &str) -> Result<Result<Value, String>, String> {
    let c = client(15)?;
    let res = c
        .get(format!("{}/info.php?uid={}", ADEN_BASE_URL, uid))
        .header("Referer", format!("{}/", ADEN_BASE_URL))
                    .header("Origin", "https://adenpedia.my.id")
                    .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Fallback HTTP {}", res.status()));
    }
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    let err = json.get("error").and_then(|e| e.as_str());
    let has_nick = json
        .pointer("/basicInfo/nickname")
        .map(|n| !n.is_null())
        .unwrap_or(false);
    if let Some(e) = err {
        if !has_nick {
            return Ok(Err(e.to_string()));
        }
    }
    if !has_nick {
        return Ok(Err("Player tidak ditemukan / UID tidak valid".to_string()));
    }
    Ok(Ok(json))
}

fn gs<'a>(v: &'a Value, path: &str) -> &'a Value {
    v.pointer(path).unwrap_or(&Value::Null)
}

fn gs_str(v: &Value, a: &str, b: &str) -> Option<String> {
    gs(v, a)
        .as_str()
        .or_else(|| gs(v, b).as_str())
        .map(|s| s.to_string())
}
fn gs_i(v: &Value, a: &str, b: &str) -> i64 {
    gs(v, a).as_i64().or_else(|| gs(v, b).as_i64()).unwrap_or(0)
}
fn gs_val<'a>(v: &'a Value, a: &str, b: &'a Value) -> Value {
    if let Some(x) = v.pointer(a) {
        if !x.is_null() {
            return x.clone();
        }
    }
    if let Value::Object(_) = b {
        if let Some(x) = b.pointer(a) {
            if !x.is_null() {
                return x.clone();
            }
        }
    }
    Value::Null
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let uid = query
        .get("uid")
        .cloned()
        .or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get("uid").map(|u| u.to_string().trim_matches('"').to_string()))
        })
        .map(|u| u.trim().to_string());
    let clean_uid = match uid {
        Some(u) if regex::Regex::new(r"^\d{8,11}$").unwrap().is_match(&u) => u,
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "error": "UID tidak valid (harus 8-11 digit angka)",
                "example": "1531107934",
            })))
            .into_response()
        }
    };

    let (primary_res, fallback_res) =
        tokio::join!(fetch_primary_ff(&clean_uid), fetch_fallback_ff(&clean_uid));

    let primary = primary_res.ok();
    let fallback = fallback_res.ok();
    let p_err = matches!(primary, Some(Err(_)));
    let f_err = matches!(fallback, Some(Err(_)));
    let p_data = primary.clone().and_then(|r| r.ok());
    let f_data = fallback.clone().and_then(|r| r.ok());

    if p_err && f_err {
        let msg = match (&primary, &fallback) {
            (Some(Err(m)), _) if !m.is_empty() => m.clone(),
            (_, Some(Err(m))) if !m.is_empty() => m.clone(),
            _ => "Player tidak ditemukan.".to_string(),
        };
        return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "error": msg })))
            .into_response();
    }
    if (p_err && f_data.is_none()) || (f_err && p_data.is_none()) {
        let msg = match (&primary, &fallback) {
            (Some(Err(m)), _) => m.clone(),
            (_, Some(Err(m))) => m.clone(),
            _ => "Player tidak ditemukan.".to_string(),
        };
        return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "error": msg })))
            .into_response();
    }
    if p_data.is_none() && f_data.is_none() {
        let detail = match (&primary, &fallback) {
            (Some(Err(m)), _) | (_, Some(Err(m))) => m.clone(),
            (Some(Ok(_)), _) => "Gagal mengambil data fallback".to_string(),
            _ => "Gagal mengambil data dari server Free Fire".to_string(),
        };
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "error": "Gagal mengambil data dari sumber Free Fire",
                "detail": detail,
            })),
        )
            .into_response();
    }

    let empty = json!({});
    let primary_data = p_data.as_ref();
    let aden = f_data.as_ref();

    let player = primary_data.map(|d| gs(d, "/player")).unwrap_or(&empty).clone();
    let guild_data = primary_data.map(|d| gs(d, "/guild")).unwrap_or(&empty).clone();
    let pet_data = primary_data.map(|d| gs(d, "/pet")).unwrap_or(&empty).clone();
    let social_data = primary_data.map(|d| gs(d, "/social")).unwrap_or(&empty).clone();
    let ban_data = primary_data.map(|d| gs(d, "/ban")).unwrap_or(&empty).clone();
    let credit_data = primary_data.map(|d| gs(d, "/credit")).unwrap_or(&empty).clone();

    let basic = aden.map(|d| gs(d, "/basicInfo")).unwrap_or(&empty).clone();
    let clan = aden.map(|d| gs(d, "/clanBasicInfo")).unwrap_or(&empty).clone();
    let social = aden.map(|d| gs(d, "/socialInfo")).unwrap_or(&empty).clone();
    let aden_pet = aden.map(|d| gs(d, "/petInfo")).unwrap_or(&empty).clone();

    let region = player
        .get("region")
        .and_then(|r| r.as_str())
        .or_else(|| basic.get("region").and_then(|r| r.as_str()))
        .unwrap_or("ID")
        .to_string();
    let srv = server_name(&region);
    let ranking_points = player
        .get("rankingPoints")
        .and_then(|r| r.as_i64())
        .or_else(|| basic.get("rankingPoints").and_then(|r| r.as_i64()))
        .unwrap_or(0);
    let (br_name, br_id) = get_br_rank(ranking_points);
    let cs_rank = player
        .get("csRank")
        .and_then(|r| r.as_i64())
        .or_else(|| basic.get("csRank").and_then(|r| r.as_i64()))
        .unwrap_or(0);
    let cs_points = basic.get("csRankingPoints").and_then(|r| r.as_i64()).unwrap_or(0);
    let (cs_name, cs_id, _star) = get_cs_rank(cs_rank, cs_points);

    let prime_level = gs(&player, "/primeInfo/primeLevel")
        .as_i64()
        .or_else(|| gs(&basic, "/primeInfo/primeLevel").as_i64())
        .unwrap_or(0);
    let prime_points = gs(&basic, "/primeInfo/primePoints").as_i64().unwrap_or(0);
    let prime_price = calc_prime_price(prime_level, prime_points);

    let max_rank = basic
        .get("maxRank")
        .or_else(|| player.get("rank"))
        .cloned()
        .unwrap_or(Value::Null);
    let max_rank_i = max_rank.as_i64();
    let max_rank_name = max_rank_i.map(|v| get_br_rank(v).0);
    let cs_max_rank = basic
        .get("csMaxRank")
        .or_else(|| player.get("csRank"))
        .cloned()
        .unwrap_or(Value::Null);
    let cs_max_rank_name = cs_max_rank.as_i64().map(|v| get_cs_rank(v, 0).0);

    let head_pic = player
        .get("headPic")
        .or_else(|| basic.get("headPic"))
        .cloned()
        .unwrap_or(Value::Null);
    let banner_id = player
        .pointer("/equippedBanner/id")
        .or_else(|| basic.get("bannerId"))
        .cloned()
        .unwrap_or(Value::Null);
    let char_id = player
        .pointer("/equippedCharacter/id")
        .or_else(|| aden.and_then(|d| d.pointer("/profileInfo/avatarId")))
        .cloned()
        .unwrap_or(Value::Null);
    let pet_id = pet_data
        .get("id")
        .or_else(|| aden_pet.get("id"))
        .cloned()
        .unwrap_or(Value::Null);
    let pet_skin_id = pet_data
        .get("skinId")
        .or_else(|| aden_pet.get("skinId"))
        .cloned()
        .unwrap_or(Value::Null);

    let avatar = player
        .get("avatarUrl")
        .cloned()
        .filter(|v| !v.is_null())
        .or_else(|| get_permanent_icon(&head_pic).map(|u| json!(u)))
        .unwrap_or(Value::Null);
    let banner = player
        .pointer("/equippedBanner/icon")
        .cloned()
        .filter(|v| !v.is_null())
        .or_else(|| get_permanent_icon(&banner_id).map(|u| json!(u)))
        .unwrap_or(Value::Null);

    let equipped_avatar = player
        .get("equippedAvatar")
        .cloned()
        .filter(|v| !v.is_null())
        .unwrap_or_else(|| {
            if head_pic.is_null() {
                Value::Null
            } else {
                json!({
                    "id": head_pic,
                    "name": Value::Null,
                    "icon": get_permanent_icon(&head_pic),
                    "type": "Avatars",
                    "description": Value::Null,
                })
            }
        });
    let equipped_banner = player
        .get("equippedBanner")
        .cloned()
        .filter(|v| !v.is_null())
        .unwrap_or_else(|| {
            if banner_id.is_null() {
                Value::Null
            } else {
                json!({
                    "id": banner_id,
                    "name": Value::Null,
                    "icon": get_permanent_icon(&banner_id),
                    "type": "Banners",
                    "description": Value::Null,
                })
            }
        });
    let equipped_character = player
        .get("equippedCharacter")
        .cloned()
        .filter(|v| !v.is_null())
        .unwrap_or_else(|| {
            if char_id.is_null() {
                Value::Null
            } else {
                let name = char_id
                    .as_i64()
                    .and_then(character_name);
                json!({
                    "id": char_id,
                    "name": name,
                    "icon": get_permanent_icon(&char_id),
                    "type": "Characters",
                    "description": Value::Null,
                })
            }
        });

    let has_guild = guild_data.get("guildName").map(|v| !v.is_null()).unwrap_or(false)
        || guild_data.get("guildId").map(|v| !v.is_null()).unwrap_or(false)
        || clan.get("clanName").map(|v| !v.is_null()).unwrap_or(false)
        || clan.get("clanId").map(|v| !v.is_null()).unwrap_or(false);
    let guild = if has_guild {
        json!({
            "name": guild_data.get("guildName").or_else(|| clan.get("clanName")).cloned().unwrap_or(Value::Null),
            "id": guild_data.get("guildId").or_else(|| clan.get("clanId")).cloned().unwrap_or(Value::Null),
            "level": guild_data.get("guildLevel").or_else(|| clan.get("clanLevel")).and_then(|v| v.as_i64()).unwrap_or(0),
            "memberNum": guild_data.get("memberNum").or_else(|| clan.get("memberNum")).and_then(|v| v.as_i64()).unwrap_or(0),
            "capacity": guild_data.get("capacity").or_else(|| clan.get("capacity")).and_then(|v| v.as_i64()).unwrap_or(0),
            "leader": clan.get("leaderName").cloned().unwrap_or(Value::Null),
        })
    } else {
        Value::Null
    };

    let has_pet = pet_data.get("name").map(|v| !v.is_null()).unwrap_or(false)
        || pet_data.get("id").map(|v| !v.is_null()).unwrap_or(false)
        || pet_data.get("speciesName").map(|v| !v.is_null()).unwrap_or(false)
        || aden_pet.get("name").map(|v| !v.is_null()).unwrap_or(false)
        || aden_pet.get("id").map(|v| !v.is_null()).unwrap_or(false);
    let pet = if has_pet {
        json!({
            "id": pet_id,
            "name": pet_data.get("name").cloned().filter(|v| !v.is_null()).or_else(|| aden_pet.get("name").cloned()).unwrap_or(Value::Null),
            "speciesName": pet_data.get("speciesName").cloned().filter(|v| !v.is_null())
                .or_else(|| pet_id.as_i64().and_then(pet_name).map(|n| json!(n))),
            "level": pet_data.get("level").or_else(|| aden_pet.get("level")).and_then(|v| v.as_i64()).unwrap_or(0),
            "exp": pet_data.get("exp").or_else(|| aden_pet.get("exp")).and_then(|v| v.as_i64()).unwrap_or(0),
            "isSelected": pet_data.get("isSelected").or_else(|| aden_pet.get("isSelected")).map(truthy).unwrap_or(false),
            "skinId": pet_skin_id,
            "skinName": pet_data.get("skinName").cloned().unwrap_or(Value::Null),
            "skinIconUrl": pet_data.get("skinIconUrl").cloned().filter(|v| !v.is_null())
                .or_else(|| get_permanent_icon(&pet_skin_id).map(|u| json!(u))),
            "selectedSkillId": pet_data.get("selectedSkillId").or_else(|| aden_pet.get("selectedSkillId")).cloned().unwrap_or(Value::Null),
            "skillName": pet_data.get("skillName").cloned().unwrap_or(Value::Null),
        })
    } else {
        Value::Null
    };

    let signature = social_data
        .get("signature")
        .or_else(|| social.get("signature"))
        .cloned()
        .unwrap_or(Value::Null);
    let language = format_language(social.get("language").unwrap_or(&Value::Null));
    let rank_show = format_rank_show(social.get("rankShow").unwrap_or(&Value::Null));
    let battle_tags = format_battle_tags(
        social.get("battleTag"),
        social.get("battleTagCount"),
    );

    let social_result: Value = if !signature.is_null()
        || !language.is_null()
        || !rank_show.is_null()
        || !battle_tags.is_empty()
    {
        json!({
            "signature": signature,
            "language": language,
            "rankShow": rank_show,
            "battleTags": battle_tags,
        })
    } else {
        Value::Null
    };

    let create_at_ts = player
        .get("createAt")
        .or_else(|| basic.get("createAt"))
        .cloned()
        .unwrap_or(Value::Null);
    let last_login_ts = player
        .get("lastLoginAt")
        .or_else(|| basic.get("lastLoginAt"))
        .cloned()
        .unwrap_or(Value::Null);

    let credit_score = credit_data
        .get("creditScore")
        .and_then(|c| c.as_i64())
        .or_else(|| {
            aden
                .and_then(|d| d.pointer("/creditScoreInfo/creditScore"))
                .and_then(|c| c.as_i64())
        })
        .or_else(|| basic.get("creditScore").and_then(|c| c.as_i64()))
        .unwrap_or(100);

    let is_banned = ban_data.get("isBanned").map(truthy).unwrap_or(false);
    let ban = json!({
        "isBanned": is_banned,
        "status": ban_data.get("status").cloned().unwrap_or(json!(if is_banned { "BANNED" } else { "NOT BANNED" })),
        "banPeriod": ban_data.get("banPeriod").cloned().unwrap_or(json!(0)),
        "lastLoginAt": ban_data.get("lastLoginAt").cloned().unwrap_or(Value::Null),
    });

    let diamond_cost = aden
        .and_then(|d| d.pointer("/diamondCostRes/diamondCost"))
        .cloned()
        .unwrap_or(Value::Null);

    let mut result_map = serde_json::Map::new();
    result_map.insert("uid".into(), json!(clean_uid));
    result_map.insert("nickname".into(), player.get("nickname").or_else(|| basic.get("nickname")).cloned().unwrap_or(Value::Null));
    result_map.insert("region".into(), json!(region));
    result_map.insert("server".into(), json!(srv));
    result_map.insert("level".into(), json!(player.get("level").or_else(|| basic.get("level")).and_then(|v| v.as_i64()).unwrap_or(0)));
    result_map.insert("exp".into(), json!(player.get("exp").or_else(|| basic.get("exp")).and_then(|v| v.as_i64()).unwrap_or(0)));
    result_map.insert("likes".into(), json!(player.get("liked").or_else(|| basic.get("liked")).and_then(|v| v.as_i64()).unwrap_or(0)));
    result_map.insert("diamondCost".into(), diamond_cost);
    result_map.insert("accountType".into(), basic.get("accountType").cloned().unwrap_or(Value::Null));
    result_map.insert("seasonId".into(), basic.get("seasonId").cloned().unwrap_or(Value::Null));
    result_map.insert("badgeId".into(), basic.get("badgeId").cloned().unwrap_or(Value::Null));
    result_map.insert("rank".into(), json!(player.get("rank").or_else(|| basic.get("rank")).and_then(|v| v.as_i64()).unwrap_or(0)));
    result_map.insert("rankName".into(), json!(br_name));
    result_map.insert("rankId".into(), json!(br_id));
    result_map.insert("rankingPoints".into(), json!(ranking_points));
    result_map.insert("maxRank".into(), max_rank);
    result_map.insert("maxRankName".into(), json!(max_rank_name));
    result_map.insert("csRank".into(), json!(cs_rank));
    result_map.insert("csRankName".into(), json!(cs_name));
    result_map.insert("csRankId".into(), json!(cs_id));
    result_map.insert("csMaxRank".into(), cs_max_rank);
    result_map.insert("csMaxRankName".into(), json!(cs_max_rank_name));
    result_map.insert("hasElitePass".into(), json!(player.get("hasElitePass").or_else(|| basic.get("hasElitePass")).map(truthy).unwrap_or(false)));
    result_map.insert("createdAt".into(), fmt_full_date(&create_at_ts));
    result_map.insert("createdAtFormatted".into(), fmt_iso_date(&create_at_ts));
    result_map.insert("lastLoginAt".into(), fmt_last_login(&last_login_ts));
    result_map.insert("lastLoginAtFormatted".into(), fmt_iso_date(&last_login_ts));
    result_map.insert("avatar".into(), avatar);
    result_map.insert("banner".into(), banner);
    result_map.insert("equippedAvatar".into(), equipped_avatar);
    result_map.insert("equippedBanner".into(), equipped_banner);
    result_map.insert("equippedCharacter".into(), equipped_character);
    result_map.insert("equippedTitle".into(), player.get("equippedTitle").cloned().unwrap_or(Value::Null));
    result_map.insert("equippedPin".into(), player.get("equippedPin").cloned().unwrap_or(Value::Null));
    result_map.insert("equippedOutfitItems".into(), player.get("equippedOutfitItems").cloned().unwrap_or(json!([])));
    result_map.insert("equippedWeaponOutfitItems".into(), player.get("equippedWeaponOutfitItems").cloned().unwrap_or(json!([])));
    result_map.insert("equippedLookChangerItems".into(), player.get("equippedLookChangerItems").cloned().unwrap_or(json!([])));
    result_map.insert("equippedArrivalAnimationItems".into(), player.get("equippedArrivalAnimationItems").cloned().unwrap_or(json!([])));
    result_map.insert("guild".into(), guild);
    result_map.insert("pet".into(), pet);
    result_map.insert("social".into(), social_result);
    result_map.insert("creditScore".into(), json!(credit_score));
    result_map.insert("ban".into(), ban);
    let result = Value::Object(result_map);

    Json(json!({
        "status": true,
        "result": result,
        "timestamp": epoch_secs_to_iso_now(),
    })).into_response()

}

fn epoch_secs_to_iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = epoch_to_ymd(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}

fn character_name(id: i64) -> Option<&'static str> {
    Some(match id {
        102000001 => "Primis", 102000002 => "Nulla", 102000003 => "Ford",
        102000004 => "Andrew", 102000005 => "Kelly", 102000006 => "Olivia",
        102000007 => "Maxim", 102000008 => "Misha", 102000009 => "Nikita",
        102000010 => "Kla", 102000011 => "Paloma", 102000012 => "Miguel",
        102000013 => "Caroline", 102000014 => "Antonio", 102000015 => "Wukong",
        102000016 => "Hayato", 102000017 => "Moco", 102000018 => "Laura",
        102000019 => "Rafael", 102000020 => "A124", 102000021 => "Shani",
        102000022 => "Joseph", 102000023 => "Notora", 102000024 => "Alvaro",
        102000025 => "Steffie", 102000026 => "Jota", 102000027 => "Kapella",
        102000028 => "Wolfrahh", 102000029 => "Luqueta", 102000030 => "Jai",
        102000031 => "K", 102000032 => "Dasha", 102000033 => "Chrono",
        102000034 => "Shirou", 102000035 => "Skyler", 102000036 => "Xayne",
        102000037 => "D-Bee", 102000038 => "Dimitri", 102000039 => "Thiva",
        102000040 => "Leon", 102000041 => "Otho", 102000042 => "Nairi",
        102000043 => "Kenta", 102000044 => "Homer", 102000045 => "Iris",
        102000046 => "J.Biebs", 102000047 => "Tatsuya", 102000048 => "Luna",
        102000049 => "Santino", 102000050 => "Orion", 102000051 => "Alok (Awakened)",
        102000052 => "Sonia", 102000053 => "Suzy", 102000054 => "Ignis",
        102000055 => "Ryden", 102000056 => "Kairos", 102000057 => "Kassie",
        102000058 => "Lila", 102000000 => "Alok",
        _ => return None,
    })
}

fn pet_name(id: i64) -> Option<&'static str> {
    Some(match id {
        1300000001 => "Poring", 1300000002 => "Kitty", 1300000003 => "Mechanical Puppy",
        1300000004 => "Shiba", 1300000005 => "Night Panther", 1300000006 => "Spirit Fox",
        1300000007 => "Robo", 1300000008 => "Ottero", 1300000009 => "Detective Panda",
        1300000091 => "Falco", 1300000092 => "Mr. Waggor", 1300000093 => "Rockie",
        1300000094 => "Beaston", 1300000095 => "Dreki", 1300000096 => "Moony",
        1300000097 => "Sensei Tig", 1300000098 => "Agent Hop", 1300000099 => "Yeti",
        1300000100 => "Flash", 1300000101 => "Zasil", 1300000102 => "Finn",
        1300000103 => "Hoot", 1300000104 => "Fang", 1300000105 => "Arvon",
        1300000106 => "Kactus", 1300000107 => "Pug",
        _ => return None,
    })
}

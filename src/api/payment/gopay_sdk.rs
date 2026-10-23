// GoPay SDK — native conversion of api/payment/assets/gopay/{sdk,tokenManager,qrisRegistry,helpers}.js
// Shared by the gopay_* handlers via #[path] module inclusion.
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const BASE_URL: &str = "https://api.gobiz.co.id";
pub const OAUTH_URL: &str = "https://accounts.go-jek.com";
pub const CLIENT_ID: &str = "go-biz-web-new";
pub const APP_ID: &str = "go-biz-web-dashboard";
pub const APP_VERSION: &str = "platform-v3.101.0-8918927d";

const UA_LIST: [&str; 2] = [
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
];

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .build()
        .expect("reqwest client")
}

fn rand_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:x}", rng.gen_range(0..16))).collect()
}

pub fn uuid_v4() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let b: [u8; 16] = rng.gen();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-8{:01x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] & 0x0f, b[7],
        b[8] & 0x0f, b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

pub fn pick_ua() -> &'static str {
    use rand::Rng;
    let i = rand::thread_rng().gen_range(0..UA_LIST.len());
    &UA_LIST[i]
}

pub fn headers(token: Option<&str>) -> HeaderMap {
    let mut h = HeaderMap::new();
    let mut unique = UNIQUE_ID.get_or_init(|| Mutex::new(None)).lock().unwrap();
    let uid = unique.get_or_insert_with(uuid_v4).clone();
    drop(unique);
    let ins = |h: &mut HeaderMap, k: &str, v: &str| {
        if let (Ok(k), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            h.insert(k, v);
        }
    };
    ins(&mut h, "Accept", "application/json, text/plain, */*");
    ins(&mut h, "Authentication-Type", "go-id");
    ins(&mut h, "X-PhoneMake", "Android 10");
    ins(&mut h, "X-PhoneModel", "K");
    ins(&mut h, "x-DeviceOS", "Web");
    ins(&mut h, "X-Platform", "Web");
    ins(&mut h, "X-User-Type", "merchant");
    ins(&mut h, "x-appId", APP_ID);
    ins(&mut h, "x-uniqueid", &uid);
    ins(&mut h, "X-AppVersion", APP_VERSION);
    ins(&mut h, "Gojek-Country-Code", "ID");
    ins(&mut h, "Gojek-Timezone", "Asia/Jakarta");
    ins(&mut h, "Content-Type", "application/json");
    ins(&mut h, "User-Agent", pick_ua());
    if let Some(t) = token {
        ins(&mut h, "Authorization", &format!("Bearer {}", t));
    }
    h
}

static UNIQUE_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static PARTNER_TOKEN: OnceLock<Mutex<Option<(String, u64)>>> = OnceLock::new();

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn iso_days_ago(days: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::days(days))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

// ── Upstream error helper (mirrors extractError/fail) ────────────────────────
#[derive(Debug, Clone)]
pub struct UpstreamErr {
    pub status: u16,
    pub message: String,
    pub is_auth: bool,
}

pub fn extract_message(body: &Value, fallback: &str) -> String {
    let first = body.get("errors").and_then(|e| e.get(0));
    let msg = first
        .and_then(|f| f.get("message").and_then(|m| m.as_str()))
        .or_else(|| first.and_then(|f| f.get("message_title").and_then(|m| m.as_str())))
        .or_else(|| body.get("message").and_then(|m| m.as_str()));
    msg.unwrap_or(fallback).to_string()
}

/// POST JSON and parse response; on HTTP error capture upstream message.
pub async fn post_json(url: &str, hdrs: HeaderMap, body: Value) -> Result<Value, UpstreamErr> {
    let res = client().post(url).headers(hdrs).json(&body).send().await;
    match res {
        Err(e) => Err(UpstreamErr { status: 500, message: e.to_string(), is_auth: false }),
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            let val: Value = serde_json::from_str(&text).unwrap_or(json!({}));
            if status >= 400 {
                Err(UpstreamErr {
                    status,
                    message: extract_message(&val, "Permintaan gagal"),
                    is_auth: status == 401 || status == 403,
                })
            } else {
                Ok(val)
            }
        }
    }
}

pub async fn get_json(url: &str, hdrs: HeaderMap) -> Result<Value, UpstreamErr> {
    let res = client().get(url).headers(hdrs).send().await;
    match res {
        Err(e) => Err(UpstreamErr { status: 500, message: e.to_string(), is_auth: false }),
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            let val: Value = serde_json::from_str(&text).unwrap_or(json!({}));
            if status >= 400 {
                Err(UpstreamErr {
                    status,
                    message: extract_message(&val, "Permintaan gagal"),
                    is_auth: status == 401 || status == 403,
                })
            } else {
                Ok(val)
            }
        }
    }
}

// ── SDK calls ────────────────────────────────────────────────────────────────
pub async fn request_otp(phone: &str) -> Result<Value, UpstreamErr> {
    post_json(
        &format!("{}/goid/login/request", BASE_URL),
        headers(None),
        json!({ "client_id": CLIENT_ID, "phone_number": phone, "country_code": "62" }),
    )
    .await
}

pub async fn verify_otp(otp: &str, otp_token: &str) -> Result<Value, UpstreamErr> {
    post_json(
        &format!("{}/goid/token", BASE_URL),
        headers(None),
        json!({ "client_id": CLIENT_ID, "data": { "otp": otp, "otp_token": otp_token }, "grant_type": "otp" }),
    )
    .await
}

pub async fn refresh_token(refresh_token: &str) -> Result<Value, UpstreamErr> {
    post_json(
        &format!("{}/goid/token", BASE_URL),
        headers(None),
        json!({ "client_id": CLIENT_ID, "data": { "refresh_token": refresh_token }, "grant_type": "refresh_token" }),
    )
    .await
}

pub fn pick_tokens(result: &Value) -> (Option<String>, Option<String>) {
    let src = result.get("data").unwrap_or(result);
    (
        src.get("access_token").and_then(|v| v.as_str()).map(|s| s.to_string()),
        src.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.to_string()),
    )
}

pub async fn get_me(access_token: &str) -> Result<Value, UpstreamErr> {
    get_json(&format!("{}/v1/users/me", BASE_URL), headers(Some(access_token))).await
}

pub async fn get_merchant(access_token: &str, merchant_id: &str) -> Result<Value, UpstreamErr> {
    get_json(
        &format!("{}/v1/merchants/{}", BASE_URL, merchant_id),
        headers(Some(access_token)),
    )
    .await
}

pub async fn get_payouts(access_token: &str, page: i64, per: i64) -> Result<Value, UpstreamErr> {
    get_json(
        &format!("{}/v1/merchants/payouts?page={}&per={}", BASE_URL, page, per),
        headers(Some(access_token)),
    )
    .await
}

pub async fn get_journals(
    access_token: &str,
    merchant_id: &str,
    start_time: Option<&str>,
    days: i64,
) -> Result<Value, UpstreamErr> {
    let date_to = now_iso();
    let date_from = start_time.map(|s| s.to_string()).unwrap_or_else(|| iso_days_ago(days));
    let mut hdrs = headers(Some(access_token));
    if let (Ok(k), Ok(v)) = (
        reqwest::header::HeaderName::from_bytes(b"accept"),
        HeaderValue::from_str("application/vnd.journal.v1+json"),
    ) {
        hdrs.insert(k, v);
    }
    post_json(
        &format!("{}/journals/search", BASE_URL),
        hdrs,
        json!({
            "from": 0,
            "size": 50,
            "sort": { "time": { "order": "desc" } },
            "included_categories": { "incoming": ["transaction_share", "action"] },
            "query": [{
                "clauses": [
                    { "field": "metadata.transaction.status", "op": "in", "value": ["settlement", "capture"] },
                    { "field": "metadata.transaction.transaction_time", "op": "gte", "value": date_from },
                    { "field": "metadata.transaction.transaction_time", "op": "lte", "value": date_to },
                    { "field": "metadata.transaction.merchant_id", "op": "equal", "value": merchant_id }
                ],
                "op": "and"
            }]
        }),
    )
    .await
}

pub fn map_qris_entries(journal_result: &Value) -> Vec<Value> {
    let hits = journal_result.get("hits").and_then(|h| h.as_array()).cloned().unwrap_or_default();
    hits.iter()
        .filter(|item| {
            item.pointer("/metadata/transaction/payment_type").and_then(|v| v.as_str()) == Some("qris")
        })
        .map(|item| {
            let aspi = item.pointer("/metadata/provider_metadata/aspi");
            json!({
                "id": item.get("id"),
                "reference_id": item.get("reference_id"),
                "status": item.get("status"),
                "time": item.get("time"),
                "amount": aspi.and_then(|a| a.pointer("/data/amount")).cloned().unwrap_or(json!(0)),
                "issuer": aspi.and_then(|a| a.get("issuer")).cloned().unwrap_or(Value::Null),
                "acquirer": aspi.and_then(|a| a.get("acquirer")).cloned().unwrap_or(Value::Null),
                "merchant_name": aspi.and_then(|a| a.pointer("/data/merchant_name")).cloned().unwrap_or(Value::Null),
                "merchant_id": aspi.and_then(|a| a.pointer("/data/merchant_id")).cloned().unwrap_or(Value::Null),
                "merchant_city": aspi.and_then(|a| a.pointer("/data/merchant_city")).cloned().unwrap_or(Value::Null),
                "terminal_label": aspi.and_then(|a| a.pointer("/data/additional_data/terminal_label")).cloned().unwrap_or(Value::Null),
            })
        })
        .collect()
}

// ── Partner (Official Direct Integration) ────────────────────────────────────
pub fn partner_config() -> (Option<String>, Option<String>, Option<String>) {
    (
        std::env::var("GOBIZ_CLIENT_ID").ok(),
        std::env::var("GOBIZ_CLIENT_SECRET").ok(),
        std::env::var("GOBIZ_OUTLET_ID").ok(),
    )
}

pub fn partner_config_error(cfg: &(Option<String>, Option<String>, Option<String>)) -> Option<String> {
    if cfg.0.is_none() || cfg.1.is_none() {
        return Some("Official GoBiz API belum dikonfigurasi. Set env GOBIZ_CLIENT_ID dan GOBIZ_CLIENT_SECRET (kredensial Direct Integration dari portal developer GoBiz).".to_string());
    }
    None
}

pub async fn get_partner_token(client_id: &str, client_secret: &str) -> Result<String, UpstreamErr> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
    {
        let cache = PARTNER_TOKEN.get_or_init(|| Mutex::new(None)).lock().unwrap();
        if let Some((tok, exp)) = cache.as_ref() {
            if *exp > now + 60_000 {
                return Ok(tok.clone());
            }
        }
    }
    let form = "grant_type=client_credentials&scope=payment%3Atransaction%3Aread%20payment%3Atransaction%3Awrite";
    let res = client()
        .post(&format!("{}/oauth2/token", OAUTH_URL))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .basic_auth(client_id, Some(client_secret))
        .body(form.to_string())
        .send()
        .await;
    let resp = match res {
        Err(e) => return Err(UpstreamErr { status: 500, message: e.to_string(), is_auth: false }),
        Ok(r) => r,
    };
    let status = resp.status().as_u16();
    let val: Value = serde_json::from_str(&resp.text().await.unwrap_or_default()).unwrap_or(json!({}));
    if status >= 400 {
        return Err(UpstreamErr { status, message: extract_message(&val, "Gagal mendapatkan partner token"), is_auth: status == 401 || status == 403 });
    }
    let tok = val.get("access_token").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let expires_in = val.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600) * 1000;
    *PARTNER_TOKEN.get_or_init(|| Mutex::new(None)).lock().unwrap() =
        Some((tok.clone(), now + expires_in));
    Ok(tok)
}

pub async fn create_qris_transaction(
    outlet_id: &str,
    order_id: &str,
    gross_amount: i64,
    currency: &str,
    partner_token: &str,
) -> Result<Value, UpstreamErr> {
    let idem = uuid_v4().replace('-', "");
    let idem = &idem[..32.min(idem.len())];
    let mut hdrs = HeaderMap::new();
    let ins = |h: &mut HeaderMap, k: &str, v: &str| {
        if let (Ok(k), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            h.insert(k, v);
        }
    };
    ins(&mut hdrs, "Content-Type", "application/json");
    ins(&mut hdrs, "Authorization", &format!("Bearer {}", partner_token));
    ins(&mut hdrs, "Idempotency-Key", idem);
    post_json(
        &format!("{}/integrations/payment/outlets/{}/v2/transactions", BASE_URL, outlet_id),
        hdrs,
        json!({
            "payment_type": "qris",
            "transaction_details": { "order_id": order_id, "gross_amount": gross_amount, "currency": currency }
        }),
    )
    .await
}

pub async fn get_qris_transaction(
    outlet_id: &str,
    transaction_id: &str,
    partner_token: &str,
) -> Result<Value, UpstreamErr> {
    let mut hdrs = HeaderMap::new();
    let ins = |h: &mut HeaderMap, k: &str, v: &str| {
        if let (Ok(k), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            h.insert(k, v);
        }
    };
    ins(&mut hdrs, "Content-Type", "application/json");
    ins(&mut hdrs, "Authorization", &format!("Bearer {}", partner_token));
    get_json(
        &format!("{}/integrations/payment/outlets/{}/v1/transactions/{}", BASE_URL, outlet_id, transaction_id),
        hdrs,
    )
    .await
}

// ── Token manager (file-backed, sama path dengan Node: apiku/data/) ─────────
pub fn store_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/gopay-tokens.json")
}

fn load_store() -> Value {
    let default = || {
        let mut v = json!({ "accessToken": null, "refreshToken": null, "lastRefresh": null });
        if let Ok(at) = std::env::var("GOBIZ_ACCESS_TOKEN") {
            v["accessToken"] = json!(at);
        }
        if let Ok(rt) = std::env::var("GOBIZ_REFRESH_TOKEN") {
            v["refreshToken"] = json!(rt);
        }
        v
    };
    std::fs::read_to_string(store_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|mut v| {
            if v.get("accessToken").is_none() { v["accessToken"] = Value::Null; }
            if v.get("refreshToken").is_none() { v["refreshToken"] = Value::Null; }
            if v.get("lastRefresh").is_none() { v["lastRefresh"] = Value::Null; }
            if v["accessToken"].is_null() {
                if let Ok(at) = std::env::var("GOBIZ_ACCESS_TOKEN") { v["accessToken"] = json!(at); }
            }
            if v["refreshToken"].is_null() {
                if let Ok(rt) = std::env::var("GOBIZ_REFRESH_TOKEN") { v["refreshToken"] = json!(rt); }
            }
            v
        })
        .unwrap_or_else(default)
}

fn persist_store(cache: &Value) {
    if let Some(dir) = store_path().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(store_path(), serde_json::to_string_pretty(cache).unwrap_or_default());
}

pub fn get_tokens() -> (Option<String>, Option<String>) {
    let s = load_store();
    (
        s["accessToken"].as_str().map(|x| x.to_string()),
        s["refreshToken"].as_str().map(|x| x.to_string()),
    )
}

pub fn has_tokens() -> bool {
    let (a, r) = get_tokens();
    a.is_some() && r.is_some()
}

pub fn token_status() -> Value {
    let s = load_store();
    json!({
        "hasTokens": s["accessToken"].is_string() && s["refreshToken"].is_string(),
        "hasAccessToken": s["accessToken"].is_string(),
        "hasRefreshToken": s["refreshToken"].is_string(),
        "lastRefresh": s["lastRefresh"],
    })
}

pub fn set_tokens(access_token: &str, refresh_token: &str) -> Value {
    let mut cache = load_store();
    cache["accessToken"] = json!(access_token);
    cache["refreshToken"] = json!(refresh_token);
    cache["lastRefresh"] = json!(now_iso());
    persist_store(&cache);
    token_status()
}

pub fn update_access_token(access_token: &str, new_refresh: Option<&str>) {
    let mut cache = load_store();
    cache["accessToken"] = json!(access_token);
    if let Some(nr) = new_refresh {
        if cache["refreshToken"].as_str() != Some(nr) {
            cache["refreshToken"] = json!(nr);
        }
    }
    cache["lastRefresh"] = json!(now_iso());
    persist_store(&cache);
}

async fn run_refresh() -> Result<String, String> {
    let (_, Some(rt)) = get_tokens() else {
        return Err("no_refresh_token".to_string());
    };
    let result = refresh_token(&rt).await.map_err(|e| e.message)?;
    let (Some(at), rotated) = pick_tokens(&result) else {
        return Err("no_access_token_in_response".to_string());
    };
    update_access_token(&at, rotated.as_deref());
    Ok(at)
}

pub async fn ensure_fresh_token() -> Result<(String, bool), String> {
    let (Some(at), _) = get_tokens() else {
        return Err("no_token".to_string());
    };
    match get_me(&at).await {
        Ok(_) => Ok((at, false)),
        Err(e) if e.status == 401 => match run_refresh().await {
            Ok(fresh) => Ok((fresh, true)),
            Err(reason) => Err(reason),
        },
        Err(e) => Err(e.message),
    }
}

// ── QRIS registry (file-backed: apiku/data/gopay-qris.json) ──────────────────
pub fn registry_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/gopay-qris.json")
}

fn load_registry() -> serde_json::Map<String, Value> {
    std::fs::read_to_string(registry_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn save_registry(db: &serde_json::Map<String, Value>) {
    if let Some(dir) = registry_path().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(registry_path(), serde_json::to_string_pretty(&Value::Object(db.clone())).unwrap_or_default());
}

pub fn register_qris(amount: Option<i64>, created_at: &str, image_url: Option<&str>) -> Option<Value> {
    if created_at.is_empty() {
        return None;
    }
    let mut db = load_registry();
    let entry = json!({
        "amount": amount,
        "image_url": image_url,
        "created_at": created_at,
        "registered_at": now_iso(),
    });
    db.insert(created_at.to_string(), entry.clone());
    save_registry(&db);
    Some(entry)
}

pub fn get_qris(created_at: &str) -> Option<Value> {
    load_registry().get(created_at).cloned()
}

pub fn remove_qris(created_at: &str) -> Option<Value> {
    let mut db = load_registry();
    let entry = db.remove(created_at);
    save_registry(&db);
    entry
}

// ── QRIS dynamic payload builders ────────────────────────────────────────────
pub fn convert_crc16(s: &str) -> String {
    let mut crc: u32 = 0xFFFF;
    for c in s.chars() {
        crc ^= (c as u32) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    format!("{:0>4X}", crc & 0xFFFF)
}

pub fn build_dynamic_qris_payload(static_qr: &str, amount: i64) -> Result<String, String> {
    let trimmed = static_qr.trim();
    if trimmed.len() < 4 {
        return Err("QRIS statis tidak valid".to_string());
    }
    let base = &trimmed[..trimmed.len() - 4];
    let step1 = base.replace("010211", "010212");
    let parts: Vec<&str> = step1.split("5802ID").collect();
    if parts.len() < 2 {
        return Err("QRIS statis tidak valid: tag '5802ID' tidak ditemukan.".to_string());
    }
    let amount_str = amount.to_string();
    let uang = format!("54{:02}{}5802ID", amount_str.len(), amount_str);
    let payload = format!("{}{}{}", parts[0], uang, parts[1]);
    let crc = convert_crc16(&payload);
    Ok(format!("{}{}", payload, crc))
}

// ── Token resolution helpers (helpers.js) ────────────────────────────────────
pub struct ResolvedToken {
    pub token: String,
    pub auto_used: bool,
    pub refreshed: bool,
}

pub async fn resolve_token(
    query: &std::collections::HashMap<String, String>,
    body: &Value,
) -> Result<ResolvedToken, String> {
    let explicit = query
        .get("token")
        .or_else(|| query.get("accessToken"))
        .cloned()
        .or_else(|| {
            body.get("token")
                .or_else(|| body.get("accessToken"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
        });
    if let Some(t) = explicit {
        return Ok(ResolvedToken { token: t, auto_used: false, refreshed: false });
    }
    if has_tokens() {
        match ensure_fresh_token().await {
            Ok((tok, refreshed)) => {
                return Ok(ResolvedToken { token: tok, auto_used: true, refreshed });
            }
            Err(_) => {
                let (at, _) = get_tokens();
                if let Some(at) = at {
                    return Ok(ResolvedToken { token: at, auto_used: true, refreshed: false });
                }
                return Err("Token tersimpan sudah tidak berlaku. Jalankan login ulang.".to_string());
            }
        }
    }
    Err("Token belum tersedia. Kirim parameter 'token', atau simpan dulu lewat endpoint gopay-token-save.".to_string())
}

pub async fn resolve_merchant_id(token: &str) -> Option<String> {
    if let Ok(from_env) = std::env::var("GOBIZ_MERCHANT_ID") {
        return Some(from_env);
    }
    let me = get_me(token).await.ok()?;
    me.pointer("/data/user/merchant_id")
        .or_else(|| me.pointer("/user/merchant_id"))
        .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string())))
}

pub fn no_merchant_id() -> Response {
    (
        axum::http::StatusCode::BAD_REQUEST,
        axum::Json(json!({
            "status": false,
            "message": "Merchant ID tidak bisa diturunkan dari access token. Pastikan token belonging ke merchant yang sudah onboard."
        })),
    )
        .into_response()
}

use axum::response::{IntoResponse, Response};

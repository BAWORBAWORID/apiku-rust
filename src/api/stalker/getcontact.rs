
fn truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => !s.is_empty() && s != "0" && s != "false",
        serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        serde_json::Value::Null => false,
        _ => true,
    }
}
// GetContact Stalker — native conversion of api/stalker/getcontact.js
// Encrypted GetContact/VerifyKit client: HMAC-SHA256 signatures, AES-ECB
// payloads, DH key exchange for the per-account finalKey. Supports
// type=profile|tags|login|quota with credential rotation + .gtc/credentials.json
// persistence (same layout as the Node version).
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use aes::cipher::{BlockCipherEncrypt, BlockCipherDecrypt, KeyInit};
use base64::Engine;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const GTC_BASE: &str = "https://pbssrv-centralevents.com";
const HMAC_KEY: &str = "31426764382a642f3a6665497235466f3d236d5d785b722b4c657457442a495b494524324866782a2364292478587a78662d7a7b7578593f71703e2b7e365762";
const VFK_BASE: &str = "https://api.verifykit.com";
const VFK_HMAC_KEY: &str = "3452235d713252604a35562d325f765238695738485863672a705e6841544d3c7e6e45463028266f372b544e596f3829236b392825262e534a7e774f37653932";
const VFK_CLIENT_KEY: &str = "bhvbd7ced119dc6ad6a0b35bd3cf836555d6f71930d9e5a405f32105c790d";
const VFK_FINAL_KEY: &str = "bd48d8c25293cfb537619cc93ae3d6e372eb2ddfffff4ab0eb000777144c7bfa";

const WORKER_PROXIES: &[&str] = &[
    "https://cors.caliph.my.id/",
    "https://plain-wave-6f5f.apis1.workers.dev/",
    "https://young-hill-815e.apis3.workers.dev/",
    "https://icy-morning-72e2.apis2.workers.dev/",
    "https://cors.fazri.workers.dev/",
    "https://spring-night-57a1.3540746063.workers.dev/",
    "https://cors.sizable.workers.dev/",
    "https://jiashu.1win.eu.org/",
    "https://prox.26bruunjorl.workers.dev/",
];

const APP_VERSION: &str = "8.4.0";
const ANDROID_OS: &str = "android 9";
const LANG: &str = "en_US";
const DEVICE_NAME: &str = "SM-G977N";
const BUNDLE_ID: &str = "app.source.getcontact";
const COUNTRY: &str = "id";

const DH_P: u128 = 900719898367;
const DH_G: u128 = 7;

static PROXY_INDEX: AtomicUsize = AtomicUsize::new(0);

fn get_next_worker_proxy() -> &'static str {
    let i = PROXY_INDEX.fetch_add(1, Ordering::Relaxed) % WORKER_PROXIES.len();
    WORKER_PROXIES[i]
}

fn gtc_dir() -> PathBuf {
    // repo root = crate dir /../.. relative to this module; keep parity with
    // the Node layout: <repo>/.gtc — the crate lives at <repo>/apiku-rs so go up.
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    // try both layouts
    let a = cwd.join(".gtc");
    if a.exists() {
        return a;
    }
    let b = cwd.join("..").join(".gtc");
    let _ = std::fs::create_dir_all(&b);
    b
}

fn load_store() -> Value {
    let p = gtc_dir().join("credentials.json");
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(json!({}))
}

fn save_store(store: &Value) {
    let p = gtc_dir().join("credentials.json");
    let _ = std::fs::create_dir_all(gtc_dir());
    let _ = std::fs::write(p, serde_json::to_string_pretty(store).unwrap_or_default());
}

#[derive(Clone)]
struct PendingSession {
    reference: String,
    token: String,
    final_key: String,
    device_id: String,
    phone: String,
    country: String,
    lang: String,
    deeplink: String,
    code: String,
    proxy: String,
    timestamp: u64,
}

static PENDING: Mutex<Option<HashMap<String, PendingSession>>> = Mutex::new(None);

fn load_pending() -> HashMap<String, PendingSession> {
    // also hydrate from disk pending_logins.json
    let p = gtc_dir().join("pending_logins.json");
    if let Ok(raw) = std::fs::read_to_string(&p) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            let now = now_ms();
            let mut out: HashMap<String, PendingSession> = HashMap::new();
            if let Some(map) = v.as_object() {
                for (k, val) in map {
                    let ts = val.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
                    if now - ts > 15 * 60_000 {
                        continue;
                    }
                    out.insert(
                        k.clone(),
                        PendingSession {
                            reference: val.get("reference").and_then(|x| x.as_str()).unwrap_or("").into(),
                            token: val.get("token").and_then(|x| x.as_str()).unwrap_or("").into(),
                            final_key: val.get("finalKey").and_then(|x| x.as_str()).unwrap_or("").into(),
                            device_id: val.get("deviceId").and_then(|x| x.as_str()).unwrap_or("").into(),
                            phone: val.get("phone").and_then(|x| x.as_str()).unwrap_or("").into(),
                            country: val.get("country").and_then(|x| x.as_str()).unwrap_or("id").into(),
                            lang: val.get("lang").and_then(|x| x.as_str()).unwrap_or("in_ID").into(),
                            deeplink: val.get("deeplink").and_then(|x| x.as_str()).unwrap_or("").into(),
                            code: val.get("code").and_then(|x| x.as_str()).unwrap_or("").into(),
                            proxy: val.get("proxy").and_then(|x| x.as_str()).unwrap_or("").into(),
                            timestamp: ts,
                        },
                    );
                }
            }
            return out;
        }
    }
    HashMap::new()
}

fn save_pending(store: &HashMap<String, PendingSession>) {
    let p = gtc_dir().join("pending_logins.json");
    let _ = std::fs::create_dir_all(gtc_dir());
    let v: Value = store
        .iter()
        .map(|(k, s)| {
            (
                k.clone(),
                json!({
                    "reference": s.reference, "token": s.token, "finalKey": s.final_key,
                    "deviceId": s.device_id, "phone": s.phone, "country": s.country,
                    "lang": s.lang, "deeplink": s.deeplink, "code": s.code,
                    "proxy": s.proxy, "timestamp": s.timestamp,
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>()
        .into();
    let _ = std::fs::write(p, serde_json::to_string_pretty(&v).unwrap_or_default());
}

fn get_pending(key: &str) -> Option<PendingSession> {
    load_pending().get(key).cloned()
}

fn set_pending(key: &str, session: &PendingSession) {
    let mut m = load_pending();
    m.insert(key.to_string(), session.clone());
    save_pending(&m);
}

fn delete_pending(key: &str) {
    let mut m = load_pending();
    m.remove(key);
    save_pending(&m);
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn ts() -> String {
    now_ms().to_string()
}

fn is_protected_number(raw: &str) -> bool {
    // Node kept an empty PROTECTED_PHONE_CORES set — same here.
    let _ = raw;
    false
}

fn mask_phone(val: &str) -> String {
    if val.is_empty() {
        return val.to_string();
    }
    let digits: String = val.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 7 {
        let has_plus = val.starts_with('+');
        let prefix_len = if has_plus { 3 } else { 2 };
        let suffix_len = 2;
        let prefix: String = val.chars().take(prefix_len).collect();
        let suffix: String = val.chars().skip(val.len().saturating_sub(suffix_len)).collect();
        let mask_len = (val.len() - prefix_len - suffix_len).max(6);
        format!("{}{}{}", prefix, "*".repeat(mask_len), suffix)
    } else if val.len() <= 4 {
        let mut c = val.chars();
        match c.next() {
            Some(f) => format!("{}{}", f, "*".repeat(val.len() - 1)),
            None => String::new(),
        }
    } else {
        let prefix: String = val.chars().take(2).collect();
        format!("{}{}", prefix, "*".repeat(val.len() - 2))
    }
}

struct CountryInfo {
    country: &'static str,
    country_upper: &'static str,
    mcc: &'static str,
    mnc: &'static str,
    carrier: &'static str,
    tz: &'static str,
    lang: &'static str,
}

fn detect_country(phone: &str) -> CountryInfo {
    let clean = phone.trim_start_matches('+');
    let f = |c: &'static str, cu: &'static str, mcc: &'static str, mnc: &'static str, carrier: &'static str, tz: &'static str, lang: &'static str| CountryInfo {
        country: c, country_upper: cu, mcc, mnc, carrier, tz, lang,
    };
    if clean.starts_with("62") { f("id", "ID", "510", "01", "Indosat Ooredoo", "Asia/Jakarta", "in_ID") }
    else if clean.starts_with("63") { f("ph", "PH", "515", "02", "Globe", "Asia/Manila", "en_US") }
    else if clean.starts_with("60") { f("my", "MY", "502", "12", "Maxis", "Asia/Kuala_Lumpur", "en_US") }
    else if clean.starts_with("65") { f("sg", "SG", "525", "01", "Singtel", "Asia/Singapore", "en_US") }
    else if clean.starts_with("1") { f("us", "US", "310", "410", "AT&T", "America/New_York", "en_US") }
    else if clean.starts_with("44") { f("gb", "GB", "234", "10", "O2", "Europe/London", "en_US") }
    else if clean.starts_with("84") { f("vn", "VN", "452", "04", "Viettel", "Asia/Ho_Chi_Minh", "en_US") }
    else if clean.starts_with("66") { f("th", "TH", "520", "01", "AIS", "Asia/Bangkok", "en_US") }
    else if clean.starts_with("91") { f("in", "IN", "404", "45", "Airtel", "Asia/Kolkata", "en_US") }
    else if clean.starts_with("7") { f("ru", "RU", "250", "01", "MTS", "Europe/Moscow", "en_US") }
    else if clean.starts_with("90") { f("tr", "TR", "286", "01", "Turkcell", "Europe/Istanbul", "en_US") }
    else { f("id", "ID", "510", "01", "Indosat Ooredoo", "Asia/Jakarta", "in_ID") }
}

fn sig(t: &str, message: &str, key_hex: &str) -> String {
    let mut key = [0u8; 48];
    let raw = hex::decode(key_hex).unwrap_or_default();
    key[..raw.len()].copy_from_slice(&raw);
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key[..raw.len()]).unwrap();
    mac.update(format!("{}-{}", t, message).as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

fn pad_pkcs7(data: &[u8]) -> Vec<u8> {
    let n = 16 - (data.len() % 16);
    let mut out = data.to_vec();
    out.extend(std::iter::repeat(n as u8).take(n));
    out
}

fn encrypt_aes(data: &str, key_hex: &str) -> Result<String, String> {
    let key = hex::decode(key_hex).map_err(|e| e.to_string())?;
    let mut padded = pad_pkcs7(data.as_bytes());
    while padded.len() % 16 != 0 { padded.push(0); }
    match key.len() {
        16 => {
            let cipher = aes::Aes128::new_from_slice(&key).map_err(|e| e.to_string())?;
            for chunk in padded.chunks_mut(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                use aes::cipher::BlockCipherEncrypt;
                cipher.encrypt_block(&mut block);
                chunk.copy_from_slice(&block);
            }
        }
        24 => {
            let cipher = aes::Aes192::new_from_slice(&key).map_err(|e| e.to_string())?;
            for chunk in padded.chunks_mut(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                use aes::cipher::BlockCipherEncrypt;
                cipher.encrypt_block(&mut block);
                chunk.copy_from_slice(&block);
            }
        }
        32 => {
            let cipher = aes::Aes256::new_from_slice(&key).map_err(|e| e.to_string())?;
            for chunk in padded.chunks_mut(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                use aes::cipher::BlockCipherEncrypt;
                cipher.encrypt_block(&mut block);
                chunk.copy_from_slice(&block);
            }
        }
        _ => return Err("unsupported AES key size".into()),
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&padded))
}

fn decrypt_aes(data_b64: &str, key_hex: &str) -> Result<String, String> {
    let key = hex::decode(key_hex).map_err(|e| e.to_string())?;
    let mut buf = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    if buf.len() % 16 != 0 {
        return Err("ciphertext not block-aligned".into());
    }
    for chunk in buf.chunks_mut(16) {
        let mut block = aes::Block::clone_from_slice(chunk);
        use aes::cipher::BlockCipherDecrypt;
        match key.len() {
            16 => aes::Aes128::new_from_slice(&key).unwrap().decrypt_block(&mut block),
            24 => aes::Aes192::new_from_slice(&key).unwrap().decrypt_block(&mut block),
            32 => aes::Aes256::new_from_slice(&key).unwrap().decrypt_block(&mut block),
            _ => return Err("unsupported AES key size".into()),
        }
        chunk.copy_from_slice(&block);
    }
    if buf.is_empty() {
        return Err("empty ciphertext".into());
    }
    let pad_len = *buf.last().unwrap() as usize;
    if pad_len == 0 || pad_len > 16 || pad_len > buf.len() {
        return Err("bad padding".into());
    }
    String::from_utf8(buf[..buf.len() - pad_len].to_vec()).map_err(|e| e.to_string())
}

fn mod_pow(mut base: u128, mut exp: u128, m: u128) -> u128 {
    if m == 1 {
        return 0;
    }
    let mut res: u128 = 1;
    base %= m;
    while exp > 0 {
        if exp & 1 == 1 {
            // careful with overflow: m ~ 9e11, base < m, product < 8.1e23 > u128 max? u128 max ~3.4e38, fine.
            res = (res * base) % m;
        }
        base = (base * base) % m;
        exp >>= 1;
    }
    res
}

fn dh_keypair() -> (u128, u128) {
    use rand::Rng;
    let priv_k: u128 = rand::thread_rng().gen_range(1_000_000u128..100_000_000u128);
    let pub_k = mod_pow(DH_G, priv_k, DH_P);
    (priv_k, pub_k)
}

fn dh_final_key(priv_k: u128, server_pub: u128) -> String {
    let shared = mod_pow(server_pub, priv_k, DH_P);
    let mut h = Sha256::new();
    h.update(shared.to_string().as_bytes());
    hex::encode(h.finalize())
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .user_agent("okhttp/4.12.0")
        .build()
        .map_err(|e| e.to_string())
}

async fn gtc_call(
    endpoint: &str,
    payload: &Value,
    token: &str,
    final_key: &str,
    device_id: &str,
    country: &str,
) -> Result<(u16, Value), String> {
    let raw = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let t = ts();
    let c = client(25)?;
    let res = c
        .post(format!("{}{}", GTC_BASE, endpoint))
                    .header("Content-Type", "application/json")
        .header("x-os", ANDROID_OS)
        .header("x-app-version", APP_VERSION)
        .header("x-client-device-id", device_id)
        .header("x-lang", LANG)
        .header("x-req-timestamp", &t)
        .header("x-country-code", country)
                    .header("x-encrypted", "1")
        .header("x-req-signature", sig(&t, &raw, HMAC_KEY))
        .header("x-token", token)
        .body(json!({ "data": encrypt_aes(&raw, final_key)? }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let parsed: Value = match res.json().await {
        Ok(v) => v,
        Err(_) => return Err(format!("{}: non-JSON response (HTTP {})", endpoint, status)),
    };
    let parsed = if parsed.get("data").is_some() {
        let data = parsed.get("data").and_then(|d| d.as_str()).unwrap_or("");
        serde_json::from_str(&decrypt_aes(data, final_key)?)
            .map_err(|e| format!("{}: decrypt/parse failed: {}", endpoint, e))?
    } else {
        parsed
    };
    Ok((status, parsed))
}

fn dig<'a>(v: &'a Value, path: &str) -> &'a Value {
    v.pointer(&format!("/{}", path.replace('.', "/")))
        .unwrap_or(&Value::Null)
}

fn dig_s(v: &Value, path: &str) -> Option<String> {
    dig(v, path).as_str().map(|s| s.to_string())
}

async fn vfk_call(
    endpoint: &str,
    payload: &Value,
    device_id: &str,
    lang: &str,
    pinned_proxy: Option<&str>,
) -> Result<(u16, Value, String), String> {
    let raw = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let t = ts();
    let body = json!({ "data": encrypt_aes(&raw, VFK_FINAL_KEY)? }).to_string();
    let mk_headers = || -> Vec<(String, String)> {
        vec![
            ("Content-Type".into(), "application/json".into()),
            ("X-VFK-Client-Device-Id".into(), device_id.into()),
            ("X-VFK-Client-Key".into(), VFK_CLIENT_KEY.into()),
            ("X-VFK-Sdk-Version".into(), "0.11.4".into()),
            ("X-VFK-Os".into(), "android 9.0".into()),
            ("X-VFK-App-Version".into(), "8.16.0".into()),
            ("X-VFK-Encrypted".into(), "1".into()),
            ("X-VFK-Lang".into(), lang.into()),
            ("X-VFK-Req-Timestamp".into(), t.clone()),
            ("X-VFK-Req-Signature".into(), sig(&t, &raw, VFK_HMAC_KEY)),
        ]
    };

    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = pinned_proxy {
        candidates.push(p.to_string());
    }
    let next = get_next_worker_proxy().to_string();
    if !candidates.contains(&next) {
        candidates.push(next);
    }
    // deterministic rotation for the rest (Rust: skip random shuffle, use order)
    for w in WORKER_PROXIES {
        let ws = w.to_string();
        if !candidates.contains(&ws) {
            candidates.push(ws);
        }
    }

    let c = client(15)?;
    let mut last_error = String::new();
    for p in &candidates {
        let url = if p.contains("workers.dev") || p.contains("1win.eu.org") || p.contains(".my.id/") || p.contains("cors.") {
            let prefix = if p.ends_with('/') { p.clone() } else { format!("{}/", p) };
            format!("{}{}{}", prefix, VFK_BASE, endpoint)
        } else {
            format!("{}{}", VFK_BASE, endpoint)
        };
        let mut req = c.post(&url);
        for (k, v) in mk_headers() {
            req = req.header(&k, &v);
        }
        let res = match req.body(body.clone()).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        let mut parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if parsed.get("data").is_some() {
            let data = parsed.get("data").and_then(|d| d.as_str()).unwrap_or("");
            match decrypt_aes(data, VFK_FINAL_KEY).and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string())) {
                Ok(inner) => parsed = inner,
                Err(e) => {
                    last_error = e;
                    continue;
                }
            }
        }
        if status == 429 || status == 404 || status == 502 {
            last_error = format!("VerifyKit {} via proxy {} returned HTTP {}", endpoint, p, status);
            continue;
        }
        return Ok((status, parsed, p.clone()));
    }
    Err(if last_error.is_empty() {
        format!("VerifyKit {}: all proxies failed", endpoint)
    } else {
        last_error
    })
}

fn normalize_phone(raw: &str) -> Result<String, String> {
    let p: String = raw.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
    let p = p.trim().to_string();
    if p.is_empty() {
        return Err("Nomor telepon tidak boleh kosong".into());
    }
    if p.starts_with('+') {
        return Ok(p);
    }
    if p.starts_with('0') {
        return Ok(format!("+62{}", &p[1..]));
    }
    Ok(format!("+{}", p))
}

async fn api_search(
    token: &str,
    final_key: &str,
    device_id: &str,
    phone: &str,
    source: &str,
) -> Result<Value, String> {
    if is_protected_number(phone) {
        return Err("Nomor ini dilindungi oleh privasi dan tidak dapat dicari.".into());
    }
    let c_info = detect_country(phone);
    let endpoint = if source == "tags" { "/v2.8/number-detail" } else { "/v2.8/search" };
    let (code, body) = gtc_call(
        endpoint,
        &json!({
            "countryCode": c_info.country,
            "phoneNumber": phone,
            "source": if source == "tags" { "profile" } else { "search" },
            "token": token,
        }),
        token,
        final_key,
        device_id,
        c_info.country,
    )
    .await?;
    let meta = dig(&body, "meta.httpStatusCode").as_i64().unwrap_or(-1);
    if code != 200 || meta != 200 {
        return Err(format!(
            "HTTP {}/{}: {}",
            code,
            meta,
            dig_s(&body, "meta.errorMessage").unwrap_or_else(|| "unknown error".into())
        ));
    }
    Ok(body)
}

async fn api_subscription(token: &str, final_key: &str, device_id: &str, phone: &str) -> Result<Value, String> {
    let c_info = detect_country(phone);
    let (code, body) = gtc_call(
        "/v2.8/subscription",
        &json!({ "token": token }),
        token,
        final_key,
        device_id,
        c_info.country,
    )
    .await?;
    if code != 200 {
        return Err(format!(
            "HTTP {}: {}",
            code,
            dig_s(&body, "meta.errorMessage").unwrap_or_else(|| "unknown error".into())
        ));
    }
    Ok(body)
}

fn is_auth_failure(msg: &str) -> bool {
    let re = regex::Regex::new(r"(?i)403001|Authentication failed|Invalid token|token expired|unauthorized").unwrap();
    re.is_match(msg)
}

async fn api_search_with_fallback(phone: &str, source: &str) -> Result<(String, Value), String> {
    let store = load_store();
    let creds = store.get("credentials").and_then(|c| c.as_object()).cloned().unwrap_or_default();
    if creds.is_empty() {
        return Err("No GetContact credential configured. Gunakan type=login untuk login terlebih dahulu.".into());
    }
    let active = store
        .get("active")
        .and_then(|a| a.as_str())
        .filter(|a| creds.contains_key(*a))
        .unwrap_or_else(|| creds.keys().next().unwrap())
        .to_string();

    // rotation: active first, then others (in insertion order)
    let mut order: Vec<String> = vec![active.clone()];
    for k in creds.keys() {
        if *k != active {
            order.push(k.clone());
        }
    }

    let mut last_error = String::new();
    for name in &order {
        let cred = &creds[name];
        let token = cred.get("token").and_then(|t| t.as_str()).unwrap_or("");
        let fk = cred.get("finalKey").and_then(|t| t.as_str()).unwrap_or("");
        let dev = cred.get("clientDeviceId").and_then(|t| t.as_str()).unwrap_or("");
        if token.is_empty() || fk.is_empty() || dev.is_empty() {
            continue;
        }
        match api_search(token, fk, dev, phone, source).await {
            Ok(body) => return Ok((name.clone(), body)),
            Err(e) => {
                let not_found_re = regex::Regex::new(r"(?i)404.*No result found").unwrap();
                if not_found_re.is_match(&e) {
                    return Err(e);
                }
                last_error = e;
                continue;
            }
        }
    }
    Err(last_error)
}

fn format_profile(profile: &Value) -> Value {
    if profile.is_null() {
        return Value::Null;
    }
    let mut out = serde_json::Map::new();
    for k in [
        "displayName", "name", "surname", "phoneNumber", "displayNumber",
        "country", "countryCode", "email", "trustScore", "tagCount", "profileImage",
    ] {
        out.insert(k.into(), profile.get(k).cloned().unwrap_or(Value::Null));
    }
    Value::Object(out)
}

fn format_tags(tags: &Value) -> Value {
    let arr = tags.as_array().cloned().unwrap_or_default();
    Value::Array(
        arr.iter()
            .map(|t| {
                json!({
                    "tag": t.get("tag").cloned().unwrap_or(Value::Null),
                    "count": t.get("count").cloned().unwrap_or(Value::Null),
                    "isNew": t.get("isNew").map(truthy).unwrap_or(false),
                    "removable": t.get("removable").map(truthy).unwrap_or(false),
                })
            })
            .collect(),
    )
}

fn format_quota(sub: &Value) -> Value {
    if sub.is_null() {
        return Value::Null;
    }
    let pick = |k: &str| {
        let d = sub.pointer(&format!("/usage/{}", k)).cloned().unwrap_or(json!({}));
        json!({
            "limit": d.get("limit").cloned().unwrap_or(Value::Null),
            "remaining": d.get("remainingCount").cloned().unwrap_or(Value::Null),
        })
    };
    json!({
        "premiumType": sub.get("premiumType").or_else(|| sub.get("premiumTypeName")).cloned().unwrap_or(json!("free")),
        "renewDate": sub.get("renewDate").cloned().unwrap_or(Value::Null),
        "search": pick("search"),
        "numberDetail": pick("numberDetail"),
        "biography": pick("biography"),
    })
}

fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..n).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

async fn start_login_flow(phone: &str) -> Result<PendingSession, String> {
    let c_info = detect_country(phone);
    let device_id = random_hex(8);
    let (priv_k, pub_k) = dh_keypair();

    let reg_body = json!({
        "carrierCountryCode": c_info.mcc,
        "carrierName": c_info.carrier,
        "carrierNetworkCode": c_info.mnc,
        "countryCode": c_info.country,
        "deepLink": Value::Null,
        "deviceName": DEVICE_NAME,
        "deviceType": "Android",
        "email": Value::Null,
        "notificationToken": "",
        "oldToken": Value::Null,
        "peerKey": pub_k.to_string(),
        "timeZone": c_info.tz,
        "token": "",
    });
    let raw = serde_json::to_string(&reg_body).unwrap();
    let t = ts();
    let c = client(25)?;
    let reg_res = c
        .post(format!("{}/v2.8/register", GTC_BASE))
                    .header("Content-Type", "application/json")
        .header("x-os", ANDROID_OS)
        .header("x-app-version", APP_VERSION)
        .header("x-client-device-id", &device_id)
        .header("x-lang", LANG)
        .header("x-req-timestamp", &t)
        .header("x-country-code", c_info.country)
                    .header("x-encrypted", "0")
        .header("x-req-signature", sig(&t, &raw, HMAC_KEY))
        .body(raw)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = reg_res.status().as_u16();
    if status != 201 {
        let err = reg_res.text().await.unwrap_or_default();
        return Err(format!(
            "GetContact register failed (HTTP {}): {}",
            status,
            &err[..err.len().min(200)]
        ));
    }
    let reg_data: Value = reg_res.json().await.map_err(|e| e.to_string())?;
    let token = dig_s(&reg_data, "result.token").ok_or("GetContact register: missing token or serverKey")?;
    let server_key = dig(&reg_data, "result.serverKey").as_str().and_then(|v| v.parse::<u128>().ok()).ok_or("GetContact register: missing token or serverKey")?;
    let final_key = dh_final_key(priv_k, server_key);

    let base = json!({
        "carrierCountryCode": c_info.mcc,
        "carrierName": c_info.carrier,
        "carrierNetworkCode": c_info.mnc,
        "countryCode": c_info.country,
        "deviceName": DEVICE_NAME,
        "notificationToken": "",
        "timeZone": c_info.tz,
        "token": token,
    });

    let (email, full_name) = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (
            format!("user{}@gmail.com", rng.gen_range(10_000_000u64..100_000_000)),
            format!("User{}", rng.gen_range(1000u64..1_000_000)),
        )
    };

    let steps: Vec<(&str, Value, u16)> = vec![
        ("/v2.8/init-basic", base.clone(), 201),
        ("/v2.8/ad-settings", json!({ "source": "init", "token": token }), 200),
        ("/v2.8/init-intro", { let mut b = base.clone(); b["hasRouting"] = json!(false); b }, 201),
        ("/v2.8/email-code-validate/start", json!({ "email": email, "fullName": full_name, "token": token }), 200),
        ("/v2.8/country", json!({ "countryCode": c_info.country_upper, "token": token }), 200),
        ("/v2.8/validation-start", json!({ "app": "verifykit", "countryCode": c_info.country, "notificationToken": "", "token": token }), 200),
    ];

    for (endpoint, payload, want) in steps {
        let (code, body) = gtc_call(endpoint, &payload, &token, &final_key, &device_id, c_info.country).await?;
        if code != want {
            return Err(format!("Init step {} failed (HTTP {}): {}", endpoint, code, body));
        }
    }

    let raw_phone = phone.trim_start_matches('+');
    let (init_code, _init_body, used_proxy) = vfk_call(
        "/v2.0/init",
        &json!({
            "isCallPermissionGranted": true,
            "countryCode": c_info.country_upper,
            "deviceName": DEVICE_NAME,
            "installedApps": r#"{"whatsapp":0,"telegram":0,"viber":0}"#,
            "outsideCountryCode": c_info.country_upper,
            "outsidePhoneNumber": raw_phone,
            "timezone": c_info.tz,
            "bundleId": BUNDLE_ID,
        }),
        &device_id,
        c_info.lang,
        None,
    )
    .await?;
    if init_code != 200 {
        return Err(format!("VerifyKit init failed (HTTP {})", init_code));
    }

    let (country_code, _country_body, _) = vfk_call(
        "/v2.0/country",
        &json!({ "countryCode": c_info.country_upper, "bundleId": BUNDLE_ID }),
        &device_id,
        c_info.lang,
        Some(&used_proxy),
    )
    .await?;
    if country_code != 200 {
        return Err(format!("VerifyKit country failed (HTTP {})", country_code));
    }

    let (start_code, start_body, _) = vfk_call(
        "/v2.0/start",
        &json!({
            "countryCode": c_info.country_upper,
            "mcc": c_info.mcc,
            "mnc": c_info.mnc,
            "phoneNumber": phone,
            "app": "whatsapp",
            "bundleId": BUNDLE_ID,
        }),
        &device_id,
        c_info.lang,
        Some(&used_proxy),
    )
    .await?;

    let deeplink = dig_s(&start_body, "result.deeplink").ok_or_else(|| format!("VerifyKit start failed (HTTP {})", start_code))?;
    let reference = dig_s(&start_body, "result.reference").ok_or_else(|| format!("VerifyKit start failed (HTTP {})", start_code))?;

    let decoded = urlencoding::decode(&deeplink).map(|s| s.into_owned()).unwrap_or(deeplink.clone());
    let re = regex::Regex::new(r"\*(.*?)\*").unwrap();
    let code_re = regex::Regex::new(r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$").unwrap();
    let verification = re
        .captures_iter(&decoded)
        .map(|m| m.get(1).unwrap().as_str().to_string())
        .find(|c| code_re.is_match(c))
        .unwrap_or_default();

    let _ = gtc_call(
        "/v2.8/validation-start",
        &json!({ "app": "verifykit", "countryCode": c_info.country, "notificationToken": "", "token": token }),
        &token,
        &final_key,
        &device_id,
        c_info.country,
    )
    .await;

    Ok(PendingSession {
        reference,
        token,
        final_key,
        device_id,
        phone: phone.to_string(),
        country: c_info.country.to_string(),
        lang: c_info.lang.to_string(),
        deeplink,
        code: verification,
        proxy: used_proxy,
        timestamp: now_ms(),
    })
}

async fn check_login_verification(pending: &PendingSession) -> Result<(bool, Value, Option<Value>), String> {
    let (code, body, _) = vfk_call(
        "/v2.0/check",
        &json!({ "reference": pending.reference, "bundleId": BUNDLE_ID }),
        &pending.device_id,
        &pending.lang,
        Some(&pending.proxy),
    )
    .await?;
    let Some(session_id) = dig_s(&body, "result.sessionId") else {
        return Ok((false, body, None));
    };
    let (res_code, res_body) = gtc_call(
        "/v2.8/verifykit-result",
        &json!({ "sessionId": session_id, "token": pending.token }),
        &pending.token,
        &pending.final_key,
        &pending.device_id,
        &pending.country,
    )
    .await?;
    let Some(validation_date) = dig_s(&res_body, "result.validationDate") else {
        return Err(format!("GetContact verifykit-result failed (HTTP {}): {}", res_code, res_body));
    };

    let clean_key = pending.phone.trim_start_matches('+').to_string();
    let mut store = load_store();
    let obj = store.as_object_mut().unwrap();
    let creds = obj
        .entry("credentials")
        .or_insert_with(|| json!({}));
    creds[clean_key.as_str()] = json!({
        "description": format!("Generated {}", validation_date),
        "phoneNumber": pending.phone,
        "clientDeviceId": pending.device_id,
        "finalKey": pending.final_key,
        "token": pending.token,
        "validationDate": validation_date,
    });
    obj.insert("active".into(), json!(clean_key));
    save_store(&store);

    let quota = api_subscription(&pending.token, &pending.final_key, &pending.device_id, &pending.phone).await
        .ok()
        .map(|s| {
            format_quota(
                dig(&s, "result.subscriptionInfo")
                    .if_null_then(dig(&s, "result.quota")),
            )
        })
        .or_else(|| None);

    Ok((true, json!(validation_date), quota))
}

trait IfNullThen {
    fn if_null_then<'a>(&'a self, other: &'a Value) -> &'a Value;
}
impl IfNullThen for Value {
    fn if_null_then<'a>(&'a self, other: &'a Value) -> &'a Value {
        if self.is_null() { other } else { self }
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = std::time::Instant::now();
    let get = |k: &str| -> Option<String> {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()))
        })
    };
    let type_raw = get("type").unwrap_or_else(|| "profile".into()).to_lowercase();
    if !["profile", "tags", "login", "quota"].contains(&type_raw.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'type' harus 'profile', 'tags', 'login', atau 'quota'",
        })))
        .into_response();
    }
    let dur = || format!("{}ms", start.elapsed().as_millis());

    if type_raw == "quota" {
        let store = load_store();
        let active_name = store
            .get("active")
            .and_then(|a| a.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let creds = store.get("credentials").and_then(|c| c.as_object()).cloned().unwrap_or_default();
        let mut accounts: Vec<Value> = Vec::new();
        for (name, cred) in &creds {
            let token = cred.get("token").and_then(|t| t.as_str()).unwrap_or("");
            let fk = cred.get("finalKey").and_then(|t| t.as_str()).unwrap_or("");
            let dev = cred.get("clientDeviceId").and_then(|t| t.as_str()).unwrap_or("");
            if token.is_empty() || fk.is_empty() || dev.is_empty() {
                continue;
            }
            let ph = cred.get("phoneNumber").and_then(|p| p.as_str()).unwrap_or(name);
            match api_subscription(token, fk, dev, ph).await {
                Ok(sbody) => {
                    let sub = dig(&sbody, "result.subscriptionInfo").clone();
                    let usage = sub.get("usage").cloned().unwrap_or(json!({}));
                    let u = |k: &str| usage.get(k).cloned().unwrap_or(json!({}));
                    accounts.push(json!({
                        "account": mask_phone(name),
                        "phoneNumber": mask_phone(ph),
                        "isActive": name == &active_name,
                        "validationDate": cred.get("validationDate").cloned().unwrap_or(json!("-")),
                        "plan": sub.get("premiumTypeName").cloned().unwrap_or(json!("Free")),
                        "renewDate": sub.get("renewDate").cloned().unwrap_or(json!("-")),
                        "search": {
                            "limit": u("search").get("limit").cloned().unwrap_or(json!(200)),
                            "remaining": u("search").get("remainingCount").cloned().unwrap_or(json!(0)),
                        },
                        "tags": {
                            "limit": u("numberDetail").get("limit").cloned().unwrap_or(json!(0)),
                            "remaining": u("numberDetail").get("remainingCount").cloned().unwrap_or(json!(0)),
                            "restriction": u("numberDetail").pointer("/localizations/description").cloned().unwrap_or(json!("Free tier")),
                        },
                        "biography": {
                            "limit": u("biography").get("limit").cloned().unwrap_or(json!(0)),
                            "remaining": u("biography").get("remainingCount").cloned().unwrap_or(json!(0)),
                        },
                    }));
                }
                Err(e) => {
                    accounts.push(json!({
                        "account": mask_phone(name),
                        "phoneNumber": mask_phone(ph),
                        "isActive": name == &active_name,
                        "error": e,
                    }));
                }
            }
        }
        let total_remaining: i64 = accounts
            .iter()
            .filter_map(|a| a.pointer("/search/remaining").and_then(|r| r.as_i64()))
            .sum();
        return Json(json!({
            "status": true,
            "type": "quota",
            "totalAccounts": accounts.len(),
            "activeAccount": if active_name.is_empty() { Value::Null } else { Value::String(mask_phone(&active_name)) },
            "totalSearchRemaining": total_remaining,
            "accounts": accounts,
            "metadata": { "processing_time": dur() },
        }))
        .into_response();
    }

    let phone = match get("phone") {
        Some(p) if !p.trim().is_empty() => p,
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'phone' wajib diisi",
            })))
            .into_response()
        }
    };
    let normalized = match normalize_phone(&phone) {
        Ok(n) => n,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "message": e })))
                .into_response()
        }
    };
    let clean_key = normalized.trim_start_matches('+').to_string();

    if type_raw == "login" {
        if let Some(pending) = get_pending(&clean_key) {
            match check_login_verification(&pending).await {
                Ok((true, validation_date, quota)) => {
                    delete_pending(&clean_key);
                    return Json(json!({
                        "status": true,
                        "type": "login",
                        "message": "Login GetContact berhasil! Akun telah disimpan dan aktif digunakan oleh API.",
                        "result": {
                            "account": clean_key,
                            "phone": pending.phone,
                            "validationDate": validation_date,
                            "active": true,
                            "quota": quota,
                        },
                        "metadata": { "processing_time": dur() },
                    }))
                    .into_response();
                }
                Ok((false, _body, _)) => {
                    return Json(json!({
                        "status": false,
                        "type": "login",
                        "message": "Verifikasi WhatsApp belum selesai. Pastikan pesan WhatsApp sudah terkirim (centang dua) dari nomor yang didaftarkan, lalu panggil kembali endpoint ini.",
                        "result": {
                            "phone": pending.phone,
                            "reference": pending.reference,
                            "code": pending.code,
                            "whatsapp_url": pending.deeplink,
                        },
                        "metadata": { "processing_time": dur() },
                    }))
                    .into_response();
                }
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, Json(json!({
                        "status": false,
                        "message": e,
                        "metadata": { "processing_time": dur() },
                    })))
                    .into_response()
                }
            }
        }
        let store = load_store();
        if let Some(cred) = store.pointer(&format!("/credentials/{}", clean_key)) {
            return Json(json!({
                "status": true,
                "type": "login",
                "message": "Akun ini sudah berhasil login dan aktif digunakan oleh API.",
                "result": {
                    "account": clean_key,
                    "phone": cred.get("phoneNumber").cloned().unwrap_or(json!(normalized)),
                    "validationDate": cred.get("validationDate").cloned().unwrap_or(Value::Null),
                    "active": store.get("active").and_then(|a| a.as_str()) == Some(clean_key.as_str()),
                },
                "metadata": { "processing_time": dur() },
            }))
            .into_response();
        }
        return match start_login_flow(&normalized).await {
            Ok(pending) => {
                let result = json!({
                    "phone": normalized,
                    "reference": pending.reference,
                    "code": pending.code,
                    "whatsapp_url": pending.deeplink,
                });
                set_pending(&clean_key, &pending);
                Json(json!({
                    "status": true,
                    "type": "login",
                    "message": "Silakan buka tautan WhatsApp dan kirim pesan verifikasi tanpa mengubah teks. Setelah pesan terkirim (centang dua), panggil kembali endpoint ini untuk menyelesaikan login.",
                    "result": result,
                    "metadata": { "processing_time": dur() },
                }))
                .into_response()
            }
            Err(e) => {
                let status = if e.contains("429") { StatusCode::TOO_MANY_REQUESTS } else { StatusCode::BAD_GATEWAY };
                (status, Json(json!({
                    "status": false,
                    "message": e,
                    "metadata": { "processing_time": dur() },
                })))
                .into_response()
            }
        };
    }

    // profile / tags
    if is_protected_number(&normalized) {
        return (StatusCode::FORBIDDEN, Json(json!({
            "status": false,
            "code": "PROTECTED_NUMBER",
            "message": "Nomor ini dilindungi oleh privasi dan tidak dapat dicari.",
            "metadata": { "processing_time": dur() },
        })))
        .into_response();
    }

    match api_search_with_fallback(&normalized, &type_raw).await {
        Ok((name, body)) => {
            let profile = format_profile(dig(&body, "result.profile"));
            let tags = format_tags(dig(&body, "result.tags"));
            let quota = format_quota(
                dig(&body, "result.subscriptionInfo").if_null_then(dig(&body, "result.quota")),
            );
            Json(json!({
                "status": true,
                "query": { "phone": normalized, "type": type_raw },
                "account": mask_phone(&name),
                "result": { "profile": profile, "tags": tags, "quota": quota },
                "metadata": { "processing_time": dur() },
            }))
            .into_response()
        }
        Err(e) => {
            let not_found_re = regex::Regex::new(r"(?i)404.*No result found").unwrap();
            let quota_re = regex::Regex::new(r"(?i)maximum query limit|quota").unwrap();
            if e.contains("429") {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(json!({
                        "status": false,
                        "code": "RATE_LIMITED",
                        "message": "Terlalu banyak permintaan verifikasi ke VerifyKit. Harap tunggu beberapa menit (cooldown) sebelum mencoba request login baru.",
                        "metadata": { "processing_time": dur() },
                    })),
                )
                    .into_response();
            }
            if not_found_re.is_match(&e) {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({
                        "status": false,
                        "code": "NOT_FOUND",
                        "message": "Nomor tidak ditemukan di database GetContact (tidak ada data profil/tag tersimpan)",
                        "metadata": { "processing_time": dur() },
                    })),
                )
                    .into_response();
            }
            if quota_re.is_match(&e) {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(json!({
                        "status": false,
                        "code": "QUOTA_EXHAUSTED",
                        "message": "Kuota GetContact habis — coba type=profile atau tunggu reset kuota",
                        "metadata": { "processing_time": dur() },
                    })),
                )
                    .into_response();
            }
            let auth_re = regex::Regex::new(r"(?i)credential|Invalid phone|non-JSON").unwrap();
            let status = if auth_re.is_match(&e) { StatusCode::SERVICE_UNAVAILABLE } else { StatusCode::BAD_GATEWAY };
            (status, Json(json!({
                "status": false,
                "message": e,
                "metadata": { "processing_time": dur() },
            })))
            .into_response()
        }
    }
}

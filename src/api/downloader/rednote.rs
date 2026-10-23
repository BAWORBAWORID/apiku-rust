// RedNote (Xiaohongshu) Downloader — native conversion of api/downloader/rednote.js
// Flow (dy.kukutool.com): POST /api/auth-970b03 → ticket (k/s) → build AES-256-GCM
// payload (key = sha256(authKey:authSeed), 12-byte IV) → POST /api/parse →
// decrypt response (scrambled base64 + AES-256-CBC key sha256(RESP_KEY)).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use sha2::{Digest, Sha256};
use cbc::cipher::{block_padding::NoPadding, BlockModeDecrypt, KeyIvInit};
use aes_gcm::{aead::{Aead, AeadMutInPlace, KeyInit}, Aes256Gcm, Key, Nonce};
use base64::Engine as _;
use reqwest::header;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const BASE: &str = "https://dy.kukutool.com";
const PAGE: &str = "/rednote-downloader";
const RESP_KEY: &str = "12345678901234567890123456789013";
const B64_FROM: &[u8] = b"ZYXABCDEFGHIJKLMNOPQRSTUVWzyxabcdefghijklmnopqrstuvw9876543210-_";
const B64_TO: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static CACHED_SID: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn load_sid() -> String {
    CACHED_SID.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default()
}

fn save_sid(sid: &str) {
    if !sid.is_empty() {
        *CACHED_SID.lock().unwrap_or_else(|e| e.into_inner()) = Some(sid.to_string());
    }
}

fn map_b64(s: &str) -> String {
    s.bytes()
        .map(|c| match B64_FROM.iter().position(|t| *t == c) {
            Some(i) => B64_TO[i] as char,
            None => c as char,
        })
        .collect()
}

fn rev_blocks(s: &str, size: usize) -> String {
    s.as_bytes()
        .chunks(size)
        .flat_map(|c| c.iter().rev())
        .map(|b| *b as char)
        .collect()
}

fn xor_each(s: &str, n: u8) -> String {
    s.chars().map(|c| char::from_u32((c as u32) ^ n as u32).unwrap_or(c)).collect()
}

fn decrypt_response(data: &str, iv: &str) -> Option<Value> {
    let mut d = xor_each(data, 90);
    let mut p = xor_each(iv, 90);
    d = rev_blocks(&d, 8);
    p = rev_blocks(&p, 8);
    d = map_b64(&d);
    p = map_b64(&p);

    let key: [u8; 32] = Sha256::digest(RESP_KEY).into();
    let ivb = base64::engine::general_purpose::STANDARD.decode(p).ok()?;
    let ctb = base64::engine::general_purpose::STANDARD.decode(d).ok()?;

    type Dec = cbc::Decryptor<aes::Aes256>;
    let mut buf = ctb.clone();
    let dec = match Dec::new_from_slices(&key[..32], &ivb[..16]) { Ok(d) => d, Err(_) => return None };
    let pt = dec.decrypt_padded::<NoPadding>(&mut buf).ok()?;
    String::from_utf8(pt.to_vec()).ok().and_then(|s| serde_json::from_str(&s).ok())
}

fn build_payload(plaintext: &str, auth_key: &str, auth_seed: &str) -> Result<(String, String), String> {
    let key_bytes: [u8; 32] = Sha256::digest(format!("{auth_key}:{auth_seed}")).into();
    let mut iv = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut iv);
    let mut cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let mut buf = plaintext.as_bytes().to_vec();
    let mut tag = [0u8; 16];
    cipher
        .encrypt_in_place(Nonce::from_slice(&iv), &[], &mut buf)
        .map_err(|_| "encrypt failed".to_string())?;
    // NOTE: AeadMutInPlace puts tag at end of buf already; but we use detached via separate call:
    // simpler: use attached encryption instead.
    let _ = &mut tag;
    // Re-do with attached API to get ct||tag:
    let mut cipher2 = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let ct = cipher2
        .encrypt(Nonce::from_slice(&iv), plaintext.as_bytes())
        .map_err(|_| "encrypt failed".to_string())?;
    Ok((
        base64::engine::general_purpose::STANDARD.encode(ct),
        base64::engine::general_purpose::STANDARD.encode(iv),
    ))
}

fn headers(cookie: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    h.insert("Content-Type", mk("application/json"));
    h.insert("User-Agent", mk(UA));
    h.insert("Origin", mk(BASE));
    h.insert("Referer", mk(&format!("{BASE}{PAGE}")));
    h.insert("Accept", mk("*/*"));
    if !cookie.is_empty() {
        h.insert("Cookie", mk(cookie));
    }
    h
}

async fn get_auth_ticket(client: &reqwest::Client, raw_input: &str) -> Result<(String, String, String), String> {
    let sid = load_sid();
    let cookie = if sid.is_empty() { "NEXT_LOCALE=en".to_string() } else { format!("NEXT_LOCALE=en; {sid}") };
    let resp = client
        .post(format!("{BASE}/api/auth-970b03"))
        .headers(headers(&cookie))
        .json(&json!({ "requestURL": raw_input, "pagePath": PAGE, "mode": "single" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // capture parse_sid cookie
    let fresh: Option<String> = resp
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|c| c.split(';').next().unwrap_or("").to_string())
        .find(|c| c.starts_with("parse_sid="));
    if let Some(f) = &fresh {
        save_sid(f);
    }

    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let k = data.get("k_970b03").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let s = data.get("s_970b03").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if k.is_empty() || s.is_empty() {
        return Err(format!("auth ticket kosong: {}", data.to_string().chars().take(200).collect::<String>()));
    }
    Ok((k, s, fresh.or_else(|| if sid.is_empty() { None } else { Some(sid) }).unwrap_or_default()))
}

async fn parse_with_ticket(client: &reqwest::Client, raw_input: &str, auth_key: &str, auth_seed: &str, parse_sid: &str) -> Result<Value, String> {
    let plaintext = json!({
        "requestURL": raw_input,
        "captchaKey": "",
        "captchaInput": "",
        "totalSuccessCount": "0",
        "successCount": "0",
        "firstSuccessDate": "",
        "pagePath": PAGE,
        "isMobile": "false",
        "geoipIp": "",
        "confirmPurchased": false,
        "country_code": Value::Null
    })
    .to_string();
    let (payload, iv) = build_payload(&plaintext, auth_key, auth_seed)?;
    let cookie = format!("NEXT_LOCALE=en{}", if parse_sid.is_empty() { String::new() } else { format!("; {parse_sid}") });
    let resp = client
        .post(format!("{BASE}/api/parse"))
        .headers(headers(&cookie))
        .json(&json!({
            "version": 3,
            "k_970b03": auth_key,
            "p_970b03": payload,
            "r_970b03": 1,
            "i_970b03": iv
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}

async fn attempt(client: &reqwest::Client, raw_input: &str) -> Result<Value, (u16, String)> {
    let (k, s, sid) = get_auth_ticket(client, raw_input).await.map_err(|e| (500u16, e))?;
    let res = parse_with_ticket(client, raw_input, &k, &s, &sid).await.map_err(|e| (500u16, e))?;
    let status = res.get("status").and_then(|s| s.as_i64()).unwrap_or(200);
    let data = if res.get("encrypt").and_then(|v| v.as_bool()).unwrap_or(false) {
        let d = res.get("data").and_then(|v| v.as_str()).unwrap_or("");
        let iv = res.get("iv").and_then(|v| v.as_str()).unwrap_or("");
        decrypt_response(d, iv).unwrap_or(Value::Null)
    } else {
        res.clone()
    };
    if status != 0 || data.is_null() {
        let msg = res.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
        return Err((status as u16, msg));
    }

    let mut links: Vec<Value> = Vec::new();
    let typ = data.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if typ == "video" {
        let vids: Vec<Value> = data
            .pointer("/videos/0/video_fullinfo")
            .and_then(|v| v.as_array())
            .filter(|a| !a.is_empty())
            .cloned()
            .or_else(|| {
                Some(vec![json!({
                    "url": data.get("url").cloned().or_else(|| data.pointer("/videos/0/url").cloned()).unwrap_or(Value::Null)
                })])
            })
            .unwrap_or_default();
        for v in vids {
            let url = v.get("url").and_then(|u| u.as_str()).unwrap_or("");
            if url.is_empty() {
                continue;
            }
            links.push(json!({
                "type": "video",
                "quality": v.get("type").cloned().unwrap_or(json!("HD")),
                "size": v.get("size").cloned().unwrap_or(json!(0)),
                "url": url
            }));
        }
    } else {
        for p in data.get("pics").and_then(|p| p.as_array()).cloned().unwrap_or_default() {
            links.push(json!({ "type": "picture", "quality": "HD", "size": 0, "url": p }));
        }
    }
    if links.is_empty() {
        return Err((200u16, "Media link kosong atau tidak ditemukan".into()));
    }
    Ok(json!({
        "title": data.get("title").cloned().unwrap_or(json!("")),
        "type": data.get("type").cloned().unwrap_or(json!("")),
        "cover": data.get("cover").cloned().unwrap_or(json!("")),
        "links": links
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    // extract first http(s) URL
    let clean_url: String = {
        let bytes = url.as_bytes();
        let mut start = None;
        for (i, w) in bytes.windows(7).enumerate() {
            if &url[i..i + 7] == "http://" || (i + 8 <= url.len() && &url[i..i + 8] == "https://") {
                start = Some(i);
                break;
            }
        }
        match start {
            Some(i) => {
                let rest = &url[i..];
                let end = rest.find(|c: char| c.is_whitespace()).unwrap_or(rest.len());
                rest[..end].to_string()
            }
            None => url.trim().to_string(),
        }
    };
    if !clean_url.starts_with("http") {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "URL tidak valid", "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let mut last_err: Option<(u16, String)> = None;
    for n in 1..=2u32 {
        match attempt(&client, &clean_url).await {
            Ok(result) => {
                return Json(json!({
                    "status": true, "result": result,
                    "timestamp": chrono::Utc::now().timestamp_millis()
                }))
                .into_response()
            }
            Err(e) => {
                last_err = Some(e);
                if n == 1 {
                    *CACHED_SID.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                }
            }
        }
    }

    let (code, msg) = last_err.unwrap_or((500, "Gagal mengurai media RedNote".into()));
    let sc = if msg.contains("not found") || msg.contains("tidak ditemukan") || msg.contains("失效") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    };
    (sc, Json(json!({
        "status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()
    })))
    .into_response()
}

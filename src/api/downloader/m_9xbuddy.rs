// 9xBuddy Downloader — native conversion of api/downloader/9xbuddy.js
// Flow: fetch site HTML → __INIT__ config (apiBase/ua/appVersion) + css hash →
// fingerprint (xorEncrypt) → POST token → POST extract dengan _sig →
// decrypt hex-URL (reverse + xorDecrypt with cssHash+token key).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use base64::Engine as _;

const SITE: &str = "https://9xbuddy.site";
const SIG_SALT: &str = "jv7g2_DAMNN_DUDE";
const SECRET: &str = "SORRY_MATE_IM_NOT_GONNA_TELL_YOU";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

static CONFIG: std::sync::Mutex<Option<Value>> = std::sync::Mutex::new(None);

// ordAt for surrogate pairs — Rust chars are already code points, so byte-indexed
// iteration differs; JS uses UTF-16. We iterate over chars() for simplicity.
fn xor_encrypt(plain: &str, key: &str) -> String {
    let key_chars: Vec<char> = key.chars().collect();
    let kc = |i: usize| -> u32 { key_chars[(i + key_chars.len() - 1) % key_chars.len()] as u32 };
    let mut out = String::new();
    for (r, pc) in plain.chars().enumerate() {
        let v = pc as u32 + kc(r);
        // JS charCodeAt addition may exceed BMP producing invalid char; mimic with as u16 wrap
        let ch = char::from_u32(v & 0xFFFF).unwrap_or('\u{FFFD}');
        out.push(ch);
    }
    // encode64 (latin-1 style) — chars are <= 0xFF-adjacent; encode their code points as bytes
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = out.chars().map(|c| (c as u32 & 0xFF) as u8).collect();
    let mut o = String::new();
    let mut n = 0usize;
    let mut i: u32 = 0;
    let mut a = 0usize;
    while n < bytes.len() {
        let r = bytes[n] as u32;
        a = n % 3;
        if a == 0 {
            o.push(T[(r >> 2) as usize] as char);
        } else if a == 1 {
            o.push(T[(((i & 3) << 4) | (r >> 4)) as usize] as char);
        } else {
            o.push(T[(((i & 15) << 2) | (r >> 6)) as usize] as char);
            o.push(T[(r & 63) as usize] as char);
        }
        i = r;
        n += 1;
    }
    if a == 0 {
        o.push(T[((i & 3) << 4) as usize] as char);
        o.push_str("==");
    } else if a == 1 {
        o.push(T[((i & 15) << 2) as usize] as char);
        o.push('=');
    }
    o
}

fn xor_decrypt_b64(b64: &str, key: &str) -> String {
    let raw = base64::engine::general_purpose::STANDARD.decode(b64).unwrap_or_default();
    let key_chars: Vec<char> = key.chars().collect();
    let kc = |i: usize| -> u32 { key_chars[(i + key_chars.len() - 1) % key_chars.len()] as u32 };
    raw.iter()
        .enumerate()
        .map(|(r, b)| char::from_u32((*b as u32).wrapping_sub(kc(r)) & 0xFFFF).unwrap_or('\u{FFFD}'))
        .collect()
}

fn pick_config_value(init: &str, key: &str) -> String {
    // "key":"value" with escapes
    let pat = format!("\"{key}\":");
    match init.find(&pat) {
        Some(i) => {
            let seg = &init[i + pat.len()..];
            let seg = seg.trim_start();
            if let Some(stripped) = seg.strip_prefix('"') {
                // parse escaped JSON string
                let mut out = String::new();
                let mut chars = stripped.chars();
                while let Some(c) = chars.next() {
                    if c == '"' {
                        break;
                    }
                    if c == '\\' {
                        if let Some(n) = chars.next() {
                            match n {
                                'n' => out.push('\n'),
                                't' => out.push('\t'),
                                other => out.push(other),
                            }
                        }
                    } else {
                        out.push(c);
                    }
                }
                out
            } else {
                String::new()
            }
        }
        None => String::new(),
    }
}

async fn fetch_config(client: &reqwest::Client) -> Result<Value, String> {
    let resp = client
        .get(SITE)
        .header("User-Agent", UA)
                    .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} fetching {SITE}", resp.status().as_u16()));
    }
    let html = resp.text().await.unwrap_or_default();

    let init_m = html.find("__INIT__").and_then(|i| {
        let seg = &html[i..];
        let ob = seg.find('{')?;
        // find balanced JSON object
        let bytes = seg.as_bytes();
        let mut depth = 0i32;
        let mut end = ob;
        for (i, &c) in bytes.iter().enumerate().skip(ob) {
            match c {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 { end = i + 1; break; }
                }
                _ => {}
            }
        }
        if depth != 0 { return None; }
        Some(seg[ob..end].to_string())
    }).ok_or_else(|| "__INIT__ / css hash tidak ditemukan di HTML".to_string())?;
    let init_json: &str = &init_m;

    let css_hash = html.find("/build/").and_then(|i| {
        let seg = &html[i..];
        let m = seg.find("main.")?;
        let after = &seg[m + 5..];
        let dot = after.find('.')?;
        Some(after[..dot].to_string())
    }).ok_or_else(|| "__INIT__ / css hash tidak ditemukan di HTML".to_string())?;

    let api_base = pick_config_value(init_json, "apiBase");
    let ua_cfg = pick_config_value(init_json, "ua");
    let app_version = pick_config_value(init_json, "appVersion");
    if api_base.is_empty() || ua_cfg.is_empty() || app_version.is_empty() {
        return Err("config tidak lengkap (apiBase/ua/appVersion)".into());
    }

    let rev = |s: &str| s.chars().rev().collect::<String>();
    let key = rev(&css_hash);
    let ua_rev10: String = rev(&ua_cfg).chars().take(10).collect();
    let c = format!("xbuddy123sudo-{app_version}");
    let raw = format!("9xbuddy.site{key}{ua_rev10}{SECRET}{c}{app_version}");
    let fingerprint = xor_encrypt(&raw, &key);

    Ok(json!({
        "apiBase": api_base, "ua": ua_cfg, "appVersion": app_version,
        "cssHash": css_hash, "fingerprint": fingerprint
    }))
}

async fn get_config(client: &reqwest::Client) -> Result<Value, String> {
    {
        let guard = CONFIG.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            return Ok(c.clone());
        }
    }
    let c = fetch_config(client).await?;
    *CONFIG.lock().unwrap_or_else(|e| e.into_inner()) = Some(c.clone());
    Ok(c)
}

async fn api_post(client: &reqwest::Client, cfg: &Value, endpoint: &str, payload: Value, access_token: Option<&str>) -> Result<(u16, Value), String> {
    let api_base = cfg.get("apiBase").and_then(|a| a.as_str()).unwrap_or("");
    let fp = cfg.get("fingerprint").and_then(|a| a.as_str()).unwrap_or("");
    let mut req = client
        .post(format!("{api_base}/{endpoint}"))
        .header("x-auth-token", fp)
                    .header("x-requested-domain", "9xbuddy.site")
                    .header("Content-Type", "application/json; charset=UTF-8")
                    .header("X-Requested-With", "xmlhttprequest")
        .header("Origin", SITE)
        .header("Referer", format!("{SITE}/"))
        .header("User-Agent", UA)
        .json(&payload);
    if let Some(t) = access_token {
        req = req.header("x-access-token", t);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let data: Value = resp.json().await.unwrap_or(Value::Null);
    Ok((status, data))
}

fn decrypt_url(field: &Value, token: &str, css_hash: &str) -> Value {
    let field = match field.as_str() {
        Some(f) if !f.is_empty() => f,
        _ => return Value::Null,
    };
    let is_hex = !field.is_empty() && field.len() % 2 == 0 && field.chars().all(|c| c.is_ascii_hexdigit());
    if !is_hex || token.is_empty() {
        return json!(field);
    }
    let bin = match hex::decode(field) {
        Ok(b) => b,
        Err(_) => return json!(field),
    };
    let reversed: Vec<u8> = bin.iter().rev().copied().collect();
    // key = "SORRY_MATE" + "9xbuddy.site".len() + cssHash + token
    let key = format!("SORRY_MATE{}{css_hash}{token}", "9xbuddy.site".len());
    let url = xor_decrypt_b64(&base64::engine::general_purpose::STANDARD.encode(reversed), &key);
    if !url.chars().all(|c| c.is_ascii_graphic() || c == ' ') || url.is_empty() {
        return json!(field);
    }
    if url.starts_with("//") {
        return json!(format!("https:{url}"));
    }
    json!(url)
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
    let trimmed = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();
    if trimmed.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response();
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL tidak valid, harus diawali http:// atau https://"
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

    let result = async {
        let mut cfg = get_config(&client).await.map_err(|e| e.to_string())?;

        let tok = api_post(&client, &cfg, "token", json!({}), None).await?;
        let mut access_token = tok.1.get("data").and_then(|d| d.get("access_token")).and_then(|a| a.as_str()).unwrap_or("").to_string();
        if access_token.is_empty() {
            return Err(format!("Token gagal: HTTP {}", tok.0));
        }

        let enc_url = urlencoding::encode(&trimmed).to_string();
        let fp = cfg.get("fingerprint").and_then(|f| f.as_str()).unwrap_or("").to_string();
        let sig = xor_encrypt(&enc_url, &format!("{fp}{SIG_SALT}"));
        let body = json!({ "url": enc_url, "_sig": sig });
        let mut out = api_post(&client, &cfg, "extract", body.clone(), Some(&access_token)).await?;

        let msg = out.1.get("message").and_then(|m| m.as_str()).unwrap_or("");
        if out.0 == 403 || msg.to_lowercase().contains("invalid") || msg.to_uppercase().contains("BLOCKED") {
            cfg = fetch_config(&client).await.map_err(|e| e.to_string())?;
            let tok2 = api_post(&client, &cfg, "token", json!({}), None).await?;
            access_token = tok2.1.get("data").and_then(|d| d.get("access_token")).and_then(|a| a.as_str()).unwrap_or("").to_string();
            if access_token.is_empty() {
                return Err(format!("Token retry gagal: HTTP {}", tok2.0));
            }
            let fp2 = cfg.get("fingerprint").and_then(|f| f.as_str()).unwrap_or("").to_string();
            let sig2 = xor_encrypt(&enc_url, &format!("{fp2}{SIG_SALT}"));
            out = api_post(&client, &cfg, "extract", json!({ "url": enc_url, "_sig": sig2 }), Some(&access_token)).await?;
        }

        let raw = out.1.clone();
        let status_str = raw.get("status").map(|s| s.to_string()).unwrap_or_default();
        if status_str != "1" || raw.get("response").map(|r| r.is_null()).unwrap_or(true) {
            return Err(format!("Extract gagal: HTTP {} — {}", out.0, raw.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error")));
        }
        let data = raw.get("response").cloned().unwrap_or(Value::Null);
        let token = data.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string();
        let css_hash = cfg.get("cssHash").and_then(|c| c.as_str()).unwrap_or("").to_string();

        let medias: Vec<Value> = data
            .get("formats")
            .and_then(|f| f.as_array())
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|m| json!({
                "quality": m.get("quality"),
                "type": m.get("type").cloned().unwrap_or(Value::Null),
                "ext": m.get("ext").cloned().unwrap_or(Value::Null),
                "size": m.get("size").cloned().unwrap_or(Value::Null),
                "url": decrypt_url(m.get("url").unwrap_or(&Value::Null), &token, &css_hash)
            }))
            .collect();

        let thumbnail = data.get("thumbnail").and_then(|t| t.as_str()).map(|t| {
            if t.starts_with("//") { format!("https:{t}") } else { t.to_string() }
        });

        Ok(json!({
            "title": data.get("title").cloned().unwrap_or(Value::Null),
            "thumbnail": thumbnail,
            "uploader": data.get("uploader").cloned().unwrap_or(Value::Null),
            "duration": data.get("duration").cloned().unwrap_or(Value::Null),
            "type": data.get("type").cloned().unwrap_or(Value::Null),
            "source": "9xbuddy",
            "total": medias.len(),
            "medias": medias
        }))
    }
    .await;

    match result {
        Ok(result) => Json(json!({ "status": true, "result": result })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e }))).into_response(),
    }
}

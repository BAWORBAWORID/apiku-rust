// TikTok Downloader v3 — native conversion of api/downloader/tiktokv3.js
// Provider: snaptik.app challenge API:
//  1. POST /api/token -> {id, p}
//  2. AES-256-CBC decrypt p (key = SHA256("sn4pt1k_v3r1fy2026:"+id), IV = first 16B)
//  3. Solve math challenge -> token = id:answer:_e:_h (header X-Verify)
//  4. GET /api/extract?url=... (retry once on 403)
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use cbc::cipher::{block_padding::Pkcs7, BlockModeDecrypt, KeyIvInit};
use base64::Engine as _;

const BASE: &str = "https://snaptik.app";
const PAGE: &str = "https://snaptik.app/en3";
const SECRET: &str = "sn4pt1k_v3r1fy2026";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

fn decrypt_payload(id: &str, payload_b64: &str) -> Result<Value, String> {
    let buf = base64::engine::general_purpose::STANDARD
        .decode(payload_b64)
        .map_err(|e| format!("base64: {e}"))?;
    if buf.len() < 17 {
        return Err("payload too short".into());
    }
    let (iv, ct) = buf.split_at(16);
    let key = Sha256::digest(format!("{SECRET}:{id}").as_bytes()).to_vec();
    let dec = Aes256CbcDec::new_from_slices(&key[..32], iv).map_err(|e| format!("init: {e}"))?;
    let mut out = vec![0u8; ct.len()];
    let pt = dec
        .decrypt_padded_b2b::<Pkcs7>(ct, &mut out)
        .map_err(|e| format!("decrypt: {e}"))?
        .to_vec();
    serde_json::from_slice(&pt).map_err(|e| format!("json: {e}"))
}

fn solve_challenge(a: &Value) -> Result<i64, String> {
    let t = a.get("t").and_then(|v| v.as_str()).ok_or("missing t")?;
    let num = |k: &str| a.get(k).and_then(|v| v.as_f64()).ok_or(format!("missing {k}"));
    match t {
        "b" => {
            let x = num("a")? as i64;
            let y = num("b")? as i64;
            let s = num("s")? as i64;
            Ok(((x ^ y) >> s) & 255)
        }
        "r" => {
            let arr = a.get("n").and_then(|v| v.as_array()).ok_or("missing n")?;
            let sum: f64 = arr.iter().filter_map(|v| v.as_f64()).sum();
            Ok((sum as i64) * 2 + 1)
        }
        "c" => {
            let w = a.get("w").and_then(|v| v.as_str()).ok_or("missing w")?;
            let i = num("i")? as usize;
            let m = num("m")?;
            let ch = w.chars().nth(i).ok_or("char index out of range")?;
            Ok((ch as u32 as i64) * (m as i64))
        }
        "m" => {
            let res = ((num("a")? + num("b")?) % 100.0) * num("c")?;
            Ok(res as i64)
        }
        "n" => {
            let (a1, b1, c1) = (num("a")?, num("b")?, num("c")?);
            Ok((a1 * b1 + b1 * c1 + c1 * a1 - a1) as i64)
        }
        other => Err(format!("Unknown challenge type: {other}")),
    }
}

async fn get_verify_token(client: &reqwest::Client, cookie: &str) -> Result<String, String> {
    let mut req = client
        .post(format!("{BASE}/api/token"))
                    .header("X-Requested-With", "XMLHttpRequest")
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json, text/plain, */*")
        .header("Referer", PAGE);
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    let tok: Value = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let id = tok.get("id").and_then(|v| v.as_str()).ok_or("token: missing id")?;
    let p = tok.get("p").and_then(|v| v.as_str()).ok_or("token: missing p")?;
    let a = decrypt_payload(id, p)?;
    let answer = solve_challenge(&a)?;
    let e = a.get("_e").and_then(|v| v.as_str()).unwrap_or("");
    let h = a.get("_h").and_then(|v| v.as_str()).unwrap_or("");
    Ok(format!("{id}:{answer}:{e}:{h}"))
}

async fn ask(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let home = client
        .get(PAGE)
        .header("User-Agent", UA)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let cookie = home
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("; ");

    let mut data: Option<Value> = None;
    let mut last_err = String::new();
    for _attempt in 0..2 {
        match get_verify_token(client, &cookie).await {
            Ok(verify) => {
                let res = client
                    .get(format!("{BASE}/api/extract?url={}", urlencoding::encode(url)))
                                .header("X-Requested-With", "XMLHttpRequest")
                    .header("X-Verify", verify)
                                .header("Accept", "application/json, text/plain, */*")
                    .header("Referer", PAGE)
                    .header("Cookie", &cookie)
                    .send()
                    .await;
                match res {
                    Ok(r) if r.status().as_u16() == 403 => {
                        last_err = "Challenge rejected (HTTP 403)".into();
                        continue;
                    }
                    Ok(r) => match r.json::<Value>().await {
                        Ok(j) => {
                            data = Some(j.get("data").cloned().unwrap_or(j));
                            break;
                        }
                        Err(e) => last_err = e.to_string(),
                    },
                    Err(e) => last_err = e.to_string(),
                }
            }
            Err(e) => last_err = e,
        }
    }

    data.ok_or_else(|| if last_err.is_empty() { "Gagal mendapatkan data TikTok".to_string() } else { last_err })
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

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendownload TikTok: {e}")
        }))).into_response(),
    };

    match ask(&client, &url).await {
        Ok(data) => Json(json!({
            "status": true,
            "input": url,
            "result": data
        }))
        .into_response(),
        Err(msg) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg
        }))).into_response(),
    }
}

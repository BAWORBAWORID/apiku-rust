// MEGA.NZ Downloader — native conversion of api/downloader/meganz.js
// Flow: g.api.mega.co.nz/cs [{a:'g',g:1,p:fileId}] → decrypt attributes with
// file key (16-byte AES key = first-half XOR second-half of key material),
// AES-128-CBC zero-IV, no padding; attr JSON skips 4-byte prefix.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use cbc::cipher::{BlockModeDecrypt, KeyIvInit};
use base64::Engine as _;
type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(s))
        .ok()
}

fn decrypt_attr(enc: &str, file_key: &str) -> Value {
    let k_result = match b64url_decode(file_key) {
        Some(k) => k,
        None => return json!({ "n": "[Decryption Error]" }),
    };
    if k_result.len() < 32 {
        return json!({ "n": "[Decryption Error]" });
    }
    // 8 big-endian u32 words
    let words: Vec<u32> = (0..8)
        .map(|i| u32::from_be_bytes([k_result[i * 4], k_result[i * 4 + 1], k_result[i * 4 + 2], k_result[i * 4 + 3]]))
        .collect();
    // AES key = first 4 words XOR last 4 words
    let mut key = [0u8; 16];
    for i in 0..4 {
        let x = words[i] ^ words[i + 4];
        key[i * 4..i * 4 + 4].copy_from_slice(&x.to_be_bytes());
    }

    let ct = match b64url_decode(enc) {
        Some(c) => c,
        None => return json!({ "n": "[Decryption Error]" }),
    };

    let iv = [0u8; 16];
    let dec = match Aes128CbcDec::new_from_slices(&key, &iv) { Ok(d) => d, Err(_) => return json!({ "n": "[Decryption Error]" }) };
    let mut buf = ct.clone();
    if buf.len() % 16 != 0 {
        buf.resize((buf.len() / 16 + 1) * 16, 0);
    }
    let pt = dec.decrypt_padded::<cbc::cipher::block_padding::NoPadding>(&mut buf).ok();
    let text = pt
        .and_then(|p| String::from_utf8(p.to_vec()).ok())
        .map(|s| s.trim_end_matches('\0').trim().to_string())
        .unwrap_or_default();
    if text.len() > 4 {
        if let Ok(v) = serde_json::from_str::<Value>(&text[4..]) {
            return v;
        }
    }
    json!({ "n": "[Decryption Error]" })
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
    if !url.contains("mega.nz/file/") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "URL harus berupa link MEGA.NZ file (contoh: https://mega.nz/file/...)"
        }))).into_response();
    }
    if !url.contains('#') {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL MEGA harus mengandung key (bagian setelah #)"
        }))).into_response();
    }

    let file_id = url
        .find("file/")
        .and_then(|p| {
            let rest = &url[p + 5..];
            let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
            if id.is_empty() { None } else { Some(id) }
        });
    let file_key = url.split('#').nth(1).unwrap_or("").to_string();

    let file_id = match file_id {
        Some(f) if !file_key.is_empty() => f,
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "URL MEGA tidak valid. Pastikan URL mengandung #key"
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let sent = client
        .post("https://g.api.mega.co.nz/cs")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Content-Type", "application/json")
        .json(&json!([{ "a": "g", "g": 1, "p": file_id }]))
        .send()
        .await
        .map_err(|e| e.to_string());
    let resp = match sent {
        Ok(r) => r.json::<Value>().await.map_err(|e| e.to_string()),
        Err(e) => Err(e),
    };

    let data = match resp {
        Ok(d) => d,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e
        }))).into_response(),
    };

    if data.get(0).map(|v| v.is_i64() || v.is_u64()).unwrap_or(false) {
        let code = data.get(0).cloned().unwrap_or(Value::Null);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("MEGA API Error: {}", code)
        }))).into_response();
    }
    let info = match data.get(0) {
        Some(i) if i.is_object() => i.clone(),
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Respons MEGA API tidak valid"
        }))).into_response(),
    };

    let enc_attr = info.get("at").and_then(|a| a.as_str()).unwrap_or("");
    let attr = decrypt_attr(enc_attr, &file_key);

    let size = info.get("s").and_then(|s| s.as_u64()).unwrap_or(0);
    Json(json!({
        "status": true,
        "provider": "mega.nz",
        "input": url,
        "result": {
            "filename": attr.get("n").cloned().unwrap_or(json!("")),
            "size": size,
            "size_formatted": format!("{:.2} MB", size as f64 / (1024.0 * 1024.0)),
            "download_url": info.get("g").cloned().unwrap_or(Value::Null),
            "file_id": file_id,
            "attributes": attr
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()

}

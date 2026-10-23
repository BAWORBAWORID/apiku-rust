// Encrypt — native conversion of api/tools/encrypt.js (+ cipherTools: AES-256-GCM/CBC, 3DES)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;

fn text_to_binary(t: &str) -> String {
    t.chars()
        .map(|c| format!("{:08b} ", c as u32))
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn binary_to_text(b: &str) -> String {
    b.split(' ')
        .filter_map(|bin| u32::from_str_radix(bin, 2).ok())
        .map(|code| char::from_u32(code).unwrap_or('\u{FFFD}'))
        .collect()
}

fn text_to_base32(t: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = String::new();
    for c in t.chars() {
        bits.push_str(&format!("{:08b}", c as u32));
    }
    while bits.len() % 5 != 0 {
        bits.push('0');
    }
    let mut out = String::new();
    for chunk in bits.as_bytes().chunks(5) {
        let idx = usize::from_str_radix(std::str::from_utf8(chunk).unwrap(), 2).unwrap_or(0);
        out.push(CHARS[idx] as char);
    }
    while out.len() % 8 != 0 {
        out.push('=');
    }
    out
}

fn base32_to_text(b32: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let clean: String = b32.chars().filter(|c| *c != '=').collect();
    let mut bits = String::new();
    for c in clean.chars() {
        let idx = CHARS.iter().position(|&b| b as char == c).unwrap_or(0);
        bits.push_str(&format!("{:05b}", idx));
    }
    let mut out = String::new();
    for chunk in bits.as_bytes().chunks(8) {
        if chunk.len() == 8 {
            if let Ok(byte) = u32::from_str_radix(std::str::from_utf8(chunk).unwrap(), 2) {
                out.push(char::from_u32(byte).unwrap_or('\u{FFFD}'));
            }
        }
    }
    out
}

fn text_to_hex(t: &str) -> String {
    t.chars()
        .map(|c| format!("{:02x} ", c as u32))
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn hex_to_text(h: &str) -> String {
    h.split(' ')
        .filter_map(|x| u32::from_str_radix(x, 16).ok())
        .map(|code| char::from_u32(code).unwrap_or('\u{FFFD}'))
        .collect()
}

fn text_to_octal(t: &str) -> String {
    t.chars()
        .map(|c| format!("{:03o} ", c as u32))
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn octal_to_text(o: &str) -> String {
    o.split(' ')
        .filter_map(|x| u32::from_str_radix(x, 8).ok())
        .map(|code| char::from_u32(code).unwrap_or('\u{FFFD}'))
        .collect()
}

fn rot13(t: &str) -> String {
    t.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a' + 13) % 26) + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A' + 13) % 26) + b'A') as char,
            _ => c,
        })
        .collect()
}

fn atbash(t: &str) -> String {
    t.chars()
        .map(|c| match c {
            'a'..='z' => (b'z' - (c as u8 - b'a')) as char,
            'A'..='Z' => (b'Z' - (c as u8 - b'A')) as char,
            _ => c,
        })
        .collect()
}

// ---------- cipher tools (keyed) ----------

struct CipherSpec {
    key_bytes: usize,
    iv_bytes: usize,
    has_tag: bool,
}

fn cipher_spec(algo: &str) -> Option<CipherSpec> {
    match algo {
        "aes-256-gcm" => Some(CipherSpec {
            key_bytes: 32,
            iv_bytes: 12,
            has_tag: true,
        }),
        "aes-256-cbc" => Some(CipherSpec {
            key_bytes: 32,
            iv_bytes: 16,
            has_tag: false,
        }),
        "des-ede3" => Some(CipherSpec {
            key_bytes: 24,
            iv_bytes: 8,
            has_tag: false,
        }),
        _ => None,
    }
}

fn from_b64(value: &str) -> Vec<u8> {
    let cleaned: String = value
        .trim()
        .chars()
        .map(|c| {
            if c.is_whitespace() || c == '-' {
                '+'
            } else if c == '_' {
                '/'
            } else {
                c
            }
        })
        .collect();
    base64::engine::general_purpose::STANDARD
        .decode(cleaned.as_bytes())
        .unwrap_or_default()
}

fn cipher_encrypt(plaintext: &str, algo: &str) -> Result<Value, String> {
    use cbc::cipher::{block_padding::NoPadding, BlockModeDecrypt, BlockModeEncrypt, KeyIvInit};
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

    let spec = cipher_spec(algo).ok_or_else(|| format!("Algoritma '{}' tidak didukung", algo))?;
    let key = rand_bytes(spec.key_bytes);
    let iv = rand_bytes(spec.iv_bytes);

    let mut ciphertext = Vec::new();
    let mut tag: Option<String> = None;

    match algo {
        "aes-256-gcm" => {
            let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
            let ct = cipher
                .encrypt(Nonce::from_slice(&iv), plaintext.as_bytes())
                .map_err(|e| e.to_string())?;
            // last 16 bytes are the auth tag
            let (c, t) = ct.split_at(ct.len() - 16);
            ciphertext = c.to_vec();
            tag = Some(base64::engine::general_purpose::STANDARD.encode(t));
        }
        "aes-256-cbc" => {
            type Enc = cbc::Encryptor<aes::Aes256>;
            let mut buf = plaintext.as_bytes().to_vec();
            // PKCS7 padding
            let pad = 16 - (buf.len() % 16);
            buf.extend(std::iter::repeat(pad as u8).take(pad));
            let mut enc = Enc::new_from_slices(&key, &iv).map_err(|e| e.to_string())?;
            let blocks: Vec<&mut [u8]> = buf.chunks_mut(16).collect();
            for block in blocks {
                enc.encrypt_block(block.try_into().unwrap());
            }
            ciphertext = buf;
        }
        "des-ede3" => {
            return Err("Algoritma 'des-ede3' tidak didukung (crate des tidak tersedia)".to_string());
        }
        _ => return Err(format!("Algoritma '{}' tidak didukung", algo)),
    }

    Ok(json!({
        "algorithm": algo,
        "key": base64::engine::general_purpose::STANDARD.encode(&key),
        "iv": base64::engine::general_purpose::STANDARD.encode(&iv),
        "tag": tag,
        "ciphertext": base64::engine::general_purpose::STANDARD.encode(&ciphertext),
        "keyBytes": spec.key_bytes,
        "note": if spec.has_tag {
            "Tag tersedia — ciphertext terverifikasi, manipulasi akan terdeteksi."
        } else {
            "Tanpa authentication tag — ciphertext bisa dimodifikasi tanpa terdeteksi."
        },
    }))
}

fn rand_bytes(n: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

fn cipher_decrypt(
    ciphertext: &str,
    key: &str,
    iv: &str,
    tag: &str,
    algo: &str,
) -> Result<Value, String> {
    use aes::cipher::{BlockModeDecrypt, KeyIvInit};
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

    let spec = cipher_spec(algo).ok_or_else(|| format!("Algoritma '{}' tidak didukung", algo))?;
    if ciphertext.is_empty() {
        return Err("Parameter 'ciphertext' wajib diisi.".into());
    }
    if key.is_empty() {
        return Err("Parameter 'key' wajib diisi (dari result encrypt).".into());
    }
    if iv.is_empty() {
        return Err("Parameter 'iv' wajib diisi (dari result encrypt).".into());
    }
    if spec.has_tag && tag.is_empty() {
        return Err("Parameter 'tag' wajib diisi untuk aes-256-gcm.".into());
    }

    let key_buf = from_b64(key);
    if key_buf.len() != spec.key_bytes {
        return Err(format!(
            "Panjang kunci tidak cocok untuk {}: butuh {} byte, diterima {}.",
            algo,
            spec.key_bytes,
            key_buf.len()
        ));
    }
    let iv_buf = from_b64(iv);
    let ct = from_b64(ciphertext);

    let plain = match algo {
        "aes-256-gcm" => {
            let cipher = Aes256Gcm::new_from_slice(&key_buf).map_err(|e| e.to_string())?;
            let mut full = ct.clone();
            full.extend_from_slice(&from_b64(tag));
            cipher
                .decrypt(Nonce::from_slice(&iv_buf), full.as_ref())
                .map_err(|_| "Dekripsi gagal: kunci/iv/tag salah, atau ciphertext sudah dimanipulasi (auth tag tidak cocok).".to_string())?
        }
        "aes-256-cbc" => {
            type Dec = cbc::Decryptor<aes::Aes256>;
            let mut buf = ct.clone();
            let mut dec = Dec::new_from_slices(&key_buf, &iv_buf).map_err(|e| e.to_string())?;
            for block in buf.chunks_mut(16) {
                dec.decrypt_block(block.try_into().unwrap());
            }
            strip_pkcs7(&buf).ok_or_else(|| "Dekripsi gagal: kunci atau iv salah.".to_string())?
        }
        "des-ede3" => {
            return Err("Algoritma 'des-ede3' tidak didukung (crate des tidak tersedia)".to_string());
        }
        _ => return Err(format!("Algoritma '{}' tidak didukung", algo)),
    };

    Ok(json!({
        "algorithm": algo,
        "text": String::from_utf8_lossy(&plain),
        "verified": if spec.has_tag { Value::Bool(true) } else { Value::Null },
    }))
}

fn strip_pkcs7(buf: &[u8]) -> Option<Vec<u8>> {
    if buf.is_empty() {
        return None;
    }
    let pad = *buf.last().unwrap() as usize;
    if pad == 0 || pad > buf.len() || pad > 16 {
        return None;
    }
    if buf[buf.len() - pad..].iter().all(|&b| b as usize == pad) {
        Some(buf[..buf.len() - pad].to_vec())
    } else {
        None
    }
}

const LIGHT_METHODS: &[&str] = &[
    "base64", "base32", "binary", "hex", "octal", "rot13", "atbash",
];

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

    let text = get("text");
    let mode = get("mode").unwrap_or_else(|| "encrypt".to_string());
    let method = get("method").unwrap_or_else(|| "base64".to_string());
    let key = get("key");
    let iv = get("iv");
    let tag = get("tag");
    let ciphertext = get("ciphertext");

    if cipher_spec(&method).is_some() {
        if mode == "decrypt" {
            return match cipher_decrypt(
                ciphertext.as_deref().unwrap_or(""),
                key.as_deref().unwrap_or(""),
                iv.as_deref().unwrap_or(""),
                tag.as_deref().unwrap_or(""),
                &method,
            ) {
                Ok(out) => {
                    Json(json!({"status": true, "mode": mode, "method": method, "result": out}))
                        .into_response()
                }
                Err(e) => Json(json!({"status": false, "error": e})).into_response(),
            };
        }

        let text_val = match text.as_deref() {
            Some(t) if !t.is_empty() => t,
            _ => {
                return Json(json!({
                    "status": false,
                    "error": "Parameter 'text' wajib diisi untuk mode=encrypt."
                }))
                .into_response()
            }
        };

        return match cipher_encrypt(text_val, &method) {
            Ok(out) => Json(json!({"status": true, "mode": mode, "method": method, "result": out}))
                .into_response(),
            Err(e) => Json(json!({"status": false, "error": e})).into_response(),
        };
    }

    let text_val = match text.as_deref() {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Json(json!({"status": false, "error": "Parameter 'text' is required"}))
                .into_response()
        }
    };

    if !LIGHT_METHODS.contains(&method.as_str()) {
        return Json(json!({
            "status": false,
            "error": format!("Method '{}' not found. Available: {}", method, LIGHT_METHODS.join(", "))
        }))
        .into_response();
    }

    if mode != "encrypt" && mode != "decrypt" {
        return Json(json!({"status": false, "error": "Mode must be 'encrypt' or 'decrypt'"}))
            .into_response();
    }

    if mode == "decrypt" && (key.is_some() || iv.is_some() || ciphertext.is_some()) {
        return Json(json!({
            "status": false,
            "error": "Parameter 'key'/'iv'/'ciphertext' hanya dipakai untuk mode=decrypt dengan method aes-256-gcm, aes-256-cbc, atau des-ede3."
        }))
        .into_response();
    }

    let output = match (method.as_str(), mode.as_str()) {
        ("base64", "encrypt") => {
            base64::engine::general_purpose::STANDARD.encode(text_val.as_bytes())
        }
        ("base64", "decrypt") => String::from_utf8_lossy(&from_b64(text_val)).to_string(),
        ("base32", "encrypt") => text_to_base32(text_val),
        ("base32", "decrypt") => base32_to_text(text_val),
        ("binary", "encrypt") => text_to_binary(text_val),
        ("binary", "decrypt") => binary_to_text(text_val),
        ("hex", "encrypt") => text_to_hex(text_val),
        ("hex", "decrypt") => hex_to_text(text_val),
        ("octal", "encrypt") => text_to_octal(text_val),
        ("octal", "decrypt") => octal_to_text(text_val),
        ("rot13", _) => rot13(text_val),
        ("atbash", _) => atbash(text_val),
        _ => unreachable!(),
    };

    Json(json!({
        "status": true,
        "success": true,
        "input": text_val,
        "mode": mode,
        "method": method,
        "output": output,
        "length": { "input": text_val.chars().count(), "output": output.chars().count() },
    })).into_response()

}

use base64::Engine as _;
// Altcha proof-of-work solver — converted from api/solve/altcha.js
// Brute-forces salt+n against the challenge hash (SHA-1/256/384/512).
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha384, Sha512};
use std::collections::HashMap;

use crate::state::AppState;
use super::common::{err, merged_params, ok};

#[derive(Debug, Default, Deserialize)]
pub struct AltchaParams {
    pub challengeurl: Option<String>,
    pub max: Option<u64>,
    pub start: Option<u64>,
    pub timeout: Option<u64>,
}

trait DynHasher {
    fn update(&mut self, data: &[u8]);
    fn finalize_hex(self: Box<Self>) -> String;
}

macro_rules! impl_hasher {
    ($t:ty) => {
        impl DynHasher for $t {
            fn update(&mut self, data: &[u8]) {
                Digest::update(self, data);
            }
            fn finalize_hex(self: Box<Self>) -> String {
                hex::encode(Digest::finalize(*self))
            }
        }
    };
}
impl_hasher!(Sha1);
impl_hasher!(Sha256);
impl_hasher!(Sha384);
impl_hasher!(Sha512);

fn hasher_for(algorithm: &str) -> Option<Box<dyn DynHasher>> {
    match algorithm.to_uppercase().as_str() {
        "SHA-1" => Some(Box::new(Sha1::new())),
        "SHA-256" => Some(Box::new(Sha256::new())),
        "SHA-384" => Some(Box::new(Sha384::new())),
        "SHA-512" => Some(Box::new(Sha512::new())),
        _ => None,
    }
}

async fn fetch_challenge(client: &reqwest::Client, challengeurl: &str) -> Result<Value, String> {
    let res = client
        .get(challengeurl)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data.get("challenge").is_none() || data.get("salt").is_none() {
        return Err("Invalid challenge response (missing challenge/salt)".into());
    }
    Ok(data)
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let params = merged_params(&query, body.map(|b| b.0));

    let client = match super::common::http_client(None, 30) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    let ch: Value = match params.get("challengeurl").and_then(Value::as_str) {
        Some(url) => match fetch_challenge(&client, url).await {
            Ok(c) => c,
            Err(e) => return Json(err(&format!("Gagal solve Altcha: {e}"))),
        },
        None => match params.get("challenge") {
            Some(c @ Value::Object(_)) => c.clone(),
            _ => return Json(err("challenge object or challengeurl is required")),
        },
    };

    let challenge_hash = ch
        .get("challenge")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let salt = ch
        .get("salt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let algorithm = ch
        .get("algorithm")
        .and_then(Value::as_str)
        .unwrap_or("SHA-256")
        .to_string();
    let signature = ch
        .get("signature")
        .and_then(Value::as_str)
        .map(str::to_string);

    if hasher_for(&algorithm).is_none() {
        return Json(err(&format!("Unsupported algorithm: {algorithm}")));
    }

    let ch_max = ch.get("maxnumber").and_then(Value::as_u64).unwrap_or(1_000_000);
    let max_number = params
        .get("max")
        .and_then(Value::as_u64)
        .unwrap_or(ch_max)
        .min(ch_max);
    let start_number = params.get("start").and_then(Value::as_u64).unwrap_or(0);
    let timeout_s = params
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(60)
        .clamp(5, 300);
    let timeout_ms = timeout_s * 1000;

    let mut number: Option<u64> = None;
    for n in start_number..=max_number {
        if (n & 4095) == 0 && start_time.elapsed().as_millis() as u64 > timeout_ms {
            return Json(err("Timeout solving Altcha challenge"));
        }
        let mut hasher = match hasher_for(&algorithm) {
            Some(h) => h,
            None => unreachable!(),
        };
        let mut input = salt.as_bytes().to_vec();
        input.extend_from_slice(n.to_string().as_bytes());
        hasher.update(&input);
        if hasher.finalize_hex() == challenge_hash {
            number = Some(n);
            break;
        }
    }

    let number = match number {
        Some(n) => n,
        None => return Json(err("No solution found within maxnumber")),
    };

    let payload = json!({
        "algorithm": algorithm,
        "challenge": challenge_hash,
        "number": number,
        "salt": salt,
        "signature": signature,
    });
    let payload_b64 = base64::engine::general_purpose::STANDARD.encode(payload.to_string());

    let _ = &state; // state kept for interface parity

    Json(ok(json!({
        "payload": payload_b64,
        "number": number,
        "algorithm": algorithm,
        "salt": salt,
        "signature": signature,
        "duration": start_time.elapsed().as_millis() as u64,
    })))
}

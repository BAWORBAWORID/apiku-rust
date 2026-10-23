use base64::Engine as _;
// FriendlyCaptcha Solver — native conversion of api/solve/friendly.js
// Puzzle format: signature.base64payload. Payload = binary blob with puzzle count at
// offset NUMBER_OF_PUZZLES_OFFSET(=0), difficulty at PUZZLE_DIFFICULTY_OFFSET(=1).
// Each puzzle input = 8-byte LE salt prefix; solution = sha1(input+n) below threshold.
// This mirrors friendly-pow's WASM solver semantics (SHA-1 proof of work).
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::state::AppState;
use super::common::{err, merged_params, ok};

const DEFAULT_ENDPOINT: &str = "https://api.friendlycaptcha.com/api/v1/puzzle";

// friendly-pow constants
const NUMBER_OF_PUZZLES_OFFSET: usize = 0;
const PUZZLE_DIFFICULTY_OFFSET: usize = 1;

/// difficulty byte -> threshold (leading-zero style used by friendly-pow)
fn difficulty_to_threshold(difficulty: u8) -> u32 {
    // friendly-pow: threshold = 2^(8*(4 - difficulty-ish)) approximation.
    // difficulty byte 0..=255; higher difficulty = fewer allowed leading zeros.
    // Reference JS: difficultyToThreshold = (d) => Math.floor(0xffffffff / Math.pow(2, d >> 2))
    let shift = (difficulty >> 2) as u32;
    if shift >= 32 {
        0
    } else {
        0xffff_ffffu32 >> shift
    }
}

fn solve_one(input: &[u8], threshold: u32) -> Option<(Vec<u8>, [u8; 20])> {
    // input = puzzle base (salt). Append 4-byte LE counter, sha1, check < threshold.
    for n in 0u32..0xffff_fff0 {
        let mut data = input.to_vec();
        data.extend_from_slice(&n.to_le_bytes());
        let mut hasher = Sha1::new();
        hasher.update(&data);
        let hash: [u8; 20] = hasher.finalize().into();
        let first4 = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
        if first4 <= threshold {
            return Some((n.to_le_bytes().to_vec(), hash));
        }
    }
    None
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let start_time = Instant::now();
    let params = merged_params(&query, body.map(|b| b.0));
    let _ = &state;

    let sitekey = params
        .get("sitekey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if sitekey.is_empty() {
        return Json(err("Parameter 'sitekey' wajib diisi"));
    }
    let endpoint = params
        .get("puzzleEndpoint")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_ENDPOINT)
        .to_string();
    let timeout_s = params
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(180)
        .clamp(10, 600);

    let client = match super::common::http_client(None, 25) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    // 1. Fetch puzzle
    let puzzle = match client
        .get(format!("{endpoint}?sitekey={}", urlencoding::encode(&sitekey)))
        .timeout(Duration::from_secs(20))
                    .header("x-frc-client", "js-0.9.0")
        .send()
        .await
    {
        Ok(r) => match r.json::<Value>().await {
            Ok(d) => {
                if d.get("success").and_then(Value::as_bool) != Some(true) {
                    return Json(err(&format!(
                        "Invalid puzzle response: {}",
                        &d.to_string()[..d.to_string().len().min(200)]
                    )));
                }
                match d.pointer("/data/puzzle").and_then(Value::as_str) {
                    Some(p) => p.to_string(),
                    None => return Json(err("Invalid puzzle response: missing puzzle")),
                }
            }
            Err(e) => return Json(err(&e.to_string())),
        },
        Err(e) => return Json(err(&format!("Gagal fetch puzzle: {e}"))),
    };

    // 2. Parse puzzle
    let parts: Vec<&str> = puzzle.split('.').collect();
    if parts.len() < 2 {
        return Json(err("Malformed puzzle (expected signature.base64)"));
    }
    let blob = match base64::engine::general_purpose::STANDARD.decode(parts[1]) {
        Ok(b) => b,
        Err(e) => return Json(err(&format!("Malformed puzzle payload: {e}"))),
    };
    let n = blob[NUMBER_OF_PUZZLES_OFFSET] as usize;
    let difficulty = blob[PUZZLE_DIFFICULTY_OFFSET];
    let threshold = difficulty_to_threshold(difficulty);
    if n == 0 || n > 512 {
        return Json(err("Malformed puzzle (bad puzzle count)"));
    }

    // 3. Build solver inputs: friendly-pow splits the payload after the header into n chunks of 104 bytes
    const PUZZLE_INPUT_LEN: usize = 104;
    let data = &blob[2..];
    let mut inputs: Vec<&[u8]> = Vec::new();
    let mut offset = 0;
    for _ in 0..n {
        if offset + PUZZLE_INPUT_LEN > data.len() {
            break;
        }
        inputs.push(&data[offset..offset + PUZZLE_INPUT_LEN]);
        offset += PUZZLE_INPUT_LEN;
    }
    if inputs.len() != n {
        return Json(err("Malformed puzzle (insufficient puzzle data)"));
    }

    // 4. Solve each puzzle (CPU-bound; run in blocking pool)
    let timeout = Duration::from_secs(timeout_s);
    let mut solutions: Vec<String> = Vec::new();
    for input in inputs {
        if start_time.elapsed() > timeout {
            return Json(err("Timeout solving FriendlyCaptcha puzzle"));
        }
        let input_owned = input.to_vec();
        let sol = match tokio::task::spawn_blocking(move || solve_one(&input_owned, threshold)).await {
            Ok(r) => r,
            Err(e) => return Json(err(&format!("No solution found for puzzle part: {e}"))),
        };
        let sol = match sol {
            Some((num_bytes, _hash)) => {
                let mut raw = input.to_vec();
                raw.extend_from_slice(&num_bytes);
                let full = base64::engine::general_purpose::STANDARD.encode(raw);
                let take = full.len().saturating_sub(8);
                full[take..].to_string()
            }
            None => {
                return Json(err("No solution found for puzzle part"));
            }
        };
        solutions.push(sol);
    }

    // 5. Combine solutions
    let combined = solutions.concat();
    let combined_b64 = base64::engine::general_purpose::STANDARD.encode(combined.as_bytes());
    // diagnostics buffer (version 2): 4 bytes version + duration ms LE
    let elapsed_sec = start_time.elapsed().as_secs_f64();
    let mut diag = vec![2u8];
    diag.extend_from_slice(&(elapsed_sec as u32).to_le_bytes());
    let diag_b64 = base64::engine::general_purpose::STANDARD.encode(&diag);

    let solution = format!("{}.{}.{}.{}", parts[0], parts[1], combined_b64, diag_b64);

    Json(ok(json!({
        "solution": solution,
        "puzzles": n,
        "field": "frc-captcha-solution",
        "duration": start_time.elapsed().as_millis() as u64,
    })))
}

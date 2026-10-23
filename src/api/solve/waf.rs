// AWS WAF Challenge Solver — native conversion of api/solve/waf.js
// Pure HTTP: challenge discovery → fingerprint signal (AES-256-GCM) → PoW (scrypt/sha256/bandwidth) → verify.
use axum::{
    extract::{Query, State},
    response::Json,
};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::state::AppState;
use super::common::{err, merged_params, ok};
use rand::Rng;
use base64::Engine as _;

const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const KEY: [u8; 32] = [
    0x6f, 0x71, 0xa5, 0x12, 0xb1, 0xe0, 0x35, 0xea, 0xab, 0x53, 0xd8, 0xbe, 0x73, 0x12, 0x0d, 0x3f,
    0xb6, 0x8a, 0x0c, 0xa3, 0x46, 0xb9, 0x56, 0x0a, 0xab, 0x3e, 0x5c, 0xdf, 0x75, 0x3d, 0x5e, 0x98,
];

fn crc32_hex(data: &[u8]) -> String {
    let mut h = crc32fast::Hasher::new();
    h.update(data);
    format!("{:08X}", h.finalize())
}

fn encrypt(plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(&KEY).map_err(|e| e.to_string())?;
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext.as_bytes(), aad: &[] })
        .map_err(|e| e.to_string())?;
    // AES-GCM ciphertext includes tag at the end (last 16 bytes) — split like Node's getAuthTag
    let (enc, tag) = ct.split_at(ct.len() - 16);
    Ok(format!(
        "{}::{}::{}",
        base64::engine::general_purpose::STANDARD.encode(iv),
        hex::encode(tag),
        hex::encode(enc)
    ))
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()
}

fn build_signal(site: &str, ua: &str, has_token: bool) -> Result<(Value, Value), String> {
    let now = now_ms() as i64;
    let mut rng = rand::thread_rng();

    let collectors: Vec<(&str, &str, f64)> = vec![
        ("fp2", "100", rng.gen_range(0.0f64..3.0)),
        ("browser", "101", 0.0),
        ("capabilities", "102", rng.gen_range(2.0..8.0)),
        ("gpu", "103", rng.gen_range(3.0..12.0)),
        ("dnt", "104", 0.0),
        ("math", "105", 0.0),
        ("screen", "106", 0.0),
        ("navigator", "107", 0.0),
        ("auto", "108", 0.0),
        ("stealth", "undefined", rng.gen_range(1.0..4.0)),
        ("subtle", "110", 0.0),
        ("canvas", "111", rng.gen_range(80.0..200.0)),
        ("formdetector", "112", rng.gen_range(0.0f64..3.0)),
        ("be", "undefined", 0.0),
    ];

    let mut fp_metrics = serde_json::Map::new();
    let mut coll_sum = 0.0;
    let mut metric_values: Vec<(String, f64)> = Vec::new();
    for (name, mid, v) in &collectors {
        fp_metrics.insert(name.to_string(), json!(v.floor()));
        coll_sum += v;
        metric_values.push((mid.to_string(), *v));
    }

    let enc_v = (rng.gen_range(0.5f64..3.0) * 10.0).round() / 10.0;
    let crypt_v = (rng.gen_range(2.0f64..8.0) * 10.0).round() / 10.0;
    let acq = ((coll_sum + enc_v + crypt_v + rng.gen_range(2.0f64..6.0)) * 10.0).round() / 10.0;
    let chall_v = (rng.gen_range(2.0f64..8.0) * 10.0).round() / 10.0;
    let cookie_v = (rng.gen_range(0.1f64..1.0) * 10.0).round() / 10.0;
    let total = ((acq + chall_v + cookie_v) * 10.0).round() / 10.0;

    let mut metrics = vec![json!({"name": "2", "value": enc_v, "unit": "2"})];
    for (mid, v) in &metric_values {
        metrics.push(json!({"name": mid, "value": v, "unit": "2"}));
    }
    metrics.push(json!({"name": "3", "value": crypt_v, "unit": "2"}));
    metrics.push(json!({"name": "7", "value": if has_token {1} else {0}, "unit": "4"}));
    metrics.push(json!({"name": "1", "value": acq, "unit": "2"}));
    metrics.push(json!({"name": "4", "value": chall_v, "unit": "2"}));
    metrics.push(json!({"name": "5", "value": cookie_v, "unit": "2"}));
    metrics.push(json!({"name": "6", "value": total, "unit": "2"}));
    metrics.push(json!({"name": "8", "value": 1, "unit": "4"}));

    let gpu_pool = [
        ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        ("Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        ("Apple Inc.", "Apple M1"),
        ("Apple Inc.", "Apple M2"),
    ];
    let gpu = gpu_pool[rng.gen_range(0..gpu_pool.len())];

    let id = uuid_v4();
    let signal = json!({
        "metrics": fp_metrics,
        "start": now,
        "flashVersion": Value::Null,
        "plugins": [
            {"name": "PDF Viewer", "str": "PDF Viewer "},
            {"name": "Chrome PDF Viewer", "str": "Chrome PDF Viewer "},
            {"name": "Chromium PDF Viewer", "str": "Chromium PDF Viewer "},
            {"name": "Microsoft Edge PDF Viewer", "str": "Microsoft Edge PDF Viewer "},
            {"name": "WebKit built-in PDF", "str": "WebKit built-in PDF "},
        ],
        "dupedPlugins": "PDF Viewer Chrome PDF Viewer Chromium PDF Viewer Microsoft Edge PDF Viewer WebKit built-in PDF ||1920-1080-1080-24-*-*-*",
        "screenInfo": "1920-1080-1080-24-*-*-*",
        "referrer": "",
        "userAgent": ua,
        "location": format!("{site}/"),
        "webDriver": false,
        "capabilities": {
            "css": {"textShadow":1,"WebkitTextStroke":1,"boxShadow":1,"borderRadius":1,"borderImage":1,"opacity":1,"transform":1,"transition":1},
            "js": {"audio":true,"geolocation":true,"localStorage":"supported","touch":false,"video":true,"webWorker":true},
            "elapsed": fp_metrics.get("capabilities").cloned().unwrap_or(json!(0)),
        },
        "gpu": {"vendor": gpu.0, "renderer": gpu.1},
        "dnt": Value::Null,
        "math": {"tan": "-1.4214488238747245", "sin": "0.8178819121159085", "cos": "-0.5753861119575491"},
        "automation": {"wd": {"properties": {"document": [], "window": [], "navigator": []}}, "phantom": {"properties": {"window": []}}},
        "stealth": {"t1": 0, "t2": 0, "i": 1, "mte": 0, "mtd": false},
        "crypto": {"crypto":1,"subtle":1,"encrypt":true,"decrypt":true,"wrapKey":true,"unwrapKey":true,"sign":true,"verify":true,"digest":true,"deriveBits":true,"deriveKey":true,"getRandomValues":true,"randomUUID":true},
        "canvas": {"hash": rng.gen_range(100_000_000..999_999_999i64), "emailHash": Value::Null, "histogramBins": []},
        "formDetected": false,
        "numForms": 0,
        "numFormElements": 0,
        "be": {"si": false},
        "end": now + 1,
        "errors": [],
        "version": "2.4.0",
        "id": id,
    });

    Ok((json!(metrics), signal))
}

// (uuid/md5 unused — replaced by local uuid_v4 helper below)
fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex::encode(b);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]
    )
}

fn check_zeros(hash: &[u8], difficulty: u32) -> bool {
    let mut zeros = 0u32;
    for &b in hash {
        if b == 0 {
            zeros += 8;
        } else {
            for j in (0..8).rev() {
                if (b & (1 << j)) == 0 {
                    zeros += 1;
                } else {
                    break;
                }
            }
            break;
        }
    }
    zeros >= difficulty
}

fn solve_pow(
    challenge_input: &str,
    checksum: &str,
    difficulty: u32,
    ctype: &str,
    memory: u32,
) -> String {
    if ctype == "HashcashScrypt" {
        let salt = checksum.as_bytes();
        let combined = format!("{challenge_input}{checksum}");
        for n in 0u64..100_000_000 {
            let h = scrypt::scrypt(
                format!("{combined}{n}").as_bytes(),
                salt,
                &scrypt::Params::new(memory.clamp(1, 20).try_into().unwrap_or(7), 8, 1, 32)
                    .unwrap_or_else(|_| scrypt::Params::default()),
                &mut [0u8; 32],
            )
            .ok();
            let _ = h;
            let mut out = [0u8; 32];
            let _ = scrypt::scrypt(
                format!("{combined}{n}").as_bytes(),
                salt,
                &scrypt::Params::new(memory.ilog2() as u8, 8, 1, 32).unwrap_or(scrypt::Params::default()),
                &mut out,
            );
            if check_zeros(&out, difficulty) {
                return n.to_string();
            }
        }
    } else if ctype == "SHA256" {
        let base = challenge_input.as_bytes().to_vec();
        for n in 0u64..100_000_000 {
            let mut hasher = Sha256::new();
            hasher.update(&base);
            hasher.update(n.to_string().as_bytes());
            let h = hasher.finalize();
            if check_zeros(&h, difficulty) {
                return n.to_string();
            }
        }
    }
    "0".to_string()
}

fn solve_bandwidth(difficulty: u64) -> String {
    let size = match difficulty {
        1 => 1024,
        2 => 10_240,
        3 => 102_400,
        4 => 1_048_576,
        5 => 10_485_760,
        _ => 1024,
    };
    base64::engine::general_purpose::STANDARD.encode(vec![0u8; size])
}

fn parse_ua(ua: &str) -> (String, String) {
    let ver = ua
        .split("Chrome/")
        .nth(1)
        .and_then(|s| s.split('.').next())
        .unwrap_or("144")
        .to_string();
    let platform = if ua.to_lowercase().contains("windows") { "Windows" } else { "Linux" };
    let v: u32 = ver.parse().unwrap_or(144);
    let brand_tpl = match v % 4 {
        0 => "\"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"{v}\", \"Google Chrome\";v=\"{v}\"",
        1 => "\"Not A(Brand\";v=\"24\", \"Chromium\";v=\"{v}\", \"Google Chrome\";v=\"{v}\"",
        2 => "\"Chromium\";v=\"{v}\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"{v}\"",
        _ => "\"Not:A-Brand\";v=\"8\", \"Chromium\";v=\"{v}\", \"Google Chrome\";v=\"{v}\"",
    };
    (brand_tpl.replace("{v}", &ver), platform.to_string())
}

async fn solve_aws_waf(
    client: &reqwest::Client,
    site: &str,
    ua: &str,
) -> Result<(String, Option<String>), String> {
    let site = site.trim_end_matches('/');
    let domain = site.split("//").nth(1).unwrap_or(site).split('/').next().unwrap_or(site).to_string();

    let (brand, platform) = parse_ua(ua);
    let nav_headers = [
        ("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"),
        ("accept-language", "en-US,en;q=0.9"),
        ("sec-ch-ua", brand.as_str()),
        ("sec-ch-ua-mobile", "?0"),
        ("sec-ch-ua-platform", &format!("\"{platform}\"")),
        ("sec-fetch-dest", "document"),
        ("sec-fetch-mode", "navigate"),
        ("sec-fetch-site", "none"),
        ("sec-fetch-user", "?1"),
        ("upgrade-insecure-requests", "1"),
        ("user-agent", ua),
    ];

    // 1. Discover challenge URL
    let html = {
        let mut req = client.get(site).timeout(Duration::from_secs(15));
        for (k, v) in nav_headers.iter() {
            req = req.header(*k, *v);
        }
        req.send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?
    };

    let re_same = regex::Regex::new(r#"(/__challenge_[A-Za-z0-9]+/[a-f0-9]+/[a-f0-9]+)"#).unwrap();
    let re_ext = regex::Regex::new(r#"(https://[a-z0-9]+\.[a-z0-9]+\.[a-z0-9-]+\.token\.awswaf\.com/[^\s"]+/[^\s"]+/[^\s"]+)"#).unwrap();
    let re_sdk = regex::Regex::new(r#"(https://[a-z0-9]+\.edge\.sdk\.awswaf\.com/[a-z0-9]+/[a-z0-9]+)/challenge\.js"#).unwrap();
    let re_goku = regex::Regex::new(r#"window\.gokuProps\s*=\s*(\{[^}]+\})"#).unwrap();

    let (chal_url, same) = if let Some(m) = re_same.captures(&html) {
        (format!("{site}{}", &m[1]), true)
    } else if let Some(m) = re_ext
        .captures(&html)
        .or_else(|| re_sdk.captures(&html))
    {
        (m[1].to_string(), false)
    } else {
        return Err("AWS WAF challenge URL not found".into());
    };
    let goku: Value = re_goku
        .captures(&html)
        .and_then(|m| serde_json::from_str(&m[1]).ok())
        .unwrap_or(Value::Null);

    // 2. Two verification rounds
    let api_base_headers = [
        ("accept", "*/*"),
        ("accept-language", "en-US,en;q=0.9"),
        ("cache-control", "no-cache"),
        ("ect", "4g"),
        ("origin", site),
        ("pragma", "no-cache"),
        ("priority", "u=1, i"),
        ("referer", &format!("{site}/")),
        ("sec-ch-ua", brand.as_str()),
        ("sec-ch-ua-mobile", "?0"),
        ("sec-ch-ua-platform", &format!("\"{platform}\"")),
        ("sec-fetch-dest", "empty"),
        ("sec-fetch-mode", "cors"),
        ("sec-fetch-site", if same { "same-origin" } else { "cross-site" }),
        ("user-agent", ua),
    ];
    let api_headers: Vec<(String, String)> = api_base_headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let mut token: Option<String> = None;
    for round in 0..2 {
        let (metrics, signal) = build_signal(site, ua, round > 0)?;
        let encoded = format!("{}#{}", crc32_hex(signal.to_string().as_bytes()), signal);
        let checksum = encoded.split('#').next().unwrap_or_default().to_string();
        let encrypted = encrypt(&encoded)?;
        let mut metrics = metrics.as_array().cloned().unwrap_or_default();

        let t_inp = Instant::now();
        let resp = client
            .get(format!("{chal_url}/inputs?client=browser"))
            .timeout(Duration::from_secs(15))
            .header("user-agent", ua)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let inp_latency = (t_inp.elapsed().as_millis() as f64 * 10.0).round() / 10.0;
        let inputs: Value = resp.json().await.map_err(|e| e.to_string())?;
        let challenge = inputs
            .get("challenge")
            .cloned()
            .ok_or("Missing challenge in inputs response")?;

        let input_b64 = challenge.get("input").and_then(Value::as_str).unwrap_or_default();
        let decoded_raw = base64::engine::general_purpose::STANDARD
            .decode(input_b64)
            .map_err(|e| e.to_string())?;
        let decoded: Value = serde_json::from_slice(&decoded_raw).map_err(|e| e.to_string())?;
        let ctype = decoded.get("challenge_type").and_then(Value::as_str).unwrap_or("");
        let difficulty = decoded.get("difficulty").and_then(Value::as_u64).unwrap_or(1) as u32;
        let memory = decoded.get("memory").and_then(Value::as_u64).unwrap_or(128) as u32;

        if round > 0 {
            metrics.insert(0, json!({"name": "0", "value": inp_latency, "unit": "2"}));
        }

        let endpoint = match ctype {
            "NetworkBandwidth" => "mp_verify",
            _ => "verify",
        };

        let mut body_obj = json!({
            "challenge": challenge,
            "solution": Value::Null,
            "signals": [{"name": "Zoey", "value": {"Present": encrypted}}],
            "checksum": checksum,
            "existing_token": Value::Null,
            "client": "Browser",
            "domain": domain,
            "metrics": metrics,
        });
        if !goku.is_null() {
            body_obj["goku_props"] = goku.clone();
        }

        let result: Value = if ctype == "NetworkBandwidth" {
            let sol_data = solve_bandwidth(difficulty as u64);
            let boundary = format!("----WebKitFormBoundary{}", hex::encode({
                let mut b = [0u8; 8];
                rand::thread_rng().fill_bytes(&mut b);
                b
            }));
            let meta = {
                let mut m = body_obj.clone();
                m["solution"] = Value::Null;
                m
            };
            let mp_body = format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"solution_data\"\r\n\r\n{sol_data}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"solution_metadata\"\r\n\r\n{}\r\n--{boundary}--\r\n",
                meta
            );
            client
                .post(format!("{chal_url}/{endpoint}"))
                .timeout(Duration::from_secs(30))
                .header("user-agent", ua)
                .header("content-type", format!("multipart/form-data; boundary={boundary}"))
                .body(mp_body)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?
        } else {
            let solution = solve_pow(input_b64, &checksum, difficulty, ctype, memory);
            body_obj["solution"] = json!(solution);
            client
                .post(format!("{chal_url}/{endpoint}"))
                .timeout(Duration::from_secs(30))
                .header("user-agent", ua)
                            .header("content-type", "text/plain;charset=UTF-8")
                .body(body_obj.to_string())
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?
        };

        if let Some(t) = result.get("token").and_then(Value::as_str) {
            token = Some(t.to_string());
        }
    }

    Ok((site.to_string(), token))
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let start = Instant::now();
    let params = merged_params(&query, body.map(|b| b.0));
    let _ = &state;

    let target = params.get("url").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if url::Url::parse(&target).is_err() {
        return Json(err("Format URL tidak valid"));
    }

    let ua = params
        .get("ua")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_UA.to_string());

    let proxy = params
        .get("proxy")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let client = match super::common::http_client(proxy.as_deref(), 30) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    match solve_aws_waf(&client, &target, &ua).await {
        Ok((site, token)) => Json(ok(json!({
            "site": site,
            "token": token,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "responseTime": format!("{}ms", start.elapsed().as_millis()),
        }))),
        Err(e) => Json(err(&format!(
            "{} | responseTime: {}ms",
            e,
            start.elapsed().as_millis()
        ))),
    }
}

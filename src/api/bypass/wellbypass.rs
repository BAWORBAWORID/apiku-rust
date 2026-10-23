// WellBypass — native conversion of api/bypass/wellbypass.js
// Upstream wellbypass.my.id: captcha-config, device register, POST /api/bypass,
// async job polling. Auto-solve Turnstile (Node: npx haidarcf + browser) is not
// possible natively — if upstream requires a token we ask for it explicitly.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const WELLBYPASS_URL: &str = "https://wellbypass.my.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn generate_device_id() -> String {
    let fingerprint = format!("{}::en-US::1920x1080x24::Asia/Jakarta::8", UA);
    let mut hash: i64 = 0;
    for c in fingerprint.chars() {
        hash = (hash << 5).wrapping_sub(hash).wrapping_add(c as i64);
    }
    format!("wb_{:x}_{}", hash.abs(), chrono::Utc::now().timestamp_millis())
}

fn base_headers(device_id: &str) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();
    map.insert("Content-Type", "application/json".parse().unwrap());
    map.insert("User-Agent", UA.parse().unwrap());
    map.insert("x-device-id", device_id.parse().unwrap());
    map.insert("Origin", WELLBYPASS_URL.parse().unwrap());
    map.insert("Referer", format!("{}/id", WELLBYPASS_URL).parse().unwrap());
    map
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

async fn get_captcha_config(client: &reqwest::Client) -> Result<(String, String), String> {
    let res = client
        .get(format!("{}/api/captcha-config", WELLBYPASS_URL))
        .header("Referer", format!("{}/id", WELLBYPASS_URL))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Gagal membaca konfigurasi captcha upstream (HTTP {})", res.status()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let site_key = data
        .get("siteKey")
        .and_then(|s| s.as_str())
        .ok_or("Upstream tidak mengembalikan siteKey")?
        .to_string();
    let mode = data
        .get("mode")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();
    Ok((mode, site_key))
}

async fn poll_job(
    client: &reqwest::Client,
    job_id: &str,
    device_id: &str,
    max_wait_ms: u64,
) -> Result<(bool, Option<Value>, bool), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(max_wait_ms);
    let mut last = None;
    while std::time::Instant::now() < deadline {
        let res = client
            .get(format!("{}/api/bypass/status", WELLBYPASS_URL))
            .query(&[("jobId", job_id), ("deviceId", device_id)])
            .header("x-device-id", device_id)
            .header("Referer", format!("{}/id", WELLBYPASS_URL))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Polling job gagal (HTTP {})", res.status()));
        }
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        let status = data.get("jobStatus").and_then(|s| s.as_str()).unwrap_or("");
        if status == "done" {
            return Ok((true, Some(data), false));
        }
        if status == "failed" {
            let code = data.get("code").and_then(|c| c.as_str()).unwrap_or("unknown");
            return Err(upstream_code_message(code).unwrap_or_else(|| {
                data.get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or(&format!("Job gagal ({})", code))
                    .to_string()
            }));
        }
        last = Some(data);
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    Ok((false, last, true))
}

fn upstream_code_message(code: &str) -> Option<String> {
    Some(
        match code {
            "INVALID_URL" => "URL tidak valid",
            "UNSUPPORTED_DOMAIN" => "Domain ini belum didukung wellbypass.my.id",
            "RATE_LIMITED" => "Rate limited upstream — tunggu sebentar lalu coba lagi",
            "CAPTCHA_FAILED" => "Token captcha ditolak upstream",
            "CAPTCHA_TOKEN_REUSED" => "Token captcha sudah pernah dipakai — generate token baru",
            "CAPTCHA_REQUIRED" => "Token captcha wajib diisi",
            _ => return None,
        }
        .to_string(),
    )
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();
    let get_str = |k: &str| -> Option<String> {
        body.as_ref()
            .and_then(|Json(v)| v.get(k).map(|x| match x {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            }))
            .or_else(|| query.get(k).cloned())
    };

    let url = match get_str("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'url' wajib diisi",
                "example": {
                    "get": "/api/bypass/wellbypass?url=https://linkvertise.com/546946/mYoUbm5Ro7gU",
                    "post": { "url": "https://linkvertise.com/546946/mYoUbm5Ro7gU" },
                },
            })))
            .into_response()
        }
    };
    let manual_token = get_str("turnstileToken").filter(|t| !t.trim().is_empty());
    let do_wait = get_str("wait").map(|w| w != "false").unwrap_or(true);
    let elapsed = || format!("{}ms", started.elapsed().as_millis());

    let client = match client() {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e, "result": { "responseTime": elapsed() }
            })))
            .into_response()
        }
    };
    let device_id = generate_device_id();

    // best-effort device register
    let _ = client
        .post(format!("{}/api/device/register", WELLBYPASS_URL))
        .headers(base_headers(&device_id))
        .body("{}")
        .send()
        .await;

    let token = match manual_token {
        Some(t) => t,
        None => {
            let (mode, site_key) = match get_captcha_config(&client).await {
                Ok(v) => v,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, Json(json!({
                        "status": false,
                        "message": format!("Tidak bisa menentukan jenis captcha upstream: {}", e),
                        "result": { "originalUrl": url, "responseTime": elapsed() },
                    })))
                    .into_response()
                }
            };
            if mode != "cf" {
                let message = if mode == "hc" {
                    "Upstream memakai hCaptcha. Auto-solve tidak tersedia dari IP server, jadi kirim token manual lewat parameter 'turnstileToken' (ambil dari widget hCaptcha di wellbypass.my.id/id).".to_string()
                } else {
                    format!("Upstream memakai captcha mode '{}' yang belum didukung. Kirim token manual lewat parameter 'turnstileToken'.", mode)
                };
                return (StatusCode::NOT_IMPLEMENTED, Json(json!({
                    "status": false,
                    "message": message,
                    "result": {
                        "originalUrl": url,
                        "captchaMode": mode,
                        "siteKey": site_key,
                        "supported": false,
                        "responseTime": elapsed(),
                    },
                })))
                .into_response();
            }
            // mode "cf" (Turnstile) — native Rust has no browser solver
            return (StatusCode::NOT_IMPLEMENTED, Json(json!({
                "status": false,
                "message": "Auto-solve Turnstile butuh browser engine, belum didukung native. Kirim token manual lewat parameter 'turnstileToken'.",
                "result": {
                    "originalUrl": url,
                    "captchaMode": mode,
                    "siteKey": site_key,
                    "hint": {
                        "step1": "buka https://wellbypass.my.id/id",
                        "step2": "paste URL, selesaikan checkbox Turnstile",
                        "step3": "ambil token dari console: document.querySelector('[name=cf-turnstile-response]').value",
                        "step4": "panggil /api/bypass/wellbypass?url=<url>&turnstileToken=<token>",
                    },
                    "responseTime": elapsed(),
                },
            })))
            .into_response();
        }
    };

    let bypass_res = client
        .post(format!("{}/api/bypass", WELLBYPASS_URL))
        .headers(base_headers(&device_id))
        .body(json!({ "url": url.trim(), "turnstileToken": token }).to_string())
        .send()
        .await;
    let bypass_res = match bypass_res {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": e.to_string(), "result": { "responseTime": elapsed() }
            })))
            .into_response()
        }
    };
    let status = bypass_res.status().as_u16();
    let data: Value = bypass_res.json().await.unwrap_or(json!({ "status": false }));

    if data.get("status").and_then(|s| s.as_bool()) != Some(true) {
        let code = data.get("code").and_then(|c| c.as_str()).map(|s| s.to_string());
        let msg = code
            .as_deref()
            .and_then(upstream_code_message)
            .or_else(|| data.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| "Gagal bypass link".to_string());
        return (
            StatusCode::from_u16(if status >= 400 { status } else { 400 })
                .unwrap_or(StatusCode::BAD_REQUEST),
            Json(json!({
                "status": false,
                "message": msg,
                "code": code,
                "result": { "originalUrl": url, "responseTime": elapsed() },
            })),
        )
            .into_response();
    }

    let is_async = data.get("async").and_then(|a| a.as_bool()).unwrap_or(false);
    let job_id = data.get("jobId").and_then(|j| j.as_str()).map(|s| s.to_string());
    if is_async && job_id.is_some() {
        let job_id = job_id.unwrap();
        let dev = data
            .get("deviceId")
            .and_then(|d| d.as_str())
            .unwrap_or(&device_id)
            .to_string();
        if !do_wait {
            return Json(json!({
                "status": true,
                "pending": true,
                "message": "Job diproses upstream. Poll /api/bypass/wellbypass dengan jobId + deviceId di bawah.",
                "jobId": job_id,
                "deviceId": dev,
                "result": { "originalUrl": url, "responseTime": elapsed() },
            }))
            .into_response();
        }
        match poll_job(&client, &job_id, &dev, 45_000).await {
            Ok((true, Some(jd), _)) => {
                if let Some(bypassed) = jd.get("bypassedUrl").and_then(|b| b.as_str()) {
                    return Json(json!({
                        "status": true,
                        "result": {
                            "originalUrl": jd.get("originalUrl").and_then(|o| o.as_str()).unwrap_or(&url),
                            "bypassedUrl": bypassed,
                            "isDirectUrl": jd.get("isDirectUrl"),
                            "fromCache": jd.get("fromCache"),
                            "executionTimeMs": jd.get("executionTimeMs"),
                            "responseTime": elapsed(),
                        },
                    }))
                    .into_response();
                }
                return (
                    StatusCode::ACCEPTED,
                    Json(json!({
                        "status": true,
                        "pending": true,
                        "message": "Job belum selesai.",
                        "jobId": job_id,
                        "deviceId": dev,
                        "progress": jd.get("progress"),
                        "result": { "originalUrl": url, "responseTime": elapsed() },
                    })),
                )
                    .into_response();
            }
            Ok((true, None, _)) => {
                return (
                    StatusCode::ACCEPTED,
                    Json(json!({
                        "status": true,
                        "pending": true,
                        "message": "Job belum selesai.",
                        "jobId": job_id,
                        "deviceId": dev,
                        "result": { "originalUrl": url, "responseTime": elapsed() },
                    })),
                )
                    .into_response()
            }
            Ok((false, jd, timed_out)) => {
                return (
                    StatusCode::ACCEPTED,
                    Json(json!({
                        "status": true,
                        "pending": true,
                        "message": if timed_out { "Job masih berjalan setelah 45 detik." } else { "Job belum selesai." },
                        "jobId": job_id,
                        "deviceId": dev,
                        "progress": jd.and_then(|j| j.get("progress").cloned()).unwrap_or(Value::Null),
                        "result": { "originalUrl": url, "responseTime": elapsed() },
                    })),
                )
                    .into_response()
            }
            Err(e) => {
                return (StatusCode::BAD_GATEWAY, Json(json!({
                    "status": false,
                    "message": e,
                    "jobId": job_id,
                    "result": { "originalUrl": url, "responseTime": elapsed() },
                })))
                .into_response()
            }
        }
    }

    Json(json!({
        "status": true,
        "result": {
            "originalUrl": url,
            "bypassedUrl": data.get("bypassedUrl").cloned().unwrap_or(Value::Null),
            "isDirectUrl": data.get("isDirectUrl").cloned().unwrap_or(Value::Null),
            "service": data.get("service").cloned().unwrap_or(Value::Null),
            "responseTime": elapsed(),
        },
    })).into_response()

}

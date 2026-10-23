// Image Enhancer (imgupscaler.ai) — native conversion of api/imagehd/imgenhance.js
// Router-key iu_home_image_enhancer_v1: create job -> poll -> download result image.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://api-v2.imgupscaler.ai";
const ORIGIN: &str = "https://imgupscaler.ai";
const REFERER: &str = "https://imgupscaler.ai/";
const PRODUCT_CODE: &str = "Imgupscaler";
const ROUTER_KEY: &str = "iu_home_image_enhancer_v1";
const UA: &str = "Mozilla/5.0 (Linux; Android 12; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

const POLL_MAX: u32 = 30;
const POLL_INTERVAL_MS: u64 = 2000;

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn merge_params(query: HashMap<String, String>, body: Option<Json<Value>>) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in query {
        m.insert(k, Value::String(v));
    }
    if let Some(Json(b)) = body {
        if let Value::Object(o) = b {
            for (k, v) in o {
                m.insert(k, v);
            }
        }
    }
    Value::Object(m)
}

fn random_uuid() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let hex: String = (0..32).map(|_| format!("{:02x}", rng.gen::<u8>())).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn base_headers(product_serial: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", UA.parse().unwrap());
    h.insert("Origin", ORIGIN.parse().unwrap());
    h.insert("Referer", REFERER.parse().unwrap());
    h.insert("Accept", "*/*".parse().unwrap());
    h.insert("Product-Code", PRODUCT_CODE.parse().unwrap());
    h.insert("Product-Serial", product_serial.parse().unwrap());
    h.insert("Router-Key", ROUTER_KEY.parse().unwrap());
    h.insert("Timezone", "Asia/Jakarta".parse().unwrap());
    h.insert("Sec-Ch-Ua", "\"Chromium\";v=\"139\", \"Not;A=Brand\";v=\"99\"".parse().unwrap());
    h.insert("Sec-Ch-Ua-Mobile", "?1".parse().unwrap());
    h.insert("Sec-Ch-Ua-Platform", "\"Android\"".parse().unwrap());
    h
}

fn pick_output_url(data: &Value) -> Option<String> {
    [
        "/result/output_image_url",
        "/result/outputUrl",
        "/result/output_url",
        "/data/output_image_url",
        "/data/outputUrl",
        "/data/output_url",
        "/output_image_url",
        "/outputUrl",
        "/output_url",
    ]
    .iter()
    .find_map(|p| data.pointer(p).and_then(|v| v.as_str()).map(|s| s.to_string()))
}

fn pick_status(data: &Value) -> Value {
    data.pointer("/result/status")
        .or_else(|| data.pointer("/data/status"))
        .cloned()
        .unwrap_or_else(|| data.get("status").cloned().unwrap_or(Value::Null))
}

fn is_failure(status: &Value) -> bool {
    match status {
        Value::Number(n) => {
            let v = n.as_i64().unwrap_or(0);
            v == -1 || v == -2 || v == 3
        }
        Value::String(s) => {
            let l = s.to_lowercase();
            l == "failed" || l == "error" || l == "failure"
        }
        _ => false,
    }
}

fn api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
}

async fn create_job(client: &reqwest::Client, image_url: &str) -> Result<(String, String), String> {
    // Download the image
    let dl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let img_res = dl
        .get(image_url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ct = img_res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = img_res.bytes().await.map_err(|e| e.to_string())?.to_vec();

    let product_serial = random_uuid();
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("{}.jpg", random_hex(16)))
        .mime_str(&ct)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("original_image_file", part)
        .text("scene", "normal")
        .text("output_format", "jpg");

    let res = client
        .post(format!("{BASE_URL}/api/runtime/jobs/create-job"))
        .headers(base_headers(&product_serial))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().as_u16() != 200 {
        return Err(format!("Create job gagal (HTTP {})", res.status().as_u16()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(code) = data.get("code").and_then(|c| c.as_i64()) {
        if code != 100000 {
            let msg = data
                .pointer("/message/en")
                .and_then(|m| m.as_str())
                .or_else(|| data.get("message").and_then(|m| m.as_str()))
                .unwrap_or("")
                .to_string();
            if msg.to_lowercase().contains("insufficient")
                || msg.to_lowercase().contains("limit")
                || msg.to_lowercase().contains("credit")
            {
                return Err("INSUFFICIENT_CREDITS".to_string());
            }
            return Err(if msg.is_empty() { format!("API error (code: {code})") } else { msg });
        }
    }
    let job_id = data
        .pointer("/result/job_id")
        .and_then(|j| j.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Job ID tidak ditemukan: {}", &data.to_string()[..200.min(data.to_string().len())]))?;
    Ok((job_id, product_serial))
}

async fn poll_job(client: &reqwest::Client, job_id: &str, product_serial: &str) -> Result<String, String> {
    for _ in 1..=POLL_MAX {
        tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
        let res = match client
            .get(format!("{BASE_URL}/api/runtime/jobs/get-job/{job_id}"))
            .headers(base_headers(product_serial))
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => continue,
        };
        if res.status().as_u16() != 200 {
            continue;
        }
        let data: Value = match res.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(output) = pick_output_url(&data) {
            return Ok(output);
        }
        if is_failure(&pick_status(&data)) {
            let s = data.to_string();
            return Err(format!("Enhance gagal: {}", &s[..200.min(s.len())]));
        }
    }
    Err(format!("Timeout menunggu hasil (job: {job_id})"))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let params = merge_params(query, body);
    let image_url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) => u.trim().to_string(),
        None => String::new(),
    };
    if image_url.is_empty() {
        return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi");
    }
    if !image_url.starts_with("http://") && !image_url.starts_with("https://") {
        return jerr(StatusCode::BAD_REQUEST, "URL harus diawali http:// atau https://");
    }

    let client = match api_client() {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let (job_id, product_serial) = match create_job(&client, &image_url).await {
        Ok(v) => v,
        Err(e) => {
            if e == "INSUFFICIENT_CREDITS" {
                return jerr(
                    StatusCode::TOO_MANY_REQUESTS,
                    "Kuota enhance habis di sisi provider, coba lagi nanti.",
                );
            }
            if e.contains("Timeout") {
                return jerr(StatusCode::GATEWAY_TIMEOUT, &e);
            }
            if e.contains("create job") || e.contains("gagal (HTTP") {
                return jerr(StatusCode::BAD_GATEWAY, &e);
            }
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e);
        }
    };

    let output_url = match poll_job(&client, &job_id, &product_serial).await {
        Ok(u) => u,
        Err(e) => {
            if e.contains("Timeout") {
                return jerr(StatusCode::GATEWAY_TIMEOUT, &e);
            }
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e);
        }
    };

    // Download result
    let dl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match dl.get(&output_url).header("User-Agent", UA).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let buffer = match res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if buffer.is_empty() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Gambar hasil kosong");
    }

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", ct)
        .header("Content-Length", buffer.len().to_string())
                    .header("Cache-Control", "public, max-age=3600")
        .header("X-Job-Id", job_id)
                    .header("X-Image-Processor", "imgupscaler-iu_home_image_enhancer_v1")
        .body(axum::body::Body::from(buffer))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

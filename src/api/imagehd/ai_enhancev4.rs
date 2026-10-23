// AI Enhance HD v4 — native conversion of api/imagehd/ai-enhancev4.js
// iLoveIMG: scrape session token from page -> upload -> wait -> upscale -> return image bytes.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const PAGE_URL: &str = "https://www.iloveimg.com/upscale-image";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SERVERS: [&str; 26] = [
    "api1g.iloveimg.com",
    "api2g.iloveimg.com",
    "api8g.iloveimg.com",
    "api9g.iloveimg.com",
    "api10g.iloveimg.com",
    "api11g.iloveimg.com",
    "api12g.iloveimg.com",
    "api13g.iloveimg.com",
    "api14g.iloveimg.com",
    "api15g.iloveimg.com",
    "api16g.iloveimg.com",
    "api17g.iloveimg.com",
    "api18g.iloveimg.com",
    "api19g.iloveimg.com",
    "api20g.iloveimg.com",
    "api21g.iloveimg.com",
    "api22g.iloveimg.com",
    "api25g.iloveimg.com",
    "api26g.iloveimg.com",
    "api27g.iloveimg.com",
    "api28g.iloveimg.com",
    "api29g.iloveimg.com",
    "api30g.iloveimg.com",
    "api31g.iloveimg.com",
    "api32g.iloveimg.com",
    "api33g.iloveimg.com",
];

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn bin_response(bytes: Vec<u8>, content_type: &str, extra: &[(&str, String)]) -> Response {
    let mut b = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type);
    for (k, v) in extra {
        b = b.header(*k, v);
    }
    b.body(axum::body::Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Find first capture group for a simple literal-with-capture pattern.
/// Supports patterns of the form `prefix"([^"]+)"` via manual scanning:
/// we look for the literal prefix, then read the quoted value that follows.
fn extract_after(html: &str, prefix: &str, quoted: bool) -> Option<String> {
    let idx = html.find(prefix)?;
    let rest = &html[idx + prefix.len()..];
    if !quoted {
        // read until quote/whitespace
        let end = rest
            .find(|c: char| c == '\'' || c == '"' || c.is_whitespace())
            .unwrap_or(rest.len());
        return Some(rest[..end].to_string());
    }
    // skip to the quote char
    let q = rest.find(|c: char| c == '"' || c == '\'')?;
    let qchar = rest.as_bytes()[q] as char;
    let after = &rest[q + 1..];
    let end = after.find(qchar)?;
    Some(after[..end].to_string())
}

async fn get_session(client: &reqwest::Client) -> Result<(String, String), String> {
    let html = client
        .get(PAGE_URL)
        .header("User-Agent", BROWSER_UA)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.5")
        
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let token = extract_after(&html, "\"token\":", true)
        .ok_or_else(|| "Gagal mendapatkan session iLoveIMG: token tidak ditemukan".to_string())?;
    let task_id = extract_after(&html, "ilovepdfConfig.taskId =", true)
        .ok_or_else(|| "Gagal mendapatkan session iLoveIMG: taskId tidak ditemukan".to_string())?;
    Ok((token, task_id))
}

async fn upload_image(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    task_id: &str,
    buffer: Vec<u8>,
    filename: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename.to_string())
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("task", task_id.to_string())
        .text("preview", "1")
        .text("v", "1.0")
        .part("file", part);

    let res = client
        .post(format!("https://{server}/v1/upload"))
        .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/json")
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if status != 200 || data.get("server_filename").is_none() {
        return Err(format!(
            "Gagal upload ({}): {}",
            status,
            serde_json::to_string(&data).unwrap_or_default()
        ));
    }
    Ok(data
        .get("server_filename")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

async fn upscale_image(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    task_id: &str,
    server_filename: &str,
    scale: u32,
) -> Result<Vec<u8>, String> {
    let form = reqwest::multipart::Form::new()
        .text("task", task_id.to_string())
        .text("server_filename", server_filename.to_string())
        .text("scale", scale.to_string());

    let res = client
        .post(format!("https://{server}/v1/upscale"))
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();

    if status != 200 {
        let msg = String::from_utf8_lossy(&bytes);
        return Err(format!("Upscale failed ({}): {}", status, msg));
    }
    if ct.contains("json") {
        let msg = String::from_utf8_lossy(&bytes);
        return Err(format!("Upscale returned JSON: {}", msg));
    }
    Ok(bytes)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| -> Option<String> {
        if let Some(v) = query.get(k) {
            if !v.is_empty() {
                return Some(v.clone());
            }
        }
        if let Some(Json(b)) = &body {
            if let Some(s) = b.get(k).and_then(|v| v.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
        None
    };

    let url = match get("url") {
        Some(u) => u,
        None => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    let scale = match get("scale").as_deref() {
        Some("2") => 2,
        _ => 4,
    };

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let image_buffer = match client
        .get(&url)
        .header("User-Agent", BROWSER_UA)
        
        .send()
        .await
    {
        Ok(r) => match r.bytes().await {
            Ok(b) => b.to_vec(),
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        },
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let filename = format!(
        "upscale-{}.jpg",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let (token, task_id) = match get_session(&client).await {
        Ok(v) => v,
        Err(_) => return jerr(StatusCode::BAD_GATEWAY, "Gagal mendapatkan session iLoveIMG"),
    };

    let server = {
        use rand::Rng;
        let idx = rand::thread_rng().gen_range(0..SERVERS.len());
        SERVERS[idx]
    };

    let server_filename = match upload_image(&client, server, &token, &task_id, image_buffer, &filename).await {
        Ok(f) => f,
        Err(_) => return jerr(StatusCode::BAD_GATEWAY, "Gagal upload gambar"),
    };

    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;

    let result = match upscale_image(&client, server, &token, &task_id, &server_filename, scale).await {
        Ok(b) => b,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    bin_response(
        result,
        "image/jpeg",
        &[
            ("X-Enhance-Service", "iloveimg-v4".to_string()),
            ("X-Scale", scale.to_string()),
            ("X-Task-Id", task_id),
        ],
    )
}

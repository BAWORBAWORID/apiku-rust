// AI Enhance HD v3 — native conversion of api/imagehd/ai-enhancev3.js
// cutout.pro: OSS upload -> submit task -> poll -> download result image.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://restapi.cutout.pro";
const BROWSER_UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7339.0 Mobile Safari/537.36";

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

async fn download(client: &reqwest::Client, url: &str, timeout: u64) -> Result<Vec<u8>, String> {
    let res = client
        .get(url)
        .header("User-Agent", BROWSER_UA)
        .timeout(std::time::Duration::from_secs(timeout))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok(bytes)
}

async fn upload_image(client: &reqwest::Client, buffer: Vec<u8>, filename: &str) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename.to_string())
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let res = client
        .post(format!("{BASE}/oss/upload"))
                    .header("Origin", "https://www.cutout.pro")
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
        let msg = data
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Gagal upload gambar ke server")
            .to_string();
        return Err(msg);
    }
    data.get("data")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Gagal upload gambar ke server".to_string())
}

async fn submit_task(client: &reqwest::Client, image_url: &str) -> Result<String, String> {
    let url = format!(
        "{BASE}/webMatting/photoEnhancer/submitTaskByUrl?token=&imageUrl={}",
        urlencoding::encode(image_url)
    );
    let res = client
        .get(&url)
                    .header("Origin", "https://www.cutout.pro")
                    .header("Referer", "https://www.cutout.pro/")
        .header("User-Agent", BROWSER_UA)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
        let msg = data
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Gagal submit task enhance")
            .to_string();
        return Err(msg);
    }
    data.get("data")
        .map(|d| match d {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .ok_or_else(|| "Gagal submit task enhance".to_string())
}

async fn get_task_info(client: &reqwest::Client, task_id: &str) -> Result<Value, String> {
    let url = format!("{BASE}/webMatting/photoEnhancer/getTaskInfo?token=&id={task_id}");
    let res = client
        .get(&url)
                    .header("Origin", "https://www.cutout.pro")
                    .header("Referer", "https://www.cutout.pro/")
        .header("User-Agent", BROWSER_UA)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
        let msg = data
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Gagal mendapatkan info task")
            .to_string();
        return Err(msg);
    }
    Ok(data.get("data").cloned().unwrap_or(Value::Null))
}

async fn poll_task(client: &reqwest::Client, task_id: &str) -> Result<Value, String> {
    let max_attempts = 30;
    for _ in 0..max_attempts {
        let info = get_task_info(client, task_id).await?;
        let status = info.get("status").and_then(|s| s.as_str()).unwrap_or("");
        if status == "success" {
            return Ok(info);
        }
        if status == "failed" {
            return Err("Task enhance gagal diproses".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    }
    Err("Timeout menunggu hasil enhance".to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    // Merge query + JSON body
    let url_param = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });

    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(_) => reqwest::Client::new(),
    };

    let image_buffer = match download(&client, &url, 60).await {
        Ok(b) => b,
        Err(_) => return jerr(StatusCode::BAD_REQUEST, "Gagal mendownload gambar dari URL"),
    };

    let filename = format!(
        "enhance-{}.jpg",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let oss_url = match upload_image(&client, image_buffer, &filename).await {
        Ok(u) => u,
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, "Gagal upload ke server"),
    };

    let task_id = match submit_task(&client, &oss_url).await {
        Ok(t) => t,
        Err(_) => return jerr(StatusCode::BAD_GATEWAY, "Gagal submit task"),
    };

    let result = match poll_task(&client, &task_id).await {
        Ok(r) => r,
        Err(e) => {
            if e.contains("Timeout") {
                return jerr(StatusCode::GATEWAY_TIMEOUT, "Timeout menunggu hasil");
            }
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e);
        }
    };

    let result_url = result
        .get("bgRemovedPreview")
        .or_else(|| result.get("downloadFileUrl"))
        .or_else(|| result.get("original"))
        .and_then(|u| u.as_str())
        .unwrap_or("");
    if result_url.is_empty() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Tidak ada URL hasil enhance");
    }

    let enhanced = match download(&client, result_url, 60).await {
        Ok(b) => b,
        Err(_) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Gagal mendownload hasil enhance"),
    };

    let hdr = |k: &str| -> String {
        result
            .get(k)
            .map(|v| match v {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_else(|| "unknown".to_string())
    };

    bin_response(
        enhanced,
        "image/jpeg",
        &[
            ("X-Enhance-Service", "cutout-pro-v3".to_string()),
            ("X-Task-Id", task_id),
            ("X-Original-Width", hdr("originalWidth")),
            ("X-Original-Height", hdr("originalHeight")),
            ("X-Preview-Width", hdr("previewWidth")),
            ("X-Preview-Height", hdr("previewHeight")),
        ],
    )
}

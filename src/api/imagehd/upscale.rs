// Upscale AI — native conversion of api/imagehd/upscale.js
// imgupscaler.ai: download image -> create-job (multipart) -> poll get-job -> download result.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const UA_MOBILE: &str = "Mozilla/5.0 (Linux; Android 15; 23124RA7EO Build/AQ3A.240829.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.174 Mobile Safari/537.36";
const UA_DESKTOP: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

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

fn create_job_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", UA_MOBILE.parse().unwrap());
    h.insert("sec-ch-ua-platform", "\"Android\"".parse().unwrap());
    h.insert("authorization", "".parse().unwrap());
    h.insert("timezone", "Asia/Jakarta".parse().unwrap());
    h.insert("sec-ch-ua", "\"Chromium\";v=\"142\", \"Android WebView\";v=\"142\", \"Not_A Brand\";v=\"99\"".parse().unwrap());
    h.insert("sec-ch-ua-mobile", "?1".parse().unwrap());
    h.insert("product-serial", "0a78953065c51e7532fbb98019e2233b".parse().unwrap());
    h.insert("origin", "https://imgupscaler.ai".parse().unwrap());
    h.insert("x-requested-with", "mark.via.gp".parse().unwrap());
    h.insert("sec-fetch-site", "same-site".parse().unwrap());
    h.insert("sec-fetch-mode", "cors".parse().unwrap());
    h.insert("sec-fetch-dest", "empty".parse().unwrap());
    h.insert("referer", "https://imgupscaler.ai/".parse().unwrap());
    h.insert("accept-language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h
}

fn poll_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", UA_MOBILE.parse().unwrap());
    h.insert("access-control-request-method", "GET".parse().unwrap());
    h.insert("access-control-request-headers", "product-serial".parse().unwrap());
    h.insert("origin", "https://imgupscaler.ai".parse().unwrap());
    h.insert("x-requested-with", "mark.via.gp".parse().unwrap());
    h.insert("sec-fetch-site", "same-site".parse().unwrap());
    h.insert("sec-fetch-mode", "cors".parse().unwrap());
    h.insert("sec-fetch-dest", "empty".parse().unwrap());
    h.insert("referer", "https://imgupscaler.ai/".parse().unwrap());
    h.insert("accept-language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let params = merge_params(query, body);
    let url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };

    // 1. Download image
    let dl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let img_res = match dl
        .get(&url)
        .header("User-Agent", UA_DESKTOP)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let image_buffer = match img_res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    // 2. Create upscale job
    let part = reqwest::multipart::Part::bytes(image_buffer)
        .file_name("image.jpg")
        .mime_str("image/jpeg")
        .expect("valid mime");
    let form = reqwest::multipart::Form::new().part("original_image_file", part);

    let create_res = match dl
        .post("https://api.imgupscaler.ai/api/image-upscaler/v2/upscale/create-job")
        .headers(create_job_headers())
        .multipart(form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let create_data: Value = match create_res.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let job_id = match create_data.pointer("/result/job_id").and_then(|j| j.as_str()) {
        Some(j) => j.to_string(),
        None => return jerr(StatusCode::BAD_GATEWAY, "Server upscale sedang bermasalah"),
    };

    // 3. Poll result
    let mut attempts = 0;
    let max_attempts = 120;
    let mut result_data: Value = Value::Null;
    while attempts < max_attempts {
        let poll_res = match dl
            .get(format!(
                "https://api.imgupscaler.ai/api/image-upscaler/v1/universal_upscale/get-job/{job_id}"
            ))
            .headers(poll_headers())
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        };
        result_data = poll_res.json().await.unwrap_or(Value::Null);
        if result_data.pointer("/result/output_url").is_some() {
            break;
        }
        let status = result_data.pointer("/result/status").and_then(|s| s.as_str()).unwrap_or("");
        if status == "error" || status == "failed" {
            let msg = result_data
                .pointer("/result/message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return jerr(
                StatusCode::INTERNAL_SERVER_ERROR,
                &json!({
                    "status": false,
                    "message": "Proses upscale mengalami error",
                    "detail": msg
                })
                .to_string(),
            );
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        attempts += 1;
    }
    if attempts >= max_attempts {
        return jerr(StatusCode::GATEWAY_TIMEOUT, "Proses upscale memakan waktu terlalu lama. Coba gambar lain.");
    }
    let output_url = match result_data.pointer("/result/output_url").and_then(|u| u.as_str()) {
        Some(u) => u.to_string(),
        None => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Hasil upscale tidak ditemukan"),
    };

    // 4. Download upscaled image
    let final_res = match dl
        .get(&output_url)
        .header("User-Agent", UA_DESKTOP)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let mut content_type = final_res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    if !content_type.starts_with("image/") {
        content_type = "image/jpeg".to_string();
    }
    let image = match final_res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type)
        .header("Content-Length", image.len().to_string())
        .body(axum::body::Body::from(image))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

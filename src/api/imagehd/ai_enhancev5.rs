// AI Enhance HD v5 — native conversion of api/imagehd/ai-enhancev5.js
// photiu.ai single POST multipart -> image bytes back.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_URL: &str = "https://www.photiu.ai/api/tools/img_improve";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

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

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
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
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal download gambar: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal download gambar: {e}")),
    };

    let filename = format!(
        "upscale-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let part = match reqwest::multipart::Part::bytes(image_buffer)
        .file_name(filename)
        .mime_str("image/png")
    {
        Ok(p) => p,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let form = reqwest::multipart::Form::new().part("upfile", part);

    let res = client
        .post(API_URL)
        .header("X-Paramsjs", r#"{"mode":"upscale","level":"default"}"#)
        .header("User-Agent", BROWSER_UA)
        .multipart(form)
        
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let status = res.status().as_u16();
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let params_header = res
        .headers()
        .get("x-paramsjs")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("{}")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string()).unwrap_or_default().to_vec();

    if status != 200 {
        let msg = String::from_utf8_lossy(&bytes);
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("photiu.ai returned {status}: {msg}"),
        );
    }

    let params: Value = serde_json::from_str(&params_header).unwrap_or(json!({}));
    if params.get("error_code").and_then(|c| c.as_i64()) != Some(0) {
        let msg = params
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown");
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("photiu.ai error: {msg}"),
        );
    }
    if !ct.contains("image") {
        let text = String::from_utf8_lossy(&bytes);
        let preview: String = text.chars().take(200).collect();
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Unexpected response type {ct}: {preview}"),
        );
    }

    let task_id = params
        .get("task_id")
        .map(|t| t.to_string().trim_matches('"').to_string())
        .unwrap_or_default();

    bin_response(
        bytes,
        "image/jpeg",
        &[
            ("X-Enhance-Service", "photiu-v5".to_string()),
            ("X-Task-Id", task_id),
        ],
    )
}

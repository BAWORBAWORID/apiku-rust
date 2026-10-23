// SparkPix HD Upscale — native conversion of api/imagehd/sparkpix.js
// sparkpix.ai free-hd-upscale API: POST imageUrl -> resultUrl.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API: &str = "https://sparkpix.ai/api/free-hd-upscale";
const REFERER: &str = "https://sparkpix.ai/aitools/free-hd-upscaler";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

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

fn parse_quality(input: &str) -> (String, String) {
    let raw: String = input.to_lowercase().split_whitespace().collect();
    if raw == "8k" || raw == "4" || raw == "4x" {
        ("8K".to_string(), "4".to_string())
    } else if raw == "6k" || raw == "3" || raw == "3x" {
        ("6K".to_string(), "3".to_string())
    } else {
        ("4K".to_string(), "2".to_string())
    }
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
    let quality_raw = params.get("quality").and_then(|v| v.as_str()).unwrap_or("4k").to_string();
    let face_raw = params
        .get("face")
        .and_then(|v| v.as_str())
        .unwrap_or("false")
        .to_lowercase();
    let face_enhance = ["true", "1", "yes"].contains(&face_raw.as_str());

    let (quality_label, scale) = parse_quality(&quality_raw);
    let started = std::time::Instant::now();

    let cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match cl
        .post(API)
                    .header("Content-Type", "application/json")
                    .header("accept", "*/*")
                    .header("origin", "https://sparkpix.ai")
        .header("referer", REFERER)
        .header("user-agent", UA)
        .json(&json!({
            "imageUrl": url,
            "scale": scale,
            "face_enhance": face_enhance
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let status_code = res.status().as_u16();
    let json_data: Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let success = json_data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let result_url = json_data.get("resultUrl").and_then(|r| r.as_str()).map(|s| s.to_string());
    if !success || result_url.is_none() {
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            &json!({ "status_code": status_code, "response": json_data }).to_string(),
        );
    }
    let result_url = result_url.unwrap();
    let download_url = format!(
        "https://sparkpix.ai/api/download-image?url={}",
        urlencoding::encode(&result_url)
    );
    let processing_time = json_data
        .get("processingTime")
        .and_then(|p| p.as_i64())
        .unwrap_or(started.elapsed().as_millis() as i64);

    Json(json!({
        "status": true,
        "quality": quality_label,
        "scale": format!("{scale}x"),
        "result": result_url,
        "download": download_url
    })).into_response()

}

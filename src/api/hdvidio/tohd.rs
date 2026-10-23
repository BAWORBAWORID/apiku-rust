// ToHD Video Upscaler — native conversion of api/hdvidio/tohd.js
// Pure HTTP: GET image.pollinations.ai/prompt/<prompt> and stream the image bytes back.
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

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

fn p_str<'a>(p: &'a Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        p.get(*k).and_then(|v| v.as_str()).map(|s| s.to_string())
    })
}

fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default()
}

fn bytes_response(ct: &str, bytes: bytes::Bytes) -> Response {
    (StatusCode::OK, [(header::CONTENT_TYPE, ct.to_string())], bytes).into_response()
}

// HD Video Processor — native conversion of api/hdvidio/tohd.js.
// Node version memakai fluent-ffmpeg untuk memproses video upload (scale, fps,
// sharpen, denoise, dll). Konversi native memerlukan ffmpeg lokal / crate video
// encoder, jadi versi ini jujur menolak.
const RESOLUTIONS: [&str; 6] = ["480p", "720p", "1080p", "1440p", "4k", "8k"];

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    if params.get("video").is_none() {
        return jerr(StatusCode::BAD_REQUEST, "Parameter 'video' wajib diisi (upload file)");
    }
    if let Some(res) = params.get("resolution").and_then(|v| v.as_str()) {
        if !RESOLUTIONS.contains(&res) {
            return jerr(
                StatusCode::BAD_REQUEST,
                &format!("Invalid resolution. Allowed: {}", RESOLUTIONS.join(", ")),
            );
        }
    }
    jerr(
        StatusCode::INTERNAL_SERVER_ERROR,
        "butuh ffmpeg lokal, belum didukung native",
    )
}

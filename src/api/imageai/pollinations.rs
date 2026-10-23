// Pollinations AI Image — native conversion of api/imageai/pollinations.js
// Pure HTTP: GET image.pollinations.ai/prompt/<prompt> and stream the image bytes back.
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

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let prompt = match p_str(&params, &["prompt"]) {
        Some(p) if !p.trim().is_empty() => p,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'prompt' wajib diisi"),
    };
    if prompt.len() > 1000 {
        return jerr(StatusCode::BAD_REQUEST, "Prompt terlalu panjang (maksimal 1000 karakter)");
    }
    let prompt = prompt.trim().to_string();

    let url = format!(
        "https://image.pollinations.ai/prompt/{}?width=1024&height=1024&seed=42&nologo=true",
        urlencoding::encode(&prompt)
    );

    let client = http_client(90);
    let res = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_timeout() {
                "Timeout mengambil gambar dari Pollinations".to_string()
            } else {
                format!("Gagal generate gambar: {e}")
            };
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &msg);
        }
    };

    let ct = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    match res.bytes().await {
        Ok(bytes) => bytes_response(&ct, bytes),
        Err(e) => jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal generate gambar: {e}")),
    }
}

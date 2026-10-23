// Strom-AI Text to Image — native conversion of api/imageai/strom-img.js
// POST https://strom-ai.my.id/api/text2img -> data:image base64 (returned as bytes)
// or a plain imageUrl (returned as JSON like Node).
use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use base64::Engine as _;

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

const BASE: &str = "https://strom-ai.my.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let raw = match p_str(&params, &["prompt", "text", "teks"]) {
        Some(p) if !p.trim().is_empty() => p,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'prompt' wajib diisi"),
    };

    let client = http_client(90);
    let res = match client
        .post(format!("{BASE}/api/text2img"))
        .header("origin", BASE)
        .header("referer", format!("{BASE}/"))
        .json(&json!({ "prompt": raw.trim() }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP request gagal: {e}")),
    };

    if !res.status().is_success() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP {}", res.status().as_u16()));
    }

    let data: Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Response bukan JSON: {e}")),
    };

    if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, err);
    }
    let image_url = match data.get("imageUrl").and_then(|v| v.as_str()) {
        Some(u) => u.to_string(),
        None => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Tidak ada imageUrl di response"),
    };

    // data:image base64 -> kirim langsung bytes (Node mengonversi ke JPG via sharp;
    // versi native mengembalikan bytes asli tanpa konversi)
    if let Some(rest) = image_url.strip_prefix("data:image/") {
        if let Some(b64) = rest.split(";base64,").nth(1) {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                let ct_src = rest.split(';').next().unwrap_or("png");
                let ct = format!("image/{ct_src}");
                return bytes_response(&ct, bytes.into());
            }
        }
    }

    Json(json!({ "status": true, "result": image_url })).into_response()
}

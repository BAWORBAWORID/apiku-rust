// Text2Image (Pollinations) — native conversion of api/imageai/text2image.js
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

// FreeGen text2image: signer -> generator (job_id) -> hasil lewat WebSocket bridge.
// Langkah signer & generator pure HTTP; hasil dikirim via WebSocket sehingga
// versi native jujur belum mendukung langkah terakhir.
const SIGNER_URL: &str = "https://prompt-signer.freegen.app";
const GENERATOR_URL: &str = "https://image-generator.freegen.app";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

fn browser_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("content-type", "application/json".parse().unwrap());
    h.insert("origin", "https://freegen.app".parse().unwrap());
    h.insert("referer", "https://freegen.app/".parse().unwrap());
    h.insert("accept-language", "id-ID,id;q=0.9".parse().unwrap());
    h
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, _body: Option<Json<Value>>) -> Response {
    let teks = match query.get("teks") {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'teks' wajib diisi"),
    };
    let ratio = query.get("ratio").cloned().unwrap_or_else(|| "1:1".into());

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .default_headers(browser_headers())
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    let signer: Value = match client.post(SIGNER_URL).json(&json!({ "prompt": teks })).send().await {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Signer gagal: {e}")),
        },
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Signer gagal: {e}")),
    };
    let (ts, sig) = (
        signer.get("ts").cloned().unwrap_or(Value::Null),
        signer.get("sig").cloned().unwrap_or(Value::Null),
    );
    if ts.is_null() || sig.is_null() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Signer gagal");
    }

    let gen: Value = match client
        .post(GENERATOR_URL)
        .json(&json!({ "prompt": teks, "ts": ts, "sig": sig, "ratio_id": ratio }))
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("job_id tidak ditemukan: {e}")),
        },
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("job_id tidak ditemukan: {e}")),
    };
    let job_id = gen.get("job_id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if job_id.is_empty() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "job_id tidak ditemukan");
    }

    // Hasil dikirim via wss://websocket-bridge.freegen.app/ws (subscribe job_id).
    // Client Rust belum punya dependency WebSocket, jadi jujur belum didukung native.
    let _ = job_id;
    jerr(
        StatusCode::INTERNAL_SERVER_ERROR,
        "butuh WebSocket client (websocket-bridge), belum didukung native",
    )
}

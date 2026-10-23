// Text to Image v3 (Baidu Ernie via HF Space) — native conversion of api/imageai/text2imgv3.js
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

const SPACE_URL: &str = "https://baidu-ernie-image-turbo.hf.space";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("accept", "*/*".parse().unwrap());
    h.insert("accept-language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h.insert("origin", "https://upsampler.com".parse().unwrap());
    h.insert("referer", "https://upsampler.com/".parse().unwrap());
    h
}

fn extract_url(output: &Value) -> String {
    let text = serde_json::to_string(output).unwrap_or_default();
    let full_re = regex::Regex::new(r#"https://baidu-ernie-image-turbo\.hf\.space/gradio_api/file=[^"'\\\s]+"#).unwrap();
    if let Some(m) = full_re.captures(&text) {
        return m.get(0).unwrap().as_str().replace(r"\u0026", "&").replace(r"\/", "/");
    }
    let url_field = regex::Regex::new(r#""url":"(https?://[^"]+)""#).unwrap();
    if let Some(m) = url_field.captures(&text) {
        return m.get(1).unwrap().as_str().replace(r"\u0026", "&").replace(r"\/", "/");
    }
    let path_re = regex::Regex::new(r#"/tmp/gradio/[^"'\\\s]+?\.(webp|png|jpg|jpeg)"#).unwrap();
    if let Some(m) = path_re.captures(&text) {
        return format!("https://baidu-ernie-image-turbo.hf.space/gradio_api/file={}", m.get(0).unwrap().as_str());
    }
    String::new()
}



async fn gradio_generate(client: &reqwest::Client, data: Value, fn_index: i64) -> Result<bytes::Bytes, String> {
    let session_hash = random_hex(16);
    let join_res = client
        .post(format!("{SPACE_URL}/gradio_api/queue/join?"))
                    .header("content-type", "application/json")
                    .header("x-gradio-user", "api")
        .json(&json!({
            "data": data,
            "event_data": Value::Null,
            "fn_index": fn_index,
            "trigger_id": Value::Null,
            "session_hash": session_hash
        }))
        .send()
        .await
        .map_err(|e| format!("queue join gagal: {e}"))?;
    let join: Value = join_res
        .json()
        .await
        .map_err(|e| format!("event_id tidak ditemukan: {e}"))?;
    let event_id = join
        .get("event_id")
        .and_then(|v| v.as_str())
        .ok_or("event_id tidak ditemukan")?
        .to_string();

    let mut stream = client
        .get(format!("{SPACE_URL}/gradio_api/queue/data?session_hash={session_hash}"))
                    .header("accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| format!("queue data gagal: {e}"))?;

    let mut buffer = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(240);

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err("Timeout".into());
        }
        let chunk = match tokio::time::timeout(std::time::Duration::from_secs(60), stream.chunk()).await {
            Ok(Ok(Some(c))) => c,
            Ok(Ok(None)) => return Err("Stream selesai tanpa hasil".into()),
            Ok(Err(e)) => return Err(format!("stream error: {e}")),
            Err(_) => return Err("Timeout".into()),
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buffer.find("\n\n") {
            let block: String = buffer.drain(..pos + 2).collect();
            let data_line = block
                .lines()
                .find(|l| l.starts_with("data: "))
                .map(|l| l.trim_start_matches("data: ").trim().to_string());
            let Some(raw) = data_line else { continue };
            if raw.is_empty() || raw == "[DONE]" { continue }
            let Ok(j) = serde_json::from_str::<Value>(&raw) else { continue };
            if let Some(eid) = j.get("event_id").and_then(|v| v.as_str()) {
                if eid != event_id { continue }
            }
            match j.get("msg").and_then(|m| m.as_str()) {
                Some("process_completed") => {
                    let url = extract_url(j.get("output").unwrap_or(&Value::Null));
                    if url.is_empty() {
                        return Err("URL hasil tidak ditemukan".into());
                    }
                    let img = client
                        .get(&url)
                        .send()
                        .await
                        .map_err(|e| format!("download hasil gagal: {e}"))?;
                    return img
                        .bytes()
                        .await
                        .map_err(|e| format!("download hasil gagal: {e}"));
                }
                Some("process_failed") => return Err("Generate gagal".into()),
                _ => {}
            }
        }
    }
}
pub async fn handler(Query(query): Query<HashMap<String, String>>, _body: Option<Json<Value>>) -> Response {
    let teks = match query.get("teks") {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'teks' wajib diisi"),
    };
    let prompt = teks.trim().to_string();

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .default_headers(base_headers())
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    let data = json!([prompt, "1024x1024", -1, true]);
    match gradio_generate(&client, data, 1).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "image/webp".to_string()),
                (header::HeaderName::from_static("x-image-generator"), "Baidu Ernie Image Turbo".to_string()),
                (header::HeaderName::from_static("x-prompt"), prompt),
                (header::HeaderName::from_static("cache-control"), "public, max-age=86400".to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

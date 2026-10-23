// FreeForAI Image Generator — native conversion of api/imageai/freeforai.js
// Submit form-urlencoded task ke cook.aizdzj.com, poll task_status, return JSON url.
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

const BASE_URL: &str = "https://cook.aizdzj.com";
const REFERER: &str = "https://draw.freeforai.com/";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const MODELS: [&str; 2] = ["flux-dev", "flux-kontext"];
const SIZES: [&str; 3] = ["1024*1024", "1024*576", "576*1024"];

fn rand_alnum(n: usize) -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..n).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let prompt = match p_str(&params, &["prompt"]) {
        Some(p) if !p.trim().is_empty() => p,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'prompt' wajib"),
    };
    let model = p_str(&params, &["model"]).unwrap_or_else(|| "flux-dev".into());
    let size = p_str(&params, &["size"]).unwrap_or_else(|| "1024*1024".into());

    if !MODELS.contains(&model.as_str()) {
        return jerr(StatusCode::BAD_REQUEST, &format!("Model tidak tersedia. Pilihan: {}", MODELS.join(", ")));
    }
    if !SIZES.contains(&size.as_str()) {
        return jerr(StatusCode::BAD_REQUEST, &format!("Size tidak tersedia. Pilihan: {}", SIZES.join(", ")));
    }

    let client = http_client(60);
    let img_name = format!("ref-{}{}", chrono::Utc::now().timestamp_millis(), rand_alnum(8));
    let submit_body = format!(
        "prompt={}&size={}&model={}&influence=100&image_name={}",
        urlencoding::encode(prompt.trim()),
        size,
        model,
        img_name
    );

    let submit_text = match client
        .post(format!("{BASE_URL}/draw/text2image.php"))
        .header("referer", REFERER)
                    .header("origin", "https://draw.freeforai.com")
                    .header("content-type", "application/x-www-form-urlencoded")
        .body(submit_body)
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal membaca response: {e}")),
        },
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Request gagal: {e}")),
    };

    let task_re = regex::Regex::new(r#""task_id"\s*:\s*"([^"]+)""#).unwrap();
    let task_id = match task_re.captures(&submit_text).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => {
            let head: String = submit_text.chars().take(200).collect();
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("No task_id in response: {head}"));
        }
    };

    let status_re = regex::Regex::new(r#""task_status"\s*:\s*"([^"]+)""#).unwrap();
    let url_re = regex::Regex::new(r#""url"\s*:\s*"([^"]+)""#).unwrap();

    for _ in 1..=45 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let poll_text = match client
            .post(format!("{BASE_URL}/draw/text2image.php"))
            .header("referer", REFERER)
                        .header("origin", "https://draw.freeforai.com")
                        .header("content-type", "application/x-www-form-urlencoded")
            .body(format!("task_id={task_id}"))
            .send()
            .await
        {
            Ok(r) => match r.text().await {
                Ok(t) => t,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let status = status_re.captures(&poll_text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
        match status.as_deref() {
            Some("SUCCEEDED") => {
                let url = url_re
                    .captures(&poll_text)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().replace('\\', ""))
                    .unwrap_or_default();
                if url.is_empty() {
                    return jerr(StatusCode::INTERNAL_SERVER_ERROR, "No URL in response");
                }
                return Json(json!({
                    "status": true,
                    "result": { "prompt": prompt.trim(), "model": model, "size": size, "task_id": task_id, "url": url }
                }))
                .into_response();
            }
            Some("FAILED") => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Generation failed"),
            _ => {}
        }
    }

    jerr(StatusCode::INTERNAL_SERVER_ERROR, "Timeout: Generation took too long")
}

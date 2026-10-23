// GStory AI Image Generator — native conversion of api/imageai/gstory.js
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

const BASE: &str = "https://www.gstory.ai";
const API: &str = "https://www.gstory.ai/api/service_v3";
const SALT: &str = "8rJHEd9vbPs=";
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

fn djb2(value: &str) -> String {
    let mut hash: u32 = 5381;
    for b in value.bytes() {
        hash = hash.wrapping_add(hash.wrapping_shl(5)).wrapping_add(b as u32);
    }
    format!("{hash:08x}")
}

fn generate_device_id() -> (String, String) {
    let salt = random_hex(16);
    let parts = [
        "1920x1080x24",
        "1920x1080",
        "1",
        "UTC",
        "0",
        "en-US",
        "en-US",
        "Linux x86_64",
        UA,
        "8",
        "0",
        "0",
        "",
        "data:image/png;base64,iVBORw0KGgo=",
        "",
        salt.as_str(),
    ];
    let raw = parts.join("|");
    let a = djb2(&raw);
    let rev: String = raw.chars().rev().collect();
    let b = djb2(&rev);
    let c = djb2(&format!("{raw}{a}"));
    let d = djb2(&format!("{b}{raw}"));
    let device_id = format!(
        "{}-{}-{}-{}-{}",
        &a[..8],
        &b[..4],
        &c[..4],
        &d[..4],
        &format!("{a}{b}{c}")[..12]
    );
    (device_id, salt)
}

fn md5_hex(data: &str) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

fn serialize(value: &Value) -> String {
    match value {
        Value::Array(a) => format!("[{}]", a.iter().map(serialize).collect::<Vec<_>>().join(",")),
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), serialize(&o[k.as_str()])))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn normalize(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Array(_) | Value::Object(_) => serialize(value),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
    }
}

fn make_sign(payload: &serde_json::Map<String, Value>) -> String {
    let mut keys: Vec<&String> = payload
        .iter()
        .filter(|(k, v)| k.as_str() != "sign" && !v.is_null() || k.as_str() != "sign")
        .map(|(k, _)| k)
        .collect();
    keys.sort();
    keys.retain(|k| k.as_str() != "sign" && !payload[k.as_str()].is_null());
    let data = keys
        .iter()
        .map(|k| format!("{}={}", k, normalize(&payload[k.as_str()])))
        .collect::<Vec<_>>()
        .join("&");
    md5_hex(&format!("{data}{SALT}"))
}

fn build_payload(extra: Value) -> Value {
    let mut payload = json!({
        "packageName": "ai.gstory.web",
        "appVersion": "3.10.6",
        "language": "en",
        "countryCode": "en",
        "region": "en",
        "deviceType": UA,
        "timestamp": chrono::Utc::now().timestamp(),
        "udid": random_hex(32),
        "timezone": "UTC 0",
        "platform": "web",
        "signVersion": "2.0",
        "token": Value::Null,
    });
    if let (Value::Object(base), Value::Object(ext)) = (&mut payload, &extra) {
        for (k, v) in ext {
            base.insert(k.clone(), v.clone());
        }
    }
    if let Value::Object(o) = &mut payload {
        let sign = make_sign(o);
        o.insert("sign".to_string(), Value::String(sign));
    }
    payload
}

async fn post(path: &str, extra: Value, cookie: &str, client: &reqwest::Client) -> Value {
    let body = build_payload(extra);
    let res = client
        .post(format!("{API}{path}"))
        .header("cookie", cookie)
        .json(&body)
        .send()
        .await;
    match res {
        Ok(r) => r.json::<Value>().await.unwrap_or(json!({ "code": 500, "message": "invalid response" })),
        Err(e) => json!({ "code": 500, "message": format!("GStory request error: {e}") }),
    }
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let prompt = p_str(&params, &["prompt"]).unwrap_or_default().trim().to_string();
    let style = {
        let s = p_str(&params, &["style"]).unwrap_or_else(|| "realistic".into());
        if s.trim().is_empty() { "realistic".to_string() } else { s.trim().to_string() }
    };
    let ratio = {
        let s = p_str(&params, &["ratio"]).unwrap_or_else(|| "1:1".into());
        if s.trim().is_empty() { "1:1".to_string() } else { s.trim().to_string() }
    };

    if prompt.is_empty() {
        return jerr(StatusCode::BAD_REQUEST, "Parameter prompt wajib diisi");
    }
    if prompt.len() > 500 {
        return jerr(StatusCode::BAD_REQUEST, "Prompt maksimal 500 karakter");
    }

    let client = http_client(120);
    let (device_id, salt) = generate_device_id();
    let cookie = format!("deviceId={device_id}; deviceSalt={salt}; region=en");

    let free = post("/user/get_free_attempts", json!({}), &cookie, &client).await;
    if free.get("code").and_then(|c| c.as_i64()) != Some(200) {
        let msg = free
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("GStory free attempts check failed");
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, msg);
    }

    let batch_id = random_hex(32);
    let task_id = random_hex(32);
    let submitted = post(
        "/x2i_v2/batch_submit_v2",
        json!({
            "batchId": batch_id,
            "language": "en",
            "tasks": [{
                "downstreamTaskId": task_id,
                "serviceKind": "t2i",
                "modelKey": "image_fast_v1.0",
                "styleKey": style,
                "originalPrompt": prompt,
                "ratio": ratio,
                "seed": -1,
                "language": "en",
                "originalPromptLanguage": "en"
            }]
        }),
        &cookie,
        &client,
    )
    .await;

    if submitted.get("code").and_then(|c| c.as_i64()) != Some(200) {
        let msg = submitted
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("GStory image submission failed");
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, msg);
    }

    let business_task_id = submitted
        .pointer("/data/tasks/0/businessTaskId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if business_task_id.is_empty() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "GStory task ID missing");
    }

    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let queried = post(
            "/x2i_v2/query_v2",
            json!({ "tasks": [{ "businessTaskId": business_task_id, "includeFileDetails": true }], "language": "en" }),
            &cookie,
            &client,
        )
        .await;
        let task = queried.get("data").and_then(|d| d.get(0)).cloned().unwrap_or(json!({}));
        match task.get("taskStatus").and_then(|s| s.as_str()) {
            Some("SUCCEEDED") => {
                let url = task
                    .pointer("/resultFileInfo/fileUrl")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let thumb = task
                    .pointer("/resultFileInfo/fileThumbUrl")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let free_remaining = free.pointer("/data/t2iRemaining").cloned();
                let url = match url {
                    Some(u) => u,
                    None => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "GStory result URL missing"),
                };
                return Json(json!({
                    "status": true,
                    "result": { "prompt": prompt, "style": style, "ratio": ratio, "url": url, "thumb": thumb, "free_remaining": free_remaining }
                }))
                .into_response();
            }
            Some("FAILED") | Some("CANCELED") => {
                let st = task.get("taskStatus").and_then(|s| s.as_str()).unwrap_or("failed").to_lowercase();
                return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("GStory task {st}"));
            }
            _ => {}
        }
    }

    jerr(StatusCode::INTERNAL_SERVER_ERROR, "GStory image generation timeout")
}

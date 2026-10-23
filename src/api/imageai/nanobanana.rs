// NanoBanana (Gemini 2.5 Flash Image) — native conversion of api/imageai/nanobanana.js
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

const BASE_URL: &str = "https://nanobanana.io";
const MAILTM: &str = "https://api.mail.tm";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

fn rand_alnum(n: usize) -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..n).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("accept", "application/json, text/plain, */*".parse().unwrap());
    h.insert("origin", BASE_URL.parse().unwrap());
    h.insert("referer", format!("{BASE_URL}/create").parse().unwrap());
    h
}

async fn get_domain(client: &reqwest::Client) -> Result<String, String> {
    let v: Value = client
        .get(format!("{MAILTM}/domains?page=1"))
        .send()
        .await
        .map_err(|e| format!("mail.tm domains gagal: {e}"))?
        .json()
        .await
        .map_err(|e| format!("mail.tm domains bukan JSON: {e}"))?;
    let domains = v.get("hydra:member").cloned().unwrap_or(v);
    if let Some(arr) = domains.as_array() {
        for d in arr {
            if d.get("isActive").and_then(|a| a.as_bool()).unwrap_or(false) {
                if let Some(name) = d.get("domain").and_then(|x| x.as_str()) {
                    return Ok(name.to_string());
                }
            }
        }
        if let Some(name) = arr.first().and_then(|d| d.get("domain")).and_then(|x| x.as_str()) {
            return Ok(name.to_string());
        }
    }
    Err("No mail.tm domains available".into())
}

/// Provision session cookie string: csrf -> tempmail -> magic-link -> extract token -> callback.
/// Step ini butuh menjalankan full session flow seperti Node; di Rust cookie-jar reqwest
/// menangani set-cookie, jadi flow-nya pure HTTP.
async fn provision_session(client: &reqwest::Client) -> Result<String, String> {
    // 1. CSRF
    let csrf_res = client
        .get(format!("{BASE_URL}/api/auth/csrf"))
        .send()
        .await
        .map_err(|e| format!("Gagal dapat CSRF Token: {e}"))?;

    let csrf_json: Value = csrf_res
        .json()
        .await
        .map_err(|e| format!("Gagal dapat CSRF Token: {e}"))?;
    let csrf_token = csrf_json
        .get("csrfToken")
        .and_then(|v| v.as_str())
        .ok_or("Gagal dapat CSRF Token")?
        .to_string();

    // 2. Temp email (mail.tm)
    let domain = get_domain(client).await?;
    let local = rand_alnum(7);
    let email = format!("{local}@{domain}");
    let password = rand_alnum(8);
    client
        .post(format!("{MAILTM}/accounts"))
        .json(&json!({ "address": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("mail.tm create failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("mail.tm create failed: {e}"))?;
    let tok: Value = client
        .post(format!("{MAILTM}/token"))
        .json(&json!({ "address": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("mail.tm token failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("mail.tm token failed: {e}"))?;
    let mail_token = tok
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or("mail.tm token hilang")?
        .to_string();

    // 3. Magic link
    client
        .post(format!("{BASE_URL}/api/auth/magic-link"))
        .json(&json!({ "email": email }))
        .send()
        .await
        .map_err(|e| format!("magic-link gagal: {e}"))?;

    // 4. Poll inbox untuk token verifikasi
    let token_re = regex::Regex::new(r"(?i)token=([a-zA-Z0-9_\-.]+)").unwrap();
    let mut verify_token: Option<String> = None;
    for _ in 0..15 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let inbox: Value = match client
            .get(format!("{MAILTM}/messages"))
            .bearer_auth(&mail_token)
            .send()
            .await
        {
            Ok(r) => match r.json().await {
                Ok(v) => v,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        if let Some(msgs) = inbox.get("hydra:member").and_then(|v| v.as_array()) {
            if let Some(first) = msgs.first() {
                let msg_id = first.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                if let Ok(detail) = client
                    .get(format!("{MAILTM}/messages/{msg_id}"))
                    .bearer_auth(&mail_token)
                    .send()
                    .await
                {
                    if let Ok(d) = detail.json::<Value>().await {
                        let html = d
                            .get("html")
                            .and_then(|h| h.as_array())
                            .and_then(|a| a.first())
                            .and_then(|s| s.as_str())
                            .or_else(|| d.get("text").and_then(|s| s.as_str()))
                            .unwrap_or("");
                        if let Some(m) = token_re.captures(html) {
                            verify_token = Some(m.get(1).unwrap().as_str().to_string());
                            break;
                        }
                    }
                }
            }
        }
    }
    let verify_token = verify_token.ok_or("Timeout menunggu email verifikasi")?;

    // 5. Callback magic-link -> session cookies
    client
        .post(format!("{BASE_URL}/api/auth/callback/magic-link"))
                    .header("content-type", "application/x-www-form-urlencoded")
        .body(format!(
            "token={}&csrfToken={}&json=true",
            urlencoding::encode(&verify_token),
            urlencoding::encode(&csrf_token)
        ))
        .send()
        .await
        .map_err(|e| format!("callback gagal: {e}"))?;

    // reqwest cookie store sudah menyimpan session cookie, kembalikan marker
    Ok(email)
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let prompt = match p_str(&params, &["prompt"]) {
        Some(p) if !p.trim().is_empty() => p,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'prompt' wajib diisi"),
    };
    let ratio = p_str(&params, &["ratio"]).unwrap_or_else(|| "1:1".into());
    let resolution = p_str(&params, &["resolution"]).unwrap_or_else(|| "1K".into());

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .cookie_store(true)
        .default_headers(base_headers())
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    if let Err(e) = provision_session(&client).await {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }

    // 6. Create task
    let create_res = match client
        .post(format!("{BASE_URL}/api/task/create"))
                    .header("content-type", "application/json")
        .json(&json!({
            "model": "nano-banana",
            "prompt": prompt.trim(),
            "params": { "aspect_ratio": ratio, "max_images": 1, "resolution": resolution }
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("task create gagal: {e}")),
    };
    let create_data: Value = match create_res.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("task create bukan JSON: {e}")),
    };

    let prediction_id = ["data.predictionId", "predictionId", "data.taskId"]
        .iter()
        .find_map(|path| {
            let mut cur: Option<&Value> = Some(&create_data);
            for part in path.split('.') {
                cur = cur.and_then(|v| v.get(part));
            }
            cur.and_then(|v| v.as_str()).map(|s| s.to_string())
        })
        .unwrap_or_default();
    if prediction_id.is_empty() {
        let msg = create_data
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Gagal membuat task");
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, msg);
    }

    // 7. Poll task
    let mut result: Option<Value> = None;
    for _ in 0..35 {
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        let check: Value = match client
            .post(format!("{BASE_URL}/api/task/check"))
                        .header("content-type", "application/json")
            .json(&json!({ "predictionId": prediction_id }))
            .send()
            .await
        {
            Ok(r) => match r.json().await {
                Ok(v) => v,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let d = check.get("data");
        if let Some(res) = d.and_then(|d| d.get("result")).and_then(|r| r.as_array()) {
            if !res.is_empty() {
                result = Some(res.clone().into());
                break;
            }
        }
        if d.and_then(|d| d.get("state")).and_then(|s| s.as_str()) == Some("failed") {
            let msg = d
                .and_then(|d| d.get("failMsg"))
                .and_then(|m| m.as_str())
                .unwrap_or("Generasi gagal");
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, msg);
        }
    }

    let result = match result {
        Some(r) => r,
        None => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Timeout menunggu hasil"),
    };

    let url = result
        .get(0)
        .map(|item| {
            item.as_str()
                .map(|s| s.to_string())
                .or_else(|| item.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
        })
        .flatten()
        .unwrap_or_default();

    let img_res = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "Gagal download gambar hasil"),
    };
    match img_res.bytes().await {
        Ok(bytes) => {
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "image/png".to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        "inline; filename=\"nanobanana.png\"".to_string(),
                    ),
                    (header::HeaderName::from_static("x-source-url"), url.clone()),
                ],
                bytes,
            )
                .into_response()
        }
        Err(e) => jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal download gambar hasil: {e}")),
    }
}

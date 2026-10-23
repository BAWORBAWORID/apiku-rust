// AISeek Image Generator — native conversion of api/imageai/aiseek.js
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

const APP_ID: &str = "ai-seek";
const PKG: &str = "ai.chatbot.ask.chat.deep.seek.assistant.search.free";
const VER: &str = "2.9.4-26071777";
const UA: &str = "Zyvor/1.0";

fn uuid_v7() -> String {
    let ts = format!("{:012x}", chrono::Utc::now().timestamp_millis());
    let rnd = random_hex(10);
    format!("{}-{}-7{}-{}-{}", &ts[..8], &ts[8..12], &rnd[1..4], &rnd[4..8], &rnd[8..20])
}

fn random_uuid() -> String {
    let h = random_hex(32);
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

fn dev_info(aid: &str) -> String {
    format!(
        "appIdentifier={PKG};appVersion={VER};deviceType=android;deviceCountry=ID;appCountry=id;local=id_ID;language=id;timezone=Asia/Makassar;brand=Infinix;model=Infinix%20X6833B;androidId={aid}"
    )
}

struct Auth {
    token: String,
    aid: String,
}

async fn get_session(client: &reqwest::Client) -> Result<Auth, String> {
    let aid: String = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..8).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
    };
    let sec = random_uuid();

    let token_res: Value = client
        .post("https://saas.castbox.fm/auth/api/v1/tokens/provider/secret")
        .header("x-app-id", APP_ID)
        .json(&json!({ "secret": sec }))
        .send()
        .await
        .map_err(|e| format!("Auth failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Auth failed: {e}"))?;

    let token = token_res
        .pointer("/data/token")
        .and_then(|v| v.as_str())
        .ok_or("Auth failed")?
        .to_string();
    let uid = token_res.pointer("/data/uid").cloned().unwrap_or(Value::Null);

    // Device registration (best-effort, seperti Node .catch(() => {}))
    let _ = client
        .post("https://saas.castbox.fm/device/api/v1/devices")
        .header("x-app-id", APP_ID)
        .header("x-device-info", dev_info(&aid))
        .header("x-access-token", &token)
        .json(&json!({
            "androidId": aid,
            "appIdentifier": PKG,
            "appVersion": VER,
            "brand": "Infinix",
            "deviceCountry": "ID",
            "deviceId": random_uuid(),
            "deviceType": "android",
            "language": "id",
            "locale": "id_ID",
            "model": "Neo X11",
            "pushType": "FCM",
            "timezone": "Asia/Makassar",
            "uid": uid,
            "deviceToken": "dpCJFZRhTTmTk_OIFoAG1i:APA91bHr4X9Dg9RpFJvlo9Cd23-OwK2Q3ifFtu5UZ-5WQo5MvohowARyMpYuG4fdLWu9syjIKU9j97ra_V8sPzhkLvmTw3B38KRIvTZ-QHj42UjNRu9BAUo",
            "firebaseAppInstanceId": random_hex(32)
        }))
        .send()
        .await;

    Ok(Auth { token, aid })
}

fn parse_sse(text: &str) -> (String, Vec<String>) {
    let mut text_out = String::new();
    let mut imgs: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let t = line.trim();
        let Some(data) = t.strip_prefix("data:") else { continue };
        let s = data.trim();
        if s.is_empty() || s == "[DONE]" {
            continue;
        }
        let Ok(p) = serde_json::from_str::<Value>(s) else { continue };
        if let Some(c) = p.get("content").and_then(|v| v.as_str()) {
            text_out.push_str(c);
        }
        if let Some(arr) = p.get("images").and_then(|v| v.as_array()) {
            for img in arr {
                if let Some(u) = img.as_str() {
                    imgs.push(u.to_string());
                }
            }
        }
    }
    (text_out.trim().to_string(), imgs)
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let prompt = match p_str(&params, &["prompt"]) {
        Some(p) if !p.trim().is_empty() => p,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'prompt' wajib"),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    let auth = match get_session(&client).await {
        Ok(a) => a,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let payload = json!({
        "sessionId": uuid_v7(),
        "userMessageId": uuid_v7(),
        "aiMessageId": uuid_v7(),
        "model": "image-generation-guru",
        "text": prompt,
        "restrictedType": "FREE_USER",
        "sessionType": "IMAGE"
    });

    let res = client
        .post("https://ai-seek.thebetter.ai/v4/chat/send")
                    .header("accept", "text/event-stream")
        .header("x-app-id", APP_ID)
        .header("x-device-info", dev_info(&auth.aid))
        .header("x-access-token", &auth.token)
        .json(&payload)
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("AI Seek request failed: {e}")),
    };

    let full = match res.text().await {
        Ok(t) => t,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("AI Seek request failed: {e}")),
    };

    let (caption, images) = parse_sse(&full);
    Json(json!({ "status": true, "result": { "prompt": prompt, "images": images, "caption": caption } })).into_response()
}

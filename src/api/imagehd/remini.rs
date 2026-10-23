// Remini HD — native conversion of api/imagehd/remini.js
// remini.ai mobile API: oracle setup (token) -> create task -> PUT upload -> process -> poll -> download.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const API: &str = "https://a.android.api.remini.ai/v1/mobile";
const ORACLE: &str = "https://api.remini.ai/v1/mobile/oracle";

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

fn random_uuid() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let hex: String = (0..32).map(|_| format!("{:02x}", rng.gen::<u8>())).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

struct Device {
    android_id: String,
    aaid: String,
    backup_persistent_id: String,
    non_backup_persistent_id: String,
}

fn gen_device() -> Device {
    let a: String = random_uuid().replace('-', "");
    Device {
        android_id: a[..16].to_string(),
        aaid: random_uuid(),
        backup_persistent_id: format!("{}_com.bigwinepot.nwdn.international", &a[..16.min(a.len())]),
        non_backup_persistent_id: random_uuid(),
    }
}

fn base_headers(dev: &Device) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("bsp-id", "com.bigwinepot.nwdn.international.android".parse().unwrap());
    h.insert("build-number", "202514479".parse().unwrap());
    h.insert("build-version", "3.7.1020".parse().unwrap());
    h.insert("country", "US".parse().unwrap());
    h.insert("device-manufacturer", "Samsung".parse().unwrap());
    h.insert("device-model", "SM-G998B".parse().unwrap());
    h.insert("device-type", "6.8".parse().unwrap());
    h.insert("language", "en".parse().unwrap());
    h.insert("locale", "en_US".parse().unwrap());
    h.insert("os-version", "33".parse().unwrap());
    h.insert("platform", "Android".parse().unwrap());
    h.insert("timezone", "America/New_York".parse().unwrap());
    h.insert("android-id", dev.android_id.parse().unwrap());
    h.insert("aaid", dev.aaid.parse().unwrap());
    h.insert("accept-encoding", "gzip".parse().unwrap());
    h.insert("user-agent", "okhttp/4.12.0".parse().unwrap());
    h
}

fn auth_headers(dev: &Device, token: &str) -> reqwest::header::HeaderMap {
    let mut h = base_headers(dev);
    h.insert("identity-token", token.parse().unwrap());
    h
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn auth(dev: &Device) -> Result<String, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let res = cl
        .post(format!("{ORACLE}/setup"))
        .headers(base_headers(dev))
        .header(
            "first-install-timestamp",
            format!("{}E9", now_secs()),
        )
        .header("backup-persistent-id", dev.backup_persistent_id.clone())
        .header("non-backup-persistent-id", dev.non_backup_persistent_id.clone())
                    .header("environment", "Production")
                    .header("settings-response-version", "v2")
                    .header("is-app-running-in-background", "false")
                    .header("is-old-user", "true")
                    .header("app-set-id", "d44bd45a-a45d-4470-9674-7348a8e3fb71")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let token = data
        .pointer("/settings/__identity__/token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No token".to_string())?;

    // touch users/@me like Node
    cl.get(format!("{API}/users/@me"))
        .headers(auth_headers(dev, &token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(token)
}

fn md5_b64(data: &[u8]) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(data);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, hasher.finalize())
}

async fn remini_hd(image_path: &str, dev: &Device, token: &str) -> Result<String, String> {
    let cont = std::fs::read(image_path).map_err(|_| "File not found".to_string())?;
    let ext = image_path.rsplit('.').next().unwrap_or("jpg").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    let md5_hash = md5_b64(&cont);
    let meta = json!({ "size": cont.len() });

    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;

    let task_res = cl
        .post(format!("{API}/tasks"))
        .headers(auth_headers(dev, token))
                    .header("content-type", "application/json; charset=UTF-8")
        .json(&json!({
            "image_content_type": mime,
            "image_md5": md5_hash,
            "feature": { "type": "enhance", "models": [] },
            "metadata": meta,
            "options": { "high_quality_output": false, "save_input": true },
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let task_data: Value = task_res.json().await.map_err(|e| e.to_string())?;
    let task_id = task_data
        .get("task_id")
        .and_then(|t| t.as_str())
        .ok_or("Task response invalid")?
        .to_string();
    let upload_url = task_data
        .get("upload_url")
        .and_then(|u| u.as_str())
        .ok_or("Task response invalid")?
        .to_string();

    // Upload binary
    let upload_headers: reqwest::header::HeaderMap = task_data
        .get("upload_headers")
        .and_then(|h| h.as_object())
        .map(|obj| {
            let mut hm = reqwest::header::HeaderMap::new();
            for (k, v) in obj {
                if let (Ok(name), Ok(val)) = (
                    k.parse::<reqwest::header::HeaderName>(),
                    v.as_str().unwrap_or("").parse::<reqwest::header::HeaderValue>(),
                ) {
                    hm.insert(name, val);
                }
            }
            hm
        })
        .unwrap_or_default();

    let up_cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    up_cl
        .put(&upload_url)
        .headers(upload_headers)
                    .header("User-Agent", "okhttp/4.12.0")
        .body(cont)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    cl.post(format!("{API}/tasks/{task_id}/process"))
        .headers(auth_headers(dev, token))
                    .header("content-length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Poll
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let pr = cl
            .get(format!("{API}/tasks/{task_id}"))
            .headers(auth_headers(dev, token))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let pd: Value = pr.json().await.unwrap_or(Value::Null);
        if pd.get("status").and_then(|s| s.as_str()) == Some("completed") {
            let url = pd
                .pointer("/result/outputs/0/url")
                .and_then(|u| u.as_str())
                .map(|s| s.to_string());
            if let Some(u) = url {
                return Ok(u);
            }
            break;
        }
        let st = pd.get("status").and_then(|s| s.as_str()).unwrap_or("");
        if st == "failed" || st == "error" {
            return Err("Task failed".to_string());
        }
    }
    Err("No output URL".to_string())
}

fn ext_from_url(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "bmp" => {
            if ext == "jpeg" { "jpg".to_string() } else { ext }
        }
        _ => "jpg".to_string(),
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

    let run = async {
        let cl = reqwest::Client::builder()
            
            .build()
            .map_err(|e| e.to_string())?;
        let dl = cl
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let bytes = dl.bytes().await.map_err(|e| e.to_string())?.to_vec();

        let safe_ext = ext_from_url(&url);
        let tmp = std::env::temp_dir().join(format!(
            "remini_{}_{}.{}",
            now_secs(),
            rand::Rng::gen_range(&mut rand::thread_rng(), 1000..9999),
            safe_ext
        ));
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;

        let dev = gen_device();
        let result = async {
            let token = auth(&dev).await?;
            remini_hd(tmp.to_str().unwrap_or(""), &dev, &token).await
        }
        .await;
        let _ = std::fs::remove_file(&tmp);
        result
    };

    let out_url = match run.await {
        Ok(u) => u,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let dl_cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match dl_cl.get(&out_url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let buffer = match res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    Response::builder()
        .status(StatusCode::OK)
                    .header("Content-Type", "image/jpeg")
        .header("Content-Length", buffer.len().to_string())
                    .header("X-Enhance-Service", "remini-ai")
        .body(axum::body::Body::from(buffer))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

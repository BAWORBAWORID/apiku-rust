// AI Enhance HD — native conversion of api/imagehd/ai-enhance.js
// thinkyeah.com async enhance: download image -> submit base64 -> poll task -> return image bytes.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://aiapi.thinkyeah.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn rand_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn uuid_v4() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut b = [0u8; 16];
    for x in b.iter_mut() {
        *x = rng.gen();
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{:02x}", x)).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

fn identity_json() -> Value {
    json!({
        "adid": uuid_v4(),
        "dcid": uuid_v4(),
        "is_pro_user": "false",
        "region": "ID",
        "language": "in",
        "app_version_code": "2310",
        "package_name": "photoeditor.photocut.background.eraser.collagemaker.cutout",
        "purchase_token": "",
        "firebase_user_id": rand_hex(32),
        "is_internal_user": "false"
    })
}

fn app_headers() -> Vec<(&'static str, &'static str)> {
    vec![
        ("accept", "application/json"),
        ("content-type", "application/json; charset=utf-8"),
        ("user-agent", "okhttp/4.11.0"),
    ]
}

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn bin_response(bytes: Vec<u8>, content_type: &str, extra: &[(&str, String)]) -> Response {
    let mut b = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type);
    for (k, v) in extra {
        b = b.header(*k, v);
    }
    b.body(axum::body::Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn download_bytes(client: &reqwest::Client, url: &str) -> Result<(Vec<u8>, String), String> {
    let res = client
        .get(url)
        .header("User-Agent", UA)
        
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let ct = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok((bytes, ct))
}

fn identity_query(identity: &Value) -> Vec<(String, String)> {
    let mut pairs: Vec<(String, String)> = identity
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        v.as_str().unwrap_or(&v.to_string()).to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    pairs.push(("request_id".into(), uuid_v4()));
    pairs
}

async fn enhance_image(
    client: &reqwest::Client,
    base64_data: &str,
    identity: &Value,
) -> Option<String> {
    let payload = json!({
        "upscale": "2",
        "is_upscale": "true",
        "model": "default",
        "imagedata": base64_data
    });

    let mut req = client
        .post(format!("{BASE_URL}/api/enhance/async"))
        .query(&identity_query(identity))
        .json(&payload);
    for (k, v) in app_headers() {
        req = req.header(k, v);
    }
    let data: Value = req
        
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    if data.get("code").and_then(|c| c.as_i64()) == Some(200) {
        data.pointer("/data/task_id")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())
    } else {
        None
    }
}

async fn get_result(
    client: &reqwest::Client,
    task_id: &str,
    identity: &Value,
) -> Result<Value, String> {
    let max_attempts = 30; // ~45s at 1.5s interval
    for _ in 0..max_attempts {
        let mut pairs: Vec<(String, String)> = identity
            .as_object()
            .map(|m| {
                m.iter()
                    .map(|(k, v)| (k.clone(), v.as_str().unwrap_or(&v.to_string()).to_string()))
                    .collect()
            })
            .unwrap_or_default();
        pairs.push(("task_id".into(), task_id.to_string()));

        let mut req = client.get(format!("{BASE_URL}/api/task/query")).query(&pairs);
        for (k, v) in app_headers() {
            req = req.header(k, v);
        }
        if let Ok(res) = req
            
            .send()
            .await
        {
            if let Ok(data) = res.json::<Value>().await {
                let status = data
                    .pointer("/data/status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if status == "success" {
                    return Ok(data.pointer("/data/result").cloned().unwrap_or(Value::Null));
                }
                if status == "fail" {
                    return Err("Proses enhance gagal".to_string());
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    }
    Err("Timeout proses enhance".to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    // Merge query + JSON body
    let url_param = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });

    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };

    let client = match reqwest::Client::builder().user_agent("okhttp/4.11.0").build() {
        Ok(c) => c,
        Err(e) => {
            return jerr(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Gagal memproses AI enhance: client error {e}"),
            )
        }
    };

    let identity = identity_json();

    // 1. Download image -> base64
    let (image_bytes, _) = match download_bytes(&client, &url).await {
        Ok(v) => v,
        Err(_) => {
            return jerr(
                StatusCode::BAD_REQUEST,
                "Gagal mendownload gambar dari URL yang diberikan",
            )
        }
    };
    use base64::Engine;
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&image_bytes);

    // 2. Create enhance job
    let task_id = match enhance_image(&client, &base64_data, &identity).await {
        Some(t) => t,
        None => {
            return jerr(
                StatusCode::BAD_GATEWAY,
                "Gagal membuat task enhance. Server sedang sibuk.",
            )
        }
    };

    // 3. Poll for result
    let result = match get_result(&client, &task_id, &identity).await {
        Ok(r) => r,
        Err(e) => {
            if e.contains("Timeout") {
                return jerr(
                    StatusCode::GATEWAY_TIMEOUT,
                    "Proses enhance memakan waktu terlalu lama. Coba gambar lain.",
                );
            }
            if e.contains("Proses enhance gagal") {
                return jerr(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Server gagal memproses enhance gambar",
                );
            }
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e);
        }
    };

    let output_url = result
        .get("result_url")
        .or_else(|| result.get("url"))
        .or_else(|| result.get("output_url"))
        .and_then(|u| u.as_str())
        .unwrap_or("");

    if output_url.is_empty() {
        return jerr(
            StatusCode::INTERNAL_SERVER_ERROR,
            "URL hasil enhance tidak ditemukan",
        );
    }

    // 4. Download enhanced image and return buffer
    let (bytes, ct) = match download_bytes(&client, output_url).await {
        Ok(v) => v,
        Err(_) => return jerr(StatusCode::GATEWAY_TIMEOUT, "Timeout mengambil gambar"),
    };

    let content_type = if ct.starts_with("image/") { ct.as_str() } else { "image/jpeg" };

    bin_response(
        bytes,
        content_type,
        &[
            ("X-Enhance-Service", "thinkyeah".to_string()),
            ("X-Task-ID", task_id),
        ],
    )
}

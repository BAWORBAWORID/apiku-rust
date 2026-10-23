// SaveUs AIO Downloader (saveus.biz.id) — native conversion of api/downloader/saveus.js
// Flow: POST /api/analyze → per format: POST /api/download/start → SSE progress
// (data: {type:done|error|cancelled}) via /api/download/progress/<jobId> →
// file URL /api/download/file/<jobId>. Concurrency 3, random X-Forwarded-For.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use reqwest::header;

const BASE: &str = "https://www.saveus.biz.id";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CONCURRENCY: usize = 3;

const IP_RANGES: [(u32, u32); 10] = [
    (0x01010000, 0x010101fe),
    (0x08080000, 0x0808fffe),
    (0x2e000000, 0x2effffff),
    (0x3e000000, 0x3effffff),
    (0x5e000000, 0x5effffff),
    (0x77000000, 0x77ffffff),
    (0x7b000000, 0x7bffffff),
    (0x8c000000, 0x8cffffff),
    (0x9b000000, 0x9bffffff),
    (0xb9000000, 0xb9ffffff),
];

fn random_ip() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let (lo, hi) = IP_RANGES[rng.gen_range(0..IP_RANGES.len())];
    let ip = lo + rng.gen_range(0..=(hi - lo));
    format!("{}.{}.{}.{}", (ip >> 24) & 0xff, (ip >> 16) & 0xff, (ip >> 8) & 0xff, ip & 0xff)
}

fn base_headers(cookie: Option<&str>, accept: &'static str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: String| reqwest::header::HeaderValue::from_str(&v).unwrap();
    h.insert("User-Agent", mk(UA.to_string()));
    h.insert("Accept", mk(accept.to_string()));
    h.insert("Accept-Language", mk("id-ID,id;q=0.9,en;q=0.8".to_string()));
    h.insert("Origin", mk(BASE.to_string()));
    h.insert("Referer", mk(format!("{BASE}/")));
    h.insert("X-Forwarded-For", mk(random_ip()));
    if let Some(c) = cookie {
        if !c.is_empty() {
            h.insert("Cookie", mk(c.to_string()));
        }
    }
    h
}

async fn analyze(client: &reqwest::Client, link: &str) -> Result<(Value, String), String> {
    let resp = client
        .post(format!("{BASE}/api/analyze"))
        .headers(base_headers(None, "application/json, text/plain, */*"))
        .json(&json!({ "url": link }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let cookie: String = resp
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|c| c.split(';').next())
        .collect::<Vec<_>>()
        .join("; ");
    let text = resp.text().await.unwrap_or_default();
    let json: Value = serde_json::from_str(&text).map_err(|_| {
        format!("Response bukan JSON (HTTP {status}): {}", text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect::<String>())
    })?;
    if status != 200 || !json.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        let err = json.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()).unwrap_or(format!("Gagal menganalisis URL (HTTP {status})"));
        return Err(err.to_string());
    }
    Ok((json.get("data").cloned().unwrap_or(Value::Null), cookie))
}

async fn start_job(client: &reqwest::Client, data: &Value, typ: &str, fmt: &Value, link: &str, cookie: &str) -> Result<String, String> {
    let mut body = json!({
        "url": data.get("url").cloned().unwrap_or(json!(link)),
        "type": typ,
        "videoId": data.get("videoId").cloned().unwrap_or(Value::Null),
        "_key": data.get("_key").cloned().unwrap_or(Value::Null),
        "bitrate": fmt.get("bitrate").cloned().unwrap_or(json!(192)),
        "formatId": fmt.get("formatId").cloned().unwrap_or(Value::Null)
    });
    if typ == "video" {
        body["quality"] = fmt.get("quality").cloned().unwrap_or(Value::Null);
    }
    let resp = client
        .post(format!("{BASE}/api/download/start"))
        .headers(base_headers(Some(cookie), "application/json, text/plain, */*"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let json: Value = resp.json().await.unwrap_or(Value::Null);
    if status != 200 || !json.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        return Err(json.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()).unwrap_or_else(|| format!("Gagal memulai download (HTTP {status})")));
    }
    json.get("jobId").and_then(|j| j.as_str()).map(|s| s.to_string()).ok_or_else(|| "jobId tidak ada".into())
}

async fn wait_job(client: &reqwest::Client, job_id: &str, cookie: &str) -> Result<(), String> {
    let resp = client
        .get(format!("{BASE}/api/download/progress/{}", urlencoding::encode(job_id)))
        .headers(base_headers(Some(cookie), "text/event-stream"))
        
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Koneksi progress gagal (HTTP {})", resp.status().as_u16()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    for line in text.split('\n') {
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let m: Value = match serde_json::from_str(line[5..].trim()) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match m.get("type").and_then(|t| t.as_str()) {
            Some("done") => return Ok(()),
            Some("error") => return Err(m.get("message").and_then(|x| x.as_str()).unwrap_or("Download gagal").into()),
            Some("cancelled") => return Err("Download dibatalkan server".into()),
            _ => {}
        }
    }
    Err("Koneksi progress terputus sebelum selesai".into())
}

fn label_of(fmt: &Value, kind: &str) -> String {
    if kind == "video" {
        fmt.get("displayName").and_then(|v| v.as_str()).map(|s| s.to_string())
            .or_else(|| fmt.get("height").and_then(|h| h.as_u64()).map(|h| {
                let fps = fmt.get("fps").and_then(|f| f.as_u64()).unwrap_or(0);
                if fps > 0 { format!("{h}p {fps}fps") } else { format!("{h}p") }
            }))
            .or_else(|| fmt.get("quality").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .or_else(|| fmt.get("label").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| "video".into())
    } else {
        fmt.get("bitrate").and_then(|b| b.as_u64()).map(|b| format!("{b}kbps"))
            .or_else(|| fmt.get("label").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| "audio".into())
    }
}

async fn process_format(client: &reqwest::Client, data: &Value, typ: &str, fmt: &Value, link: &str, cookie: &str) -> Value {
    let size = fmt.get("size").and_then(|s| s.as_f64()).filter(|s| *s >= 256.0).map(|s| s as u64);
    let mut item = json!({
        "type": typ,
        "label": label_of(fmt, typ),
        "formatId": fmt.get("formatId").cloned().unwrap_or(Value::Null),
        "container": fmt.get("container").cloned().unwrap_or(Value::Null),
        "height": fmt.get("height").cloned().unwrap_or(Value::Null),
        "fps": fmt.get("fps").cloned().unwrap_or(Value::Null),
        "bitrate": fmt.get("bitrate").cloned().unwrap_or(Value::Null),
        "size": size
    });
    let job_res = match start_job(client, data, typ, fmt, link, cookie).await {
        Ok(job) => match wait_job(client, &job, cookie).await {
            Ok(_) => Ok(job),
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    };
    match job_res {
        Ok(job_id) => {
            item["file_url"] = json!(format!("{BASE}/api/download/file/{}", urlencoding::encode(&job_id)));
        }
        Err(e) => {
            item["error"] = json!(e);
        }
    }
    item
}

async fn run_pool(client: &reqwest::Client, data: &Value, link: &str, cookie: &str) -> Vec<Value> {
    let mut tasks: Vec<(String, Value)> = Vec::new();
    for f in data.get("videoFormats").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        tasks.push(("video".into(), f));
    }
    for f in data.get("audioFormats").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        tasks.push(("audio".into(), f));
    }

    let next = Arc::new(AtomicUsize::new(0));
    let results = Arc::new(std::sync::Mutex::new(Vec::new()));
    let total = tasks.len();

    let mut workers = Vec::new();
    for _ in 0..CONCURRENCY.min(total.max(1)) {
        let next = next.clone();
        let results = results.clone();
        let tasks = tasks.clone();
        let client = client.clone();
        let data = data.clone();
        let link = link.to_string();
        let cookie = cookie.to_string();
        workers.push(tokio::spawn(async move {
            loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= tasks.len() {
                    break;
                }
                let (typ, fmt) = tasks[i].clone();
                let item = process_format(&client, &data, &typ, &fmt, &link, &cookie).await;
                results.lock().unwrap_or_else(|e| e.into_inner()).push(item);
            }
        }));
    }
    for w in workers {
        let _ = w.await;
    }
    let res = results.lock().unwrap_or_else(|e| e.into_inner()).clone();
    res
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let link = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();
    if link.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi."
        }))).into_response();
    }
    if !(link.starts_with("http://") || link.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL tidak valid. Harus diawali https://"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    match analyze(&client, &link).await {
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e
        }))).into_response(),
        Ok((data, cookie)) => {
            let has_video = data.get("videoFormats").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
            let has_audio = data.get("audioFormats").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
            if !has_video && !has_audio {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Tidak ada format yang tersedia untuk URL ini."
                }))).into_response();
            }
            let results = run_pool(&client, &data, &link, &cookie).await;
            let duration_ms = data.get("duration").and_then(|d| d.as_u64()).unwrap_or(0);
            let duration_fmt = data.get("durationFormatted").and_then(|d| d.as_str()).map(|s| s.to_string()).unwrap_or_else(|| {
                let total = duration_ms / 1000;
                format!("{}:{:02}", total / 60, total % 60)
            });
            let success = results.iter().filter(|r| r.get("file_url").is_some()).count();
            Json(json!({
                "status": true,
                "result": {
                    "source": link,
                    "title": data.get("title").cloned().unwrap_or(Value::Null),
                    "author": data.get("author").cloned().unwrap_or(Value::Null),
                    "platform": data.get("platform").cloned().unwrap_or(Value::Null),
                    "duration": duration_fmt,
                    "thumbnail": data.get("thumbnail").cloned().or_else(|| data.get("thumbnailFallback").cloned()).unwrap_or(Value::Null),
                    "total": results.len(),
                    "success": success,
                    "video": results.iter().filter(|r| r.get("type").and_then(|t| t.as_str()) == Some("video")).cloned().collect::<Vec<_>>(),
                    "audio": results.iter().filter(|r| r.get("type").and_then(|t| t.as_str()) == Some("audio")).cloned().collect::<Vec<_>>()
                }
            }))
            .into_response()
        }
    }
}

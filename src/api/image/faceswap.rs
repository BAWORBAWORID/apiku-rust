// Ghibli Style Generator — native conversion of api/image/gibli.js
// Full native flow: download image → base64 data URL → ghibli-proxy netlify
// function (gpt-image-1) → decode b64_json or fetch result URL → PNG bytes.
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

fn merged(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Value {
    let mut m = json!({});
    if let Some(Json(b)) = body {
        if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } }
    }
    for (k, v) in query { m[k] = json!(v); }
    m
}

fn str_param(m: &Value, key: &str) -> Option<String> {
    match m.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap_or_default()
}

fn dl_client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap_or_default()
}

fn detect_mime(buf: &[u8]) -> &'static str {
    if buf.len() >= 3 && buf[0] == 0xff && buf[1] == 0xd8 { "image/jpeg" }
    else if buf.len() >= 2 && buf[0] == 0x89 && buf[1] == 0x50 { "image/png" }
    else if buf.len() >= 4 && &buf[0..4] == b"RIFF" { "image/webp" }
    else if buf.len() >= 3 && &buf[0..3] == b"GIF" { "image/gif" }
    else { "image/jpeg" }
}

fn ext_from(mime: &str) -> &'static str {
    match mime { "image/png" => "png", "image/webp" => "webp", _ => "jpg" }
}

fn mime_of(ext: &str) -> &'static str {
    match ext { "png" => "image/png", "webp" => "image/webp", _ => "image/jpeg" }
}

fn is_img_response(r: &Result<reqwest::Response, reqwest::Error>) -> bool {
    match r {
        Ok(resp) => resp.status().is_success() && resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|c| c.starts_with("image/")).unwrap_or(false),
        Err(_) => false,
    }
}

fn img_response(content_type: &str, buf: &[u8], extra: &[(&str, String)]) -> Response {
    let mut hh = HeaderMap::new();
    if let (Ok(k), Ok(v)) = (
        reqwest::header::HeaderName::from_bytes(b"Content-Type"),
        reqwest::header::HeaderValue::from_str(content_type),
    ) { hh.insert(k, v); }
    for (k, v) in extra {
        if let (Ok(kn), Ok(vv)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(v),
        ) { hh.insert(kn, vv); }
    }
    (StatusCode::OK, hh, buf.to_vec()).into_response()
}

fn err_json(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

// FaceSwap — native conversion of api/image/faceswap.js
// akool.cf: token → upload face/target images → create face swap task → poll
// by task id → result img url → bytes. Direct only.
const FS_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async fn get_fs_token() -> Result<String, String> {
    let res = client().get("https://akool.cf/openapi/token")
        .header("User-Agent", FS_UA)
        .send().await.map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    j.pointer("/data/token").and_then(|v| v.as_str()).map(|s| s.to_string())
        .or_else(|| j.get("token").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .ok_or_else(|| "Gagal mendapatkan token faceswap".into())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(source) = str_param(&m, "source").filter(|s| !s.is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'source' wajib diisi", "code": "MISSING_SOURCE"}))).into_response();
    };
    let Some(target) = str_param(&m, "target").filter(|s| !s.is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'target' wajib diisi", "code": "MISSING_TARGET"}))).into_response();
    };
    let token = match get_fs_token().await {
        Ok(t) => t,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e, "code": "TOKEN_ERROR"}))).into_response(),
    };
    // upload both images
    async fn upload_one(client_token: &str, url: &str, kind: String) -> Result<String, String> {
        let img = dl_client().get(url).send().await.map_err(|e| e.to_string())?;
        if !img.status().is_success() { return Err(format!("Gagal mengunduh gambar {}", kind)); }
        let buf = img.bytes().await.map_err(|e| e.to_string())?.to_vec();
        let mime = detect_mime(&buf);
        let part = reqwest::multipart::Part::bytes(buf).file_name(format!("{}.jpg", kind)).mime_str(mime).unwrap();
        let form = reqwest::multipart::Form::new().part("image", part).text("type", kind.clone());
        let res = client().post("https://akool.cf/openapi/face-swaps/api/v1/img/upload")
            .header("User-Agent", FS_UA)
            .header("Authorization", format!("Bearer {}", client_token))
            .multipart(form)
            .send().await.map_err(|e| e.to_string())?;
        let j: Value = res.json().await.unwrap_or(Value::Null);
        let uid = j.pointer("/data/img_id").and_then(|v| v.as_str())
            .or_else(|| j.pointer("/data/_id").and_then(|v| v.as_str()))
            .or_else(|| j.get("img_id").and_then(|v| v.as_str()));
        uid.map(|s| s.to_string()).ok_or_else(|| format!("Gagal upload gambar {}: {}", kind, j))
    }
    let source_id = match upload_one(&token, &source, "source_face".to_string()).await {
        Ok(i) => i,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e, "code": "UPLOAD_FAILED"}))).into_response(),
    };
    let target_id = match upload_one(&token, &target, "target_face".to_string()).await {
        Ok(i) => i,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e, "code": "UPLOAD_FAILED"}))).into_response(),
    };
    // create task
    let payload = json!({
        "params": {
            "source_image": source_id,
            "target_image": target_id,
            "face_enhance": 1,
            "from": "openapi",
            "tool_id": "1"
        }
    });
    let create = client().post("https://akool.cf/openapi/face-swaps/api/v1/img/create")
        .header("User-Agent", FS_UA)
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send().await;
    let create = match create {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let s = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();
            return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": format!("Gagal membuat task: {}", body.chars().take(200).collect::<String>()), "code": "CREATE_FAILED", "http_status": s}))).into_response();
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string(), "code": "NETWORK_ERROR"}))).into_response(),
    };
    let cj: Value = create.json().await.unwrap_or(Value::Null);
    let Some(task_id) = cj.pointer("/data/task_id").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))) else {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Gagal membuat task faceswap", "code": "NO_TASK_ID"}))).into_response();
    };
    // poll up to 30 x 3s
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let poll = client().get(format!("https://akool.cf/openapi/face-swaps/api/v1/img/status?task_id={}", task_id))
            .header("User-Agent", FS_UA)
            .header("Authorization", format!("Bearer {}", token))
            .send().await;
        let Ok(r) = poll else { continue };
        let Ok(j) = r.json::<Value>().await else { continue };
        let st = j.pointer("/data/status").and_then(|v| v.as_i64()).unwrap_or(0);
        if st == 2 {
            let Some(img_url) = j.pointer("/data/img_url").or_else(|| j.pointer("/data/url")).and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Task selesai tapi URL hasil tidak ditemukan", "code": "NO_RESULT_URL"}))).into_response();
            };
            let dl = dl_client().get(&img_url).send().await;
            let bytes = match dl {
                Ok(r) if r.status().is_success() => r.bytes().await.unwrap_or_default().to_vec(),
                _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Gagal mengunduh hasil", "code": "DOWNLOAD_FAILED"}))).into_response(),
            };
            return img_response("image/jpeg", &bytes, &[("X-Task-ID", task_id.clone()), ("X-Processor", "faceswap".to_string())]);
        }
        if st == 3 || st == 4 {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": "Proses faceswap gagal di upstream", "code": "TASK_FAILED", "upstream_status": st}))).into_response();
        }
    }
    (StatusCode::GATEWAY_TIMEOUT, Json(json!({"status": false, "message": "Faceswap timeout setelah ~90 detik", "code": "TIMEOUT"}))).into_response()
}

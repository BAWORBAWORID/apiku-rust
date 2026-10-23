// AI Upscale Video — native conversion of api/hdvidio/ai-upscale-vidio.js
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

// Video Upscale AI — native conversion of api/hdvidio/ai-upscale-vidio.js.
// Pure HTTP flow: download video -> register upload -> PUT ke OSS -> create job
// -> poll -> download hasil. Semua upstream unblurimage.ai, tidak perlu ffmpeg lokal.
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const RESOLUTIONS: [&str; 5] = ["480p", "720p", "1080p", "2k", "4k"];

fn resolution_info(res: &str) -> String {
    match res {
        "480p" => "SD (480p) - Standard Definition".to_string(),
        "720p" => "HD (720p) - High Definition".to_string(),
        "1080p" => "Full HD (1080p) - Full High Definition".to_string(),
        "2k" => "QHD (2K) - Quad High Definition".to_string(),
        "4k" => "UHD (4K) - Ultra High Definition".to_string(),
        _ => res.to_string(),
    }
}

fn api_headers(serial: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("accept", "*/*".parse().unwrap());
    h.insert("product-serial", serial.parse().unwrap());
    h.insert("origin", "https://unblurimage.ai".parse().unwrap());
    h.insert("referer", "https://unblurimage.ai/".parse().unwrap());
    h.insert("sec-fetch-mode", "cors".parse().unwrap());
    h.insert("sec-fetch-site", "same-site".parse().unwrap());
    h
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, _body: Option<Json<Value>>) -> Response {
    let url = match query.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    let resolution = query.get("resolution").cloned().unwrap_or_else(|| "1080p".into());
    if !RESOLUTIONS.contains(&resolution.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": format!("Resolusi tidak valid. Pilih salah satu: {}", RESOLUTIONS.join(", ")),
            "validResolutions": RESOLUTIONS
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    // 1. Download video
    let video_res = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => return jerr(StatusCode::GATEWAY_TIMEOUT, "Timeout saat mendownload video"),
        Err(_) => return jerr(StatusCode::NOT_FOUND, "Video tidak ditemukan"),
    };
    let ct = video_res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !ct.contains("video/") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "URL harus mengarah ke file video",
            "contentType": if ct.is_empty() { "unknown".to_string() } else { ct }
        }))).into_response();
    }
    let video_bytes = match video_res.bytes().await {
        Ok(b) => b,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendownload video: {e}")),
    };
    let size_mb = video_bytes.len() as f64 / (1024.0 * 1024.0);
    if size_mb > 100.0 {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Ukuran video terlalu besar. Maksimal 100MB",
            "currentSize": format!("{:.2}MB", size_mb),
            "maxSize": "100MB"
        }))).into_response();
    }

    // 2. Serial & headers
    use md5::{Digest, Md5};
    use rand::Rng;
    let serial = {
        let mut h = Md5::new();
        h.update(format!("{UA}{}", chrono::Utc::now().timestamp_millis()));
        hex::encode(h.finalize())
    };
    let file_name = {
        let mut rng = rand::thread_rng();
        format!(
            "{}_video.mp4",
            (0..3).map(|_| format!("{:02x}", rng.gen::<u8>())).collect::<String>()
        )
    };
    let api_headers = api_headers(&serial);

    // 3. Register upload URL
    let reg_form = reqwest::multipart::Form::new().part(
        "video_file_name",
        reqwest::multipart::Part::text(file_name.clone()),
    );
    let reg: Value = match client
        .post("https://api.unblurimage.ai/api/upscaler/v1/ai-video-enhancer/upload-video")
        .headers(api_headers.clone())
        .multipart(reg_form)
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal mendapatkan upload URL: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal mendapatkan upload URL: {e}")),
    };
    let oss_url = reg.pointer("/result/url").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let object_name = reg.pointer("/result/object_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if oss_url.is_empty() || object_name.is_empty() {
        return jerr(StatusCode::BAD_GATEWAY, "Gagal mendapatkan upload URL");
    }

    // 4. Upload video ke OSS
    if let Err(e) = client
        .put(&oss_url)
        .header("content-type", if ct.is_empty() { "video/mp4".to_string() } else { ct.clone() })
        .body(video_bytes)
        .send()
        .await
    {
        return jerr(StatusCode::BAD_GATEWAY, &format!("Upload video gagal: {e}"));
    }

    // 5. Create upscale job
    let job_form = reqwest::multipart::Form::new()
        .part("original_video_file", reqwest::multipart::Part::text(format!("https://cdn.unblurimage.ai/{object_name}")))
        .part("resolution", reqwest::multipart::Part::text(resolution.clone()))
        .part("is_preview", reqwest::multipart::Part::text("false"));
    let create: Value = match client
        .post("https://api.unblurimage.ai/api/upscaler/v2/ai-video-enhancer/create-job")
        .headers(api_headers.clone())
        .multipart(job_form)
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal membuat job upscale: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal membuat job upscale: {e}")),
    };
    let job_id = create.pointer("/result/job_id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if job_id.is_empty() {
        return jerr(StatusCode::BAD_GATEWAY, "Gagal membuat job upscale");
    }

    // 6. Polling (maks 10 menit, interval 5 detik)
    let mut output_url = String::new();
    let mut attempts = 0usize;
    while attempts < 120 {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        attempts += 1;
        let check: Value = match client
            .get(format!("https://api.unblurimage.ai/api/upscaler/v2/ai-video-enhancer/get-job/{job_id}"))
            .headers(api_headers.clone())
            .send()
            .await
        {
            Ok(r) => match r.json().await {
                Ok(v) => v,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        if let Some(out) = check.pointer("/result/output_url").and_then(|v| v.as_str()) {
            output_url = out.to_string();
            break;
        }
        if matches!(
            check.pointer("/result/status").and_then(|v| v.as_str()),
            Some("error") | Some("failed")
        ) {
            let msg = check.pointer("/result/message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": "Proses upscale video gagal",
                "detail": msg
            }))).into_response();
        }
    }
    if output_url.is_empty() {
        return jerr(StatusCode::GATEWAY_TIMEOUT, "Proses upscale video terlalu lama. Coba dengan resolusi lebih rendah atau video lebih pendek.");
    }

    // 7. Download hasil
    let final_res = match client.get(&output_url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Download hasil gagal: {e}")),
    };
    let result_ct = final_res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();
    let result_ct = if result_ct.starts_with("video/") { result_ct } else { "video/mp4".to_string() };
    match final_res.bytes().await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, result_ct),
                (
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"upscaled_{resolution}_{file_name}\""),
                ),
                (header::HeaderName::from_static("x-video-processor"), "unblurimage.ai".to_string()),
                (header::HeaderName::from_static("x-resolution"), resolution.clone()),
                (header::HeaderName::from_static("x-resolution-info"), resolution_info(&resolution)),
                (header::HeaderName::from_static("x-job-id"), job_id),
                (header::HeaderName::from_static("x-original-size-mb"), format!("{size_mb:.2}")),
                (header::HeaderName::from_static("x-processing-attempts"), (attempts + 1).to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Download hasil gagal: {e}")),
    }
}

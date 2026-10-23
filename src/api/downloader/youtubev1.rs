// YouTube Downloader V2 (ssyou.online) — native conversion of api/downloader/youtubev1.js
// Upstream flow: POST detail page → nonce/videoId/formats → submit merge job →
// monitor via WEBSOCKET until render done → get proxied URL.
// Catatan native: HTTP steps dikonversi penuh, tapi step monitor render butuh
// WebSocket client (tokio-tungstenite tidak ada di Cargo.toml apiku-rs), jadi
// endpoint ini mengembalikan error jujur jika job sukses dibuat tapi perlu WS.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0";

fn base_headers() -> Vec<(&'static str, &'static str)> {
    vec![
        ("User-Agent", UA),
        ("Accept", "*/*"),
        ("Accept-Language", "en-US,en;q=0.9"),
        ("Origin", "https://ssyou.online"),
        ("Referer", "https://ssyou.online/yt-video-detail/"),
        ("X-Requested-With", "XMLHttpRequest"),
    ]
}

fn allowed_quality(q: &str) -> bool {
    ["mp3", "144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"].contains(&q)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "quality"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };
    let q_raw = merged.get("quality").map(|s| s.to_lowercase()).unwrap_or_else(|| "720p".into());
    if !allowed_quality(&q_raw) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Kualitas tidak valid. Gunakan: mp3, 144p, 240p, 360p, 480p, 720p, 1080p, 1440p, 2160p"
        }))).into_response();
    }
    let is_audio = q_raw == "mp3";
    let res_key = if is_audio { "MP3".to_string() } else { q_raw.clone() };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    // Step 1: detail page
    let html = match client
        .post("https://ssyou.online/yt-video-detail/")
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .headers(base_headers().into_iter().map(|(k, v)| (reqwest::header::HeaderName::from_bytes(k.as_bytes()).unwrap(), reqwest::header::HeaderValue::from_str(v).unwrap())).collect::<reqwest::header::HeaderMap>())
        .body(format!("videoURL={}", urlencoding::encode(&url)))
        .send()
        .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mendapatkan Nonce/VideoID: {e}")
        }))).into_response(),
    };

    let nonce = html
        .split("'X-WP-Nonce':")
        .nth(1)
        .and_then(|s| s.split('\'').nth(1))
        .map(|s| s.to_string());
    let video_id = html
        .split("name=\"video_id\" value=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .map(|s| s.to_string());
    let title = html
        .split("videoTitle")
        .nth(1)
        .and_then(|s| s.split('>').nth(1))
        .and_then(|s| s.split('<').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "video".into());

    let (nonce, video_id) = match (nonce, video_id) {
        (Some(n), Some(v)) if !n.is_empty() && !v.is_empty() => (n, v),
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Gagal mendapatkan Nonce/VideoID."
        }))).into_response(),
    };

    // Step 2: formats
    let mut formats: HashMap<String, String> = HashMap::new();
    if let Some(seg) = html.split("let cachedFormatUrls = ").nth(1) {
        if let Some(obj) = seg.split(';').next() {
            let mut rest = obj;
            while let Some(p) = rest.find("'") {
                let after = &rest[p + 1..];
                let key = match after.split('\'').next() {
                    Some(k) => k.to_string(),
                    None => break,
                };
                let after2 = match after.splitn(3, '\'').nth(2) {
                    Some(a) => a,
                    None => break,
                };
                let val = after2.split('\'').next().unwrap_or("").to_string();
                if !key.is_empty() {
                    formats.insert(key, val);
                }
                rest = &after2;
            }
        }
    }

    let audio_url = formats
        .get("audio")
        .or_else(|| formats.get("140"))
        .or_else(|| formats.get("251"))
        .or_else(|| formats.get("250"))
        .or_else(|| formats.get("249"))
        .or_else(|| formats.get("139"))
        .cloned()
        .or_else(|| {
            // raw googlevideo audio link
            let mut rest = &html[..];
            while let Some(i) = rest.find("googlevideo.com/videoplayback") {
                let start = rest[..i].rfind("https://").unwrap_or(0);
                let seg = &rest[start..];
                let end = seg.find(|c: char| c == '"' || c == '\\' || c == ' ').unwrap_or(seg.len().min(1000));
                let candidate = seg[..end].to_string();
                if candidate.contains("mime=audio") {
                    return Some(candidate.replace('\\', ""));
                }
                rest = &seg[end..];
            }
            None
        });

    let audio_url = match audio_url {
        Some(a) if !a.is_empty() => a,
        _ => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Gagal menemukan link Audio YouTube di halaman ini."
        }))).into_response(),
    };

    if !is_audio && !formats.contains_key(&res_key) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Resolusi {res_key} tidak tersedia.")
        }))).into_response();
    }

    // Step 3: submit merge job (monitor WS tidak tersedia di native — honest error)
    let merge_data = if is_audio {
        json!({
            "id": format!("{video_id}_MP3"), "ttl": 3600000,
            "inputs": [{ "id": video_id, "url": audio_url, "ext": "m4a",
                "chunkDownload": { "type": "header", "size": 52428800, "concurrency": 3 } }],
            "output": { "ext": "mp3", "downloadName": format!("{title}.mp3"),
                "chunkUpload": { "size": 209715200, "concurrency": 3 } },
            "operation": { "type": "no_process" }
        })
    } else {
        json!({
            "id": format!("{video_id}_{res_key}"), "ttl": 3600000,
            "inputs": [
                { "id": video_id, "url": formats[&res_key], "ext": "mp4",
                  "chunkDownload": { "type": "header", "size": 52428800, "concurrency": 3 } },
                { "id": video_id, "url": audio_url, "ext": "m4a",
                  "chunkDownload": { "type": "header", "size": 52428800, "concurrency": 3 } }
            ],
            "output": { "ext": "mp4", "downloadName": format!("{title}_{res_key}.mp4"),
                "chunkUpload": { "size": 209715200, "concurrency": 3 } },
            "operation": { "type": "replace_audio_in_video" }
        })
    };

    let mut ajax_headers = reqwest::header::HeaderMap::new();
    for (k, v) in base_headers() {
        ajax_headers.insert(
            reqwest::header::HeaderName::from_bytes(k.as_bytes()).unwrap(),
            reqwest::header::HeaderValue::from_str(v).unwrap(),
        );
    }
    ajax_headers.insert("Content-Type", reqwest::header::HeaderValue::from_static("application/x-www-form-urlencoded"));
    ajax_headers.insert(
        "x-wp-nonce",
        reqwest::header::HeaderValue::from_str(&nonce).unwrap(),
    );

    let form = format!(
        "action=process_video_merge&nonce={}&request_data={}",
        urlencoding::encode(&nonce),
        urlencoding::encode(&merge_data.to_string())
    );

    let job: Value = match client
        .post("https://ssyou.online/wp-admin/admin-ajax.php")
        .headers(ajax_headers.clone())
        .body(form)
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Server menolak request: {e}")
        }))).into_response(),
    };

    if job.get("success").and_then(|s| s.as_bool()) != Some(true) {
        let msg = job.pointer("/data").map(|d| d.to_string()).unwrap_or_else(|| "unknown".into());
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Server menolak request: {msg}")
        }))).into_response();
    }

    // Monitor render: butuh WebSocket (bukan bagian dependency apiku-rs)
    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "Job merge berhasil dibuat di ssyou.online, tapi monitor render-nya memakai WebSocket — belum didukung native (butuh browser/ws engine)."
    }))).into_response()
}

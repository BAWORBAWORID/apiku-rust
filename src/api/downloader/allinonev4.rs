// All-In-One Downloader v4 (downvideo.me) — native conversion of api/downloader/allinonev4.js
// Node version probes platform-specific scrapers (YouTube InnerTube, TikTok api-data,
// Instagram GraphQL) before falling back to downvideo.me. Native subset: jalur
// downvideo.me dikonversi penuh (expand → aio-dl/api → token fallback → aio-dl/video-data
// → normalize medias). Platform-specific primary scrapers yang butuh cookie-jar/browser
// dilewati — fallback langsung dipakai (hasil sama, sedikit lebih lambat).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://downvideo.me";
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const BOT_RE: [&str; 6] = ["just a moment", "cf-chl", "verify you are human", "checking your browser", "bot detected", "access denied"];

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    h.insert("User-Agent", mk(UA));
    h.insert("Accept", mk("*/*"));
    h.insert("Accept-Language", mk("id-ID,id;q=0.9,en;q=0.8"));
    h
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn b64(s: &str) -> String {
    // std-only base64 of index string
    const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = s.as_bytes();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TBL[(n >> 18) as usize & 63] as char);
        out.push(TBL[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TBL[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TBL[n as usize & 63] as char } else { '=' });
    }
    out
}

fn human_size(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut u = 0;
    while size >= 1024.0 && u < units.len() - 1 {
        size /= 1024.0;
        u += 1;
    }
    format!("{:.2} {}", size, units[u])
}

fn is_bot(text: &str) -> bool {
    let lower = text.to_lowercase();
    BOT_RE.iter().any(|p| lower.contains(p))
}

async fn get_text(client: &reqwest::Client, url: &str, referer: Option<&str>) -> Result<String, (String, String)> {
    let mut req = client.get(url).headers(base_headers());
    if let Some(r) = referer {
        req = req.header("Referer", r);
    }
    let resp = req.send().await.map_err(|e| ("REQUEST_FAILED".into(), e.to_string()))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| ("REQUEST_FAILED".into(), e.to_string()))?;
    if status.as_u16() == 403 {
        return Err(("HTTP_403".into(), "Akses ditolak.".into()));
    }
    if status.as_u16() == 429 {
        return Err(("HTTP_429".into(), "Rate limit tercapai.".into()));
    }
    if is_bot(&body) {
        return Err(("BOT_CHALLENGE".into(), "Proteksi browser tidak dapat dilewati.".into()));
    }
    if !status.is_success() {
        return Err((format!("HTTP_{}", status.as_u16()), format!("HTTP {}", status.as_u16())));
    }
    Ok(body)
}

async fn downvideo_data(client: &reqwest::Client, value: &str) -> Result<Value, (String, String)> {
    // Try GET /wp-json/aio-dl/api?url=...
    let api = format!("{BASE_URL}/wp-json/aio-dl/api?url={}", urlencoding::encode(value));
    match get_text(client, &api, Some(&format!("{BASE_URL}/"))).await {
        Ok(body) => serde_json::from_str(&body)
            .map_err(|e| ("PARSE_ERROR".into(), e.to_string())),
        Err(e) if !matches!(e.0.as_str(), "BOT_CHALLENGE" | "HTTP_400" | "HTTP_429") => {
            // Token fallback
            let html = get_text(client, &format!("{BASE_URL}/en/"), None).await?;
            let token = html
                .to_lowercase()
                .find("id=\"token\"")
                .and_then(|i| {
                    let rest = &html[i..];
                    let marker = "value=\"";
                    let vi = rest.find(marker)? + marker.len();
                    Some(rest[vi..vi + 64.min(rest[vi..].len())].to_string())
                })
                .filter(|t| t.chars().all(|c| c.is_ascii_hexdigit()));
            let token = match token {
                Some(t) => t,
                None => return Err(("TOKEN_MISSING".into(), "Token DownVideo tidak ditemukan".into())),
            };
            let form = format!("url={}&token={}", urlencoding::encode(value), token);
            let resp = client
                .post(format!("{BASE_URL}/wp-json/aio-dl/video-data"))
                .headers(base_headers())
                            .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Referer", format!("{BASE_URL}/"))
                .body(form)
                .send()
                .await
                .map_err(|e| ("REQUEST_FAILED".into(), e.to_string()))?;
            let status = resp.status();
            let body = resp.text().await.map_err(|e| ("REQUEST_FAILED".into(), e.to_string()))?;
            if !status.is_success() {
                return Err((format!("HTTP_{}", status.as_u16()), format!("HTTP {}", status.as_u16())));
            }
            serde_json::from_str(&body).map_err(|e| ("PARSE_ERROR".into(), e.to_string()))
        }
        Err(e) => Err(e),
    }
}

fn normalize(data: &Value, value: &str, service: &str) -> Result<Value, (String, String)> {
    let medias_raw = data.get("medias").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    let mut medias: Vec<Value> = Vec::new();
    for (index, m) in medias_raw.iter().enumerate() {
        let url = text(m.get("url").unwrap_or(&Value::Null));
        if url.is_empty() {
            continue;
        }
        let extension = text(m.get("extension").unwrap_or(&Value::Null)).to_lowercase();
        let video_available = m.get("videoAvailable").and_then(|v| v.as_bool()).unwrap_or(true);
        let audio_available = m.get("audioAvailable").and_then(|v| v.as_bool()).unwrap_or(true);
        let size = m.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
        let is_audio = (!video_available && audio_available) || ["mp3", "m4a", "aac", "opus"].contains(&extension.as_str());
        medias.push(json!({
            "index": index,
            "id": b64(&index.to_string()),
            "quality": text(m.get("quality").unwrap_or(&Value::Null)),
            "extension": extension,
            "size": size,
            "formattedSize": if text(m.get("formattedSize").unwrap_or(&Value::Null)).is_empty() { human_size(size) } else { text(m.get("formattedSize").unwrap_or(&Value::Null)) },
            "videoAvailable": video_available,
            "audioAvailable": audio_available,
            "isAudio": is_audio,
            "verified": m.get("verified").and_then(|v| v.as_bool()).unwrap_or(false),
            "contentType": m.get("contentType").cloned().unwrap_or(Value::Null),
            "requestHeaders": m.get("requestHeaders").cloned().unwrap_or(Value::Null),
            "requiresMuxing": video_available && !audio_available,
            "directUrl": url,
            "downloadUrl": url,
            "proxyUrl": Value::Null
        }));
    }
    if medias.is_empty() {
        return Err(("NO_MEDIA".into(), "Media tidak ditemukan".into()));
    }
    let videos: Vec<&Value> = medias.iter().filter(|m| m.get("videoAvailable").and_then(|v| v.as_bool()).unwrap_or(false)).collect();
    let mut sorted: Vec<&Value> = videos;
    sorted.sort_by_key(|m| -m.get("size").and_then(|s| s.as_i64()).unwrap_or(0));
    let muxed: Vec<&Value> = sorted.iter().copied().filter(|m| m.get("audioAvailable").and_then(|v| v.as_bool()).unwrap_or(false)).collect();
    let only: Vec<&Value> = sorted.iter().copied().filter(|m| !m.get("audioAvailable").and_then(|v| v.as_bool()).unwrap_or(false)).collect();
    let audios: Vec<&Value> = medias.iter().filter(|m| m.get("isAudio").and_then(|v| v.as_bool()).unwrap_or(false)).collect();
    let mut audios_sorted: Vec<&Value> = audios;
    audios_sorted.sort_by_key(|m| -m.get("size").and_then(|s| s.as_i64()).unwrap_or(0));

    let thumbnail = text(data.get("thumbnail").unwrap_or(&Value::Null));
    Ok(json!({
        "ok": true,
        "service": service,
        "originalUrl": value,
        "title": if text(data.get("title").unwrap_or(&Value::Null)).is_empty() { "Tanpa judul".to_string() } else { text(data.get("title").unwrap_or(&Value::Null)) },
        "author": if text(data.get("author").unwrap_or(&Value::Null)).is_empty() { Value::Null } else { json!(text(data.get("author").unwrap_or(&Value::Null))) },
        "thumbnail": if thumbnail.starts_with("data:") || thumbnail.is_empty() { Value::Null } else { json!(thumbnail) },
        "duration": data.get("duration").cloned().unwrap_or(Value::Null),
        "source": text(data.get("source").unwrap_or(&Value::Null)),
        "count": medias.len(),
        "medias": medias,
        "bestVideo": muxed.first().cloned().cloned().or_else(|| sorted.first().cloned().cloned()),
        "bestVideoOnly": only.first().cloned().cloned(),
        "bestAudio": audios_sorted.first().cloned().cloned()
    }))
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
    let input = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();
    let input = if input.is_empty() { "https://vt.tiktok.com/ZSbm6fY8P/".to_string() } else { input };
    if !(input.starts_with("http://") || input.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL tidak valid. Gunakan format https://..."
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

    match downvideo_data(&client, &input).await.and_then(|d| normalize(&d, &input, "downvideo")) {
        Ok(result) => Json(json!({ "status": true, "result": result })).into_response(),
        Err((code, why)) => (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": why, "code": code
        }))).into_response(),
    }
}

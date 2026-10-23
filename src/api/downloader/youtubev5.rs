// YouTube Downloader v5 (ytultra) — native conversion of api/downloader/youtubev5.js
// API: api.ytultra.com/ikool/youtube/download (POST JSON)
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_BASE: &str = "https://api.ytultra.com/ikool/youtube";
const OK_CODE: &str = "0000";
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const AUDIO_EXTS: [&str; 7] = ["mp3", "m4a", "aac", "opus", "ogg", "weba", "wav"];
const VIDEO_EXTS: [&str; 7] = ["mp4", "webm", "mkv", "mov", "avi", "flv", "3gp"];

fn human_size(bytes: f64) -> Option<String> {
    if !bytes.is_finite() || bytes < 0.0 {
        return None;
    }
    if bytes >= 1073741824.0 {
        return Some(format!("{:.2} GB", bytes / 1073741824.0));
    }
    if bytes >= 1048576.0 {
        return Some(format!("{:.2} MB", bytes / 1048576.0));
    }
    if bytes >= 1024.0 {
        return Some(format!("{:.1} KB", bytes / 1024.0));
    }
    Some(format!("{bytes} B"))
}

fn human_duration(seconds: f64) -> Option<String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let s = (seconds as i64) % 60;
    let m = ((seconds as i64) / 60) % 60;
    let h = (seconds as i64) / 3600;
    if h > 0 {
        Some(format!("{h}:{m:02}:{s:02}"))
    } else {
        Some(format!("{m}:{s:02}"))
    }
}

fn is_valid_id(s: &str) -> bool {
    s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn extract_video_id(input: &str) -> Option<String> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }
    if is_valid_id(raw) {
        return Some(raw.to_string());
    }
    let full = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let u = url::Url::parse(&full).ok()?;
    let host = u.host_str()?.trim_start_matches("www.").to_lowercase();
    let known = ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
    if !known.contains(&host.as_str()) {
        return None;
    }
    if host == "youtu.be" {
        let id = u.path().trim_start_matches('/').split('/').next().unwrap_or("");
        if is_valid_id(id) {
            return Some(id.to_string());
        }
        return None;
    }
    for (k, v) in u.query_pairs() {
        if k == "v" && is_valid_id(&v) {
            return Some(v.to_string());
        }
    }
    for seg in ["/embed/", "/shorts/", "/live/", "/v/", "/e/"] {
        if let Some(rest) = u.path().split(seg).nth(1) {
            let id: String = rest.chars().take(11).collect();
            if is_valid_id(&id) {
                return Some(id);
            }
        }
    }
    None
}

fn parse_format(raw: &str) -> (String, Option<String>, Option<String>) {
    let format = raw.trim().to_string();
    let mut ext: Option<String> = None;
    if let Some(bpos) = format.find('[') {
        if let Some(epos) = format[bpos..].find(']') {
            let inner = format[bpos + 1..bpos + epos].trim().trim_start_matches('.');
            if (2..=5).contains(&inner.len()) && inner.chars().all(|c| c.is_ascii_alphanumeric()) {
                ext = Some(inner.to_lowercase());
            }
        }
    }
    let mut quality: Option<String> = None;
    for w in format.split_whitespace() {
        let core = w.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        let digits: String = core.chars().take_while(|c| c.is_ascii_digit()).collect();
        if core.len() == digits.len() + 1 && core.ends_with('p') && digits.len() >= 3 {
            quality = Some(format!("{digits}p"));
            break;
        }
    }
    if quality.is_none() {
        let l = format.to_lowercase();
        if l.contains("4k") {
            quality = Some("2160p".into());
        } else if l.contains("2k") {
            quality = Some("1440p".into());
        }
    }
    (format, ext, quality)
}

fn is_audio(ext: &Option<String>, quality: &Option<String>, format: &str) -> bool {
    if let Some(e) = ext {
        if AUDIO_EXTS.contains(&e.as_str()) {
            return true;
        }
        if VIDEO_EXTS.contains(&e.as_str()) {
            return false;
        }
    }
    if quality.is_some() {
        return false;
    }
    let l = format.to_lowercase();
    l.contains("kbps") || l.contains("audio only") || l.contains("audio-only")
}

fn size_from_url(url: &str) -> Option<f64> {
    for (k, v) in url::Url::parse(url).ok()?.query_pairs() {
        if k == "clen" {
            return v.parse::<f64>().ok();
        }
    }
    None
}

fn normalize_media(m: &Value) -> Option<Value> {
    let media_url = m.get("url").and_then(|u| u.as_str())?;
    let (format, ext, quality) = parse_format(m.get("format").and_then(|f| f.as_str()).unwrap_or(""));
    let audio = is_audio(&ext, &quality, &format);
    let size = m.get("fileSize").and_then(|s| s.as_f64()).or_else(|| size_from_url(media_url));
    let size_text = m
        .get("sizeStr")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .or_else(|| size.and_then(human_size));
    Some(json!({
        "url": media_url,
        "format": format,
        "ext": ext,
        "quality": if audio { Value::Null } else { quality.map(serde_json::Value::String).unwrap_or(Value::Null) },
        "size": size,
        "sizeText": size_text,
        "type": if audio { "audio" } else { "video" }
    }))
}

fn dedupe(list: Vec<Value>) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for m in list {
        let url_str = m.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
        let ext = m.get("ext").and_then(|e| e.as_str()).unwrap_or("");
        let size = m.get("size").and_then(|s| s.as_f64());
        if url_str.is_empty() {
            continue;
        }
        if ext.is_empty() && m.get("format").and_then(|f| f.as_str()).unwrap_or("").is_empty() {
            continue;
        }
        let key = match (ext, size) {
            (e, Some(s)) if !e.is_empty() => format!("{e}:{s}"),
            _ => url_str.clone(),
        };
        if seen.insert(key) {
            out.push(m);
        }
    }
    out
}

fn quality_value(item: &Value) -> f64 {
    item.get("quality")
        .and_then(|q| q.as_str())
        .and_then(|q| q.trim_end_matches('p').parse::<f64>().ok())
        .unwrap_or(0.0)
}

fn sort_formats(mut list: Vec<Value>) -> Vec<Value> {
    list.sort_by(|a, b| {
        quality_value(b)
            .partial_cmp(&quality_value(a))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                (b.get("size").and_then(|s| s.as_f64()).unwrap_or(0.0))
                    .partial_cmp(&(a.get("size").and_then(|s| s.as_f64()).unwrap_or(0.0)))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    list
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
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };
    let id = match extract_video_id(&url) {
        Some(i) => i,
        None => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "URL YouTube tidak valid"
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil data video YouTube: {e}")
        }))).into_response(),
    };

    let data = match client
        .post(format!("{API_BASE}/download"))
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://www.ytultra.com")
                    .header("Referer", "https://www.ytultra.com/")
        .json(&json!({ "url": format!("https://www.youtube.com/watch?v={id}") }))
        .send()
        .await
    {
        Ok(r) => {
            let text = r.text().await.unwrap_or_default();
            match serde_json::from_str::<Value>(&text) {
                Ok(j) => j,
                Err(_) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                        "status": false, "message": "Respons API bukan JSON"
                    }))).into_response()
                }
            }
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal mengambil data video YouTube: {e}")
        }))).into_response(),
    };

    let code = data
        .get("code")
        .map(|c| match c {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    if code != OK_CODE {
        let msg = data.get("msg").and_then(|m| m.as_str()).unwrap_or("unknown");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("API error (code {code}): {msg}")
        }))).into_response();
    }
    let d = data.get("data").cloned().unwrap_or(json!({}));

    let raw = d.get("medias").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    let all = dedupe(raw.iter().filter_map(|m| normalize_media(m)).collect());
    let duration = d.get("duration").and_then(|x| x.as_f64());
    let videos = sort_formats(all.iter().filter(|m| m["type"] == "video").cloned().collect());
    let audios = sort_formats(all.iter().filter(|m| m["type"] == "audio").cloned().collect());
    let total = all.len();

    Json(json!({
        "status": true,
        "result": {
            "id": id,
            "url": format!("https://www.youtube.com/watch?v={id}"),
            "title": d.get("title").cloned().unwrap_or(Value::Null),
            "duration": duration,
            "durationText": duration.and_then(human_duration),
            "thumbnail": d.get("imageUrl").cloned().unwrap_or(Value::Null),
            "total": total,
            "videos": videos,
            "audios": audios
        }
    })).into_response()

}

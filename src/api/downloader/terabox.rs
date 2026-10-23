// Terabox Downloader — native conversion of api/downloader/terabox.js
// Flow: GET dm.terabox.app/sharing/link?surl=... → extract jsToken →
//       GET /share/list?app_id=250528&jsToken=...&shorturl=...&root=1
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const COOKIE: &str = "ndus=YuLuQdPpeHuiMGEQDXpWDu6K2P4-xInj8YGEzswD";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".into();
    }
    const SIZES: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let k = 1024f64;
    let i = ((bytes as f64).ln() / k.ln()).floor() as usize;
    let i = i.min(SIZES.len() - 1);
    let v = bytes as f64 / k.powi(i as i32);
    format!("{:.2} {}", (v * 100.0).round() / 100.0, SIZES[i])
}

fn extract_surl(url: &str) -> String {
    let s = url.trim();
    if let Some(rest) = s.split("/s/").nth(1) {
        let end = rest.find(|c| c == '?' || c == '#').unwrap_or(rest.len());
        let seg = &rest[..end];
        if !seg.is_empty() {
            return seg.to_string();
        }
    }
    if let Some(pos) = s.find("surl=") {
        let rest = &s[pos + 5..];
        let end = rest.find('&').unwrap_or(rest.len());
        return rest[..end].to_string();
    }
    s.to_string()
}

fn clean_files(list: &[Value]) -> Value {
    let out: Vec<Value> = list
        .iter()
        .filter(|f| f.get("isdir").and_then(|d| d.as_str()) != Some("1"))
        .map(|f| {
            let size = f
                .get("size")
                .and_then(|s| s.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| f.get("size").and_then(|s| s.as_u64()));
            let thumbs = f.get("thumbs");
            json!({
                "name": f.get("server_filename"),
                "size": size,
                "size_formatted": size.map(format_bytes),
                "md5": f.get("md5"),
                "path": f.get("path"),
                "width": f.get("width"),
                "height": f.get("height"),
                "duration": f.get("duration").and_then(|d| {
                    d.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| d.as_i64())
                }),
                "thumbnails": thumbs.map(|t| json!({
                    "small": t.get("url1"),
                    "medium": t.get("url2"),
                    "large": t.get("url3"),
                    "icon": t.get("icon")
                }))
            })
        })
        .collect();
    json!(out)
}

async fn get_share_list(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let surl = extract_surl(url);
    let short_url = if surl.starts_with('1') { surl[1..].to_string() } else { surl.clone() };

    let first = client
        .get(format!("https://dm.terabox.app/sharing/link?surl={}", urlencoding::encode(&surl)))
        .header("Cookie", COOKIE)
        .send()
        .await
        .map_err(|e| format!("Request error: {e}"))?;
    let html = first.text().await.unwrap_or_default();

    let js_token = html
        .split("fn%28%22")
        .nth(1)
        .and_then(|s| s.split("%22%29").next())
        .map(|s| s.to_string())
        .ok_or_else(|| "jsToken tidak ditemukan — link tidak valid atau cookie expired".to_string())?;

    let api_url = format!(
        "https://dm.terabox.app/share/list?app_id=250528&jsToken={}&site_referer=https%3A%2F%2Fwww.terabox.app%2F&shorturl={}&root=1",
        urlencoding::encode(&js_token),
        urlencoding::encode(&short_url)
    );
    let api = client
        .get(&api_url)
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Referer", "https://www.terabox.com/")
        .header("Cookie", COOKIE)
        .send()
        .await
        .map_err(|e| format!("Request error: {e}"))?;

    if !api.status().is_success() {
        return Err(format!("Terabox API error: {}", api.status().as_u16()));
    }
    let data: Value = api.json().await.map_err(|e| format!("Invalid JSON: {e}"))?;
    if data.get("errno").and_then(|e| e.as_i64()) != Some(0) {
        let errmsg = data.get("errmsg").and_then(|m| m.as_str()).unwrap_or("unknown");
        return Err(format!(
            "Terabox API error errno={} ({})",
            data.get("errno").and_then(|e| e.as_i64()).unwrap_or(-1),
            errmsg
        ));
    }

    let list = data.get("list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
    let dirs = list.iter().filter(|f| f.get("isdir").and_then(|d| d.as_str()) == Some("1")).count();
    let clean = clean_files(&list);

    Ok(json!({
        "surl": surl,
        "short_url": short_url,
        "jsToken": js_token,
        "uk": data.get("uk"),
        "shareid": data.get("shareid"),
        "total": list.len(),
        "dirs": dirs,
        "files": clean.as_array().map(|a| a.len()).unwrap_or(0),
        "list": clean
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
    let url = merged.get("url").cloned().unwrap_or_default();
    if !url.contains("terabox") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "error": "URL Terabox tidak valid"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string(), "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response(),
    };

    match get_share_list(&client, &url).await {
        Ok(mut result) => {
            result["input"] = json!(url);
            result["status"] = json!(true);
            result["timestamp"] = json!(chrono::Utc::now().to_rfc3339());
            Json(result).into_response()
        }
        Err(msg) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": msg, "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response(),
    }
}

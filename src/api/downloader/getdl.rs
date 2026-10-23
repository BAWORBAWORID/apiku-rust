// GetDL Downloader (getdl.space) — native conversion of api/downloader/getdl.js
// Flow: session init (landing page + /api/session) → POST /api/download with
// sessionId + shared cookie jar; SESSION_REQUIRED → re-init; shortlinks →
// resolve redirect then retry.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use reqwest::header;

const BASE_URL: &str = "https://getdl.space";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

static COOKIE_JAR: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static SESSION: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn get_cookie_header() -> String {
    let guard = COOKIE_JAR.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn save_cookies(headers: &reqwest::header::HeaderMap) {
    let set_cookies: Vec<String> = headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").to_string())
        .collect();
    if set_cookies.is_empty() {
        return;
    }
    let mut guard = COOKIE_JAR.lock().unwrap_or_else(|e| e.into_inner());
    let mut jar = guard.clone().unwrap_or_default();
    for pair in set_cookies {
        if let Some(idx) = pair.find('=') {
            if idx > 0 {
                jar.insert(pair[..idx].trim().to_string(), pair[idx + 1..].trim().to_string());
            }
        }
    }
    *guard = Some(jar);
}

fn platform_of(url: &str) -> (&'static str, &'static str) {
    let l = url.to_lowercase();
    // (key, display name) — first match wins, mirrors PLATFORM_PATTERNS order
    let table: [(&str, &str, fn(&str) -> bool); 14] = [
        ("tiktok", "TikTok", |u| u.contains("tiktok.com")),
        ("douyin", "Douyin", |u| u.contains("douyin.com")),
        ("instagram", "Instagram", |u| u.contains("instagram.com")),
        ("facebook", "Facebook", |u| u.contains("facebook.com") || u.contains("fb.watch")),
        ("youtube", "YouTube", |u| u.contains("youtube.com") || u.contains("youtu.be")),
        ("twitter", "X / Twitter", |u| u.contains("twitter.com") || u.contains("x.com")),
        ("threads", "Threads", |u| u.contains("threads.net")),
        ("capcut", "CapCut", |u| u.contains("capcut.com")),
        ("spotify", "Spotify", |u| u.contains("spotify.com")),
        ("soundcloud", "SoundCloud", |u| u.contains("soundcloud.com")),
        ("pinterest", "Pinterest", |u| u.contains("pinterest.com") || u.contains("pinterest.co.uk") || u.contains("pinterest.ca") || u.contains("pinterest.de") || u.contains("pinterest.fr") || u.contains("pinterest.jp")),
        ("bilibili", "BiliBili", |u| u.contains("bilibili.tv")),
        ("snapchat", "Snapchat", |u| u.contains("snapchat.com")),
        ("pixiv", "Pixiv", |u| u.contains("pixiv.net")),
    ];
    for (key, name, check) in table {
        if check(&l) {
            return (key, name);
        }
    }
    ("unknown", "unknown")
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())
}

async fn ensure_session(client: &reqwest::Client, force_new: bool) -> Result<String, (u16, String, String)> {
    if !force_new {
        let guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((sid, at)) = guard.as_ref() {
            if at.elapsed() < Duration::from_secs(30 * 60) {
                return Ok(sid.clone());
            }
        }
    }
    drop(SESSION.lock().unwrap_or_else(|e| e.into_inner()));

    // 1. Landing page for base cookies
    let _ = client
        .get(format!("{BASE_URL}/en"))
        .header("User-Agent", USER_AGENT)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await
        .and_then(|r| {
            save_cookies(r.headers());
            Ok(r)
        });

    // 2. Session endpoint
    let resp = client
        .get(format!("{BASE_URL}/api/session"))
        .header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json, text/plain, */*")
        .header("Referer", format!("{BASE_URL}/en"))
        .header("Origin", BASE_URL)
        .header("Cookie", get_cookie_header())
        .send()
        .await
        .map_err(|e| (502u16, "UPSTREAM_ERROR".into(), e.to_string()))?;
    save_cookies(resp.headers());
    let status = resp.status().as_u16();
    let json: Value = resp.json().await.unwrap_or(Value::Null);

    let sid = json.get("sessionId").and_then(|s| s.as_str()).map(|s| s.to_string());
    let ok = json.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    match (status, ok, sid) {
        (200..=299, true, Some(sid)) if !sid.is_empty() => {
            let mut guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some((sid.clone(), Instant::now()));
            Ok(sid)
        }
        (st, _, _) => Err((502, "UPSTREAM_ERROR".into(), format!("Gagal inisialisasi session dari {BASE_URL} (HTTP {st})"))),
    }
}

async fn make_request(client: &reqwest::Client, url: &str, sid: &str) -> (u16, Value) {
    let resp = match client
        .post(format!("{BASE_URL}/api/download"))
                    .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json, text/plain, */*")
        .header("Origin", BASE_URL)
        .header("Referer", format!("{BASE_URL}/en"))
        .header("Cookie", get_cookie_header())
        .json(&json!({ "url": url, "sessionId": sid }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return (502, Value::Null),
    };
    save_cookies(resp.headers());
    let status = resp.status().as_u16();
    let json = resp.json().await.unwrap_or(Value::Null);
    (status, json)
}

fn is_shortlink(url: &str) -> bool {
    let l = url.to_lowercase();
    ["vt.tiktok.com", "vm.tiktok.com", "youtu.be", "t.co", "bit.ly", "fb.watch"]
        .iter()
        .any(|p| l.contains(p))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = Instant::now();
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();
    if url.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "code": 400, "message": "Parameter 'url' wajib diisi"
        }))).into_response();
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) || url.len() < 9 {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "code": 400,
            "message": "Parameter 'url' harus berupa URL http/https yang valid"
        }))).into_response();
    }

    let client = match client() {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false, "code": "UPSTREAM_ERROR", "message": e,
            "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) }
        }))).into_response(),
    };

    let (platform, platform_name) = platform_of(&url);

    let exec = async {
        let mut sid = ensure_session(&client, false).await.map_err(|e| e)?;
        let (mut status, mut json) = make_request(&client, &url, &sid).await;

        if !(200..300).contains(&status) && json.get("code").and_then(|c| c.as_str()) == Some("SESSION_REQUIRED") {
            sid = ensure_session(&client, true).await?;
            let retry = make_request(&client, &url, &sid).await;
            status = retry.0;
            json = retry.1;
        }

        if !(200..300).contains(&status) && is_shortlink(&url) {
            let resolved = client
                .get(&url)
                .header("User-Agent", USER_AGENT)
                .send()
                .await
                .ok()
                .map(|r| r.url().to_string());
            if let Some(resolved) = resolved {
                if resolved != url {
                    let retry = make_request(&client, &resolved, &sid).await;
                    if (200..300).contains(&retry.0) && retry.1.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
                        status = retry.0;
                        json = retry.1;
                    }
                }
            }
        }

        let ok = (200..300).contains(&status) && json.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
        if !ok {
            let msg = json
                .get("error")
                .and_then(|e| e.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("HTTP {status}: Gagal memproses download"));
            let code = json.get("code").and_then(|c| c.as_str()).unwrap_or("FAILED").to_string();
            return Err((status.max(400).min(599), code, msg));
        }
        Ok(json.get("data").cloned().unwrap_or(Value::Null))
    };

    match exec.await {
        Ok(data) => {
            let downloads: Vec<Value> = data
                .get("downloads")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|item| {
                    json!({
                        "label": item.get("label").and_then(|l| l.as_str()).unwrap_or("Download"),
                        "url": item.get("url").and_then(|l| l.as_str()).unwrap_or(""),
                        "quality": item.get("quality").cloned().unwrap_or(Value::Null),
                        "ext": item.get("ext").and_then(|e| e.as_str()).unwrap_or("mp4").to_lowercase().replace('.', "")
                    })
                })
                .collect();
            let author = data.get("author").cloned().unwrap_or(Value::Null);
            Json(json!({
                "status": true,
                "platform": platform,
                "platform_name": platform_name,
                "type": data.get("type").cloned().unwrap_or(json!("video")),
                "title": data.get("title").cloned().unwrap_or(json!("")),
                "thumbnail": data.get("thumbnail").cloned().unwrap_or(Value::Null),
                "author": {
                    "name": author.get("name").cloned().unwrap_or(json!("Unknown")),
                    "username": author.get("username").cloned().unwrap_or(json!("")),
                    "avatar": author.get("avatar").cloned().unwrap_or(Value::Null)
                },
                "duration": data.get("duration").cloned().unwrap_or(Value::Null),
                "downloads": downloads,
                "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) }
            }))
            .into_response()
        }
        Err((status, code, msg)) => {
            let mut message = msg;
            if code == "RESOLVE_FAILED" || message.contains("Gagal mengambil media") {
                message = "Upstream getdl.space gagal meresolve media dari link ini (terbatas oleh firewall/WAF platform target). Jika TikTok bermasalah, gunakan endpoint /api/downloader/tiktokv6.".into();
            }
            let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            (sc, Json(json!({
                "status": false, "code": code, "message": message,
                "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) }
            }))).into_response()
        }
    }
}

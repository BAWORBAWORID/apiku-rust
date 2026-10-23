// TikTok Auto-Stalker — native conversion of api/stalker/tiktok.js
// Scrapes the tiktok.com embed page (bypasses Slardar WAF) and parses
// __FRONTITY_CONNECT_STATE__ JSON. In-memory session cache, 10-minute TTL.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SESSION_TTL: Duration = Duration::from_secs(10 * 60);

struct Session {
    username: String,
    data: Value,
    id: String,
    created: Instant,
    hits: u64,
}

static SESSIONS: Mutex<Option<Vec<Session>>> = Mutex::new(None);

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // ISO-ish timestamp without extra deps
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // convert days since epoch to Y-M-D (civil algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, d, h, m, s
    )
}

fn generate_session_id(username: &str) -> String {
    use md5::{Digest, Md5};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let rand_hex = format!("{:016x}", ts); // deterministic-ish filler
    let data = format!("{}:{}:{}", username, ts, rand_hex);
    let out = Md5::digest(data.as_bytes());
    hex::encode(out)[..16].to_string()
}

fn get_session(username: &str) -> Option<Session> {
    let mut guard = SESSIONS.lock().ok()?;
    let list = guard.get_or_insert_with(Vec::new);
    list.retain(|s| s.created.elapsed() < SESSION_TTL);
    if let Some(s) = list
        .iter_mut()
        .find(|s| s.username == username.to_lowercase())
    {
        s.hits += 1;
        return Some(Session {
            username: s.username.clone(),
            data: s.data.clone(),
            id: s.id.clone(),
            created: s.created,
            hits: s.hits,
        });
    }
    None
}

fn create_session(username: &str, data: Value) -> Session {
    let s = Session {
        username: username.to_lowercase(),
        id: generate_session_id(username),
        data,
        created: Instant::now(),
        hits: 1,
    };
    if let Ok(mut guard) = SESSIONS.lock() {
        let list = guard.get_or_insert_with(Vec::new);
        list.retain(|x| x.created.elapsed() < SESSION_TTL);
        list.push(Session {
            username: s.username.clone(),
            data: s.data.clone(),
            id: s.id.clone(),
            created: s.created,
            hits: s.hits,
        });
    }
    s
}

fn find_user_holder(v: &Value, depth: u32) -> Option<&Value> {
    if depth > 12 {
        return None;
    }
    match v {
        Value::Object(map) => {
            if let Some(ui) = map.get("userInfo") {
                if ui.get("uniqueId").is_some() {
                    return Some(v);
                }
            }
            for (_, val) in map {
                if let Some(r) = find_user_holder(val, depth + 1) {
                    return Some(r);
                }
            }
            None
        }
        Value::Array(arr) => arr.iter().find_map(|x| find_user_holder(x, depth + 1)),
        _ => None,
    }
}

async fn stalk_tiktok(username: &str) -> Result<Value, String> {
    let clean = username.trim_start_matches('@').trim().to_lowercase();
    let url = format!("https://www.tiktok.com/embed/@{}", clean);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Referer", "https://www.tiktok.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    if status != 200 {
        if status == 400 || status == 404 {
            return Err(format!("TikTok user @{} not found", clean));
        }
        return Err(format!("HTTP {}: User not found", status));
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;

    // extract <script id="__FRONTITY_CONNECT_STATE__">...</script>
    let marker = "__FRONTITY_CONNECT_STATE__";
    let start = html
        .find(marker)
        .ok_or("Embed data not available (possibly rate limited) — try again later")?;
    let open_tag_end = html[start..].find('>').map(|i| start + i + 1).unwrap_or(start);
    let close = html[open_tag_end..]
        .find("</script>")
        .map(|i| open_tag_end + i)
        .ok_or("Failed to parse TikTok embed state")?;
    let state_raw = html[open_tag_end..close]
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    let state: Value =
        serde_json::from_str(state_raw.trim()).map_err(|_| "Failed to parse TikTok embed state")?;

    let holder = find_user_holder(&state, 0).ok_or(format!("TikTok user @{} not found", clean))?;
    let raw = holder
        .get("userInfo")
        .ok_or(format!("TikTok user @{} not found", clean))?;
    if let Some(code) = raw.get("code").and_then(|c| c.as_i64()) {
        if code != 200 {
            return Err(format!("TikTok user @{} not found", clean));
        }
    }
    let g = |k: &str| raw.get(k).cloned().unwrap_or(Value::Null);
    let videos = holder
        .get("videoList")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let video_items: Vec<Value> = videos
        .iter()
        .map(|v| {
            let id = v.get("id").cloned().unwrap_or(Value::Null);
            let id_str = id.as_str().map(|s| s.to_string()).or_else(|| id.as_i64().map(|i| i.to_string()));
            let url = id_str
                .map(|id| format!("https://www.tiktok.com/@{}/video/{}", raw.get("uniqueId").and_then(|u| u.as_str()).unwrap_or(&clean), id));
            json!({
                "id": id,
                "title": v.get("desc").cloned().unwrap_or(json!("")),
                "cover": v.get("coverUrl").cloned().unwrap_or(Value::Null),
                "duration": v.get("duration").cloned().unwrap_or(Value::Null),
                "url": url,
            })
        })
        .collect();

    Ok(json!({
        "id": g("id"),
        "username": g("uniqueId"),
        "nickname": raw.get("nickname").cloned().unwrap_or(g("uniqueId")),
        "bio": g("signature"),
        "avatar": g("avatarThumbUrl"),
        "verified": g("verified"),
        "private": g("privateAccount"),
        "followers": raw.get("followerCount").cloned().unwrap_or(json!(0)),
        "following": raw.get("followingCount").cloned().unwrap_or(json!(0)),
        "likes": raw.get("heartCount").cloned().unwrap_or(json!(0)),
        "videos": video_items,
    }))
}

fn get_suggestion(msg: &str) -> &'static str {
    if msg.contains("not found") {
        "Check if the TikTok username is correct"
    } else if msg.contains("timeout") || msg.contains("rate limited") {
        "TikTok might be rate limiting. Wait a few minutes"
    } else if msg.contains("Cannot connect") {
        "Check your internet connection"
    } else {
        "Try again with a valid TikTok username"
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = Instant::now();
    let username = query
        .get("username")
        .cloned()
        .or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get("username").and_then(|u| u.as_str()).map(|s| s.to_string()))
        });
    let username = match username {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'username' is required",
                "example": {
                    "GET": "/api/stalker/tiktok?username=mrbeast",
                    "POST": { "username": "mrbeast" },
                },
            })))
            .into_response()
        }
    };
    let clean = username.trim_start_matches('@').trim().to_string();

    let (data, from_cache, session) = match get_session(&clean) {
        Some(s) => (s.data.clone(), true, Some((s.id, s.hits))),
        None => match stalk_tiktok(&clean).await {
            Ok(d) => {
                let s = create_session(&clean, d.clone());
                (d, false, Some((s.id, s.hits)))
            }
            Err(e) => {
                let msg = if e.contains("ENOTFOUND") {
                    "Cannot connect to TikTok".to_string()
                } else {
                    e
                };
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false,
                    "message": msg,
                    "duration": format!("{}ms", start.elapsed().as_millis()),
                    "suggestion": get_suggestion(&msg),
                })))
                .into_response();
            }
        },
    };

    let uname = data
        .get("username")
        .and_then(|u| u.as_str())
        .unwrap_or(&clean)
        .to_string();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let expires_ms = now + SESSION_TTL.as_millis() as u64;

    let secs = expires_ms / 1000;
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mut mo = if mp < 10 { mp + 3 } else { mp - 9 };
    if mo <= 2 { y += 1; } else { mo = mo; }
    let _ = mo;
    let expires_at_str = format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s);
    let mut resp = json!({
        "status": true,
        "session": {
            "id": session.as_ref().map(|(id, _)| id.clone()),
            "expires_at": expires_at_str,
            "expires_in": SESSION_TTL.as_secs(),
            "created": now_iso(),
            "hits": json!(session.as_ref().map(|(_, h)| *h).unwrap_or(0)),
        },
        "user": {
            "username": uname,
            "profile_url": format!("https://tiktok.com/@{}", uname),
            "info": {
                "id": data.get("id"),
                "nickname": data.get("nickname"),
                "bio": data.get("bio"),
                "avatar": data.get("avatar"),
                "verified": data.get("verified"),
                "private": data.get("private"),
            },
            "stats": {
                "followers": data.get("followers"),
                "following": data.get("following"),
                "likes": data.get("likes"),
            },
            "recent_videos": data.get("videos"),
        },
        "metadata": {
            "cached": from_cache,
            "from_cache": from_cache,
            "source": "tiktok.com",
            "timestamp": now_iso(),
            "processing_time": start.elapsed().as_millis() as u64,
        },
    });
    if from_cache {
        resp["session"]["hits"] = json!(session.as_ref().map(|(_, h)| *h).unwrap_or(0));
    }
    Json(resp).into_response()
}

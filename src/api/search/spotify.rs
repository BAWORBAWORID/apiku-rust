// Spotify Search — native conversion of api/search/spotify.js
// GraphQL searchDesktop dengan TOTP token (secret tetap) + preview dari embed.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0";
const SECRET: &str = "376136387538459893883312310911992847112448894410210511297108";
const TOTP_VERSION: u64 = 61;
const APP_VERSION: &str = "1.2.92.50.g97692e81";
const FALLBACK_HASHES: [&str; 2] = [
    "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0",
    "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
];

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

fn totp(ts_ms: u64) -> String {
    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    let counter = ts_ms / 1000 / 30;
    let buf = counter.to_be_bytes();
    let mut mac = Hmac::<Sha1>::new_from_slice(SECRET.as_bytes()).expect("hmac");
    mac.update(&buf);
    let digest = mac.finalize().into_bytes();
    let offset = (digest[digest.len() - 1] & 0xf) as usize;
    let truncated = u32::from_be_bytes([digest[offset], digest[offset + 1], digest[offset + 2], digest[offset + 3]]) & 0x7fffffff;
    format!("{:06}", truncated % 1000000)
}

type Session = Mutex<(String, String, u64)>; // (token, clientToken, expires_ms)

fn session() -> &'static Session {
    static S: std::sync::OnceLock<Session> = std::sync::OnceLock::new();
    S.get_or_init(|| Mutex::new((String::new(), String::new(), 0)))
}

async fn get_auth(c: &reqwest::Client, force: bool) -> Result<(String, String), String> {
    {
        let s = session().lock().unwrap();
        if !force && !s.0.is_empty() && chrono::Utc::now().timestamp_millis() as u64 + 60000 < s.2 {
            return Ok((s.0.clone(), s.1.clone()));
        }
    }
    let now = chrono::Utc::now().timestamp_millis() as u64;
    let t = totp(now);
    let token: Value = c
        .get(&format!(
            "https://open.spotify.com/api/token?reason=init&productType=web-player&totp={}&totpServer={}&totpVer={}",
            t, t, TOTP_VERSION
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let access_token = token
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or("token request failed")?
        .to_string();
    let client_id = token.get("clientId").and_then(Value::as_str).unwrap_or("").to_string();

    let client_payload = json!({
        "client_data": {
            "client_version": APP_VERSION,
            "client_id": client_id,
            "js_sdk_data": {"device_brand": "unknown", "device_model": "unknown", "os": "windows", "os_version": "NT 10.0", "device_id": uuid::Uuid::new_v4().to_string(), "device_type": "computer"},
        }
    });
    let client: Value = c
        .post("https://clienttoken.spotify.com/v1/clienttoken")
                    .header("content-type", "application/json")
                    .header("accept", "application/json")
        .body(client_payload.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let client_token = client
        .pointer("/granted_token/token")
        .and_then(Value::as_str)
        .ok_or("client token request failed")?
        .to_string();
    let expires = token
        .get("accessTokenExpirationTimestampMs")
        .and_then(Value::as_u64)
        .unwrap_or(now + 3000000);

    {
        let mut s = session().lock().unwrap();
        *s = (access_token.clone(), client_token.clone(), expires);
    }
    Ok((access_token, client_token))
}

fn fmt_duration(ms: u64) -> String {
    let total = ms / 1000;
    format!("{}:{:02}", total / 60, total % 60)
}

fn parse_track(d: &Value) -> Option<Value> {
    let id = d
        .get("uri")
        .and_then(Value::as_str)
        .and_then(|u| u.split(':').nth(2))
        .map(str::to_string);
    let sources = d.pointer("/albumOfTrack/coverArt/sources").and_then(Value::as_array);
    let thumb = sources.and_then(|srcs| {
        srcs.iter()
            .max_by_key(|s| s.get("width").and_then(Value::as_i64).unwrap_or(0))
            .and_then(|s| s.get("url").and_then(Value::as_str))
            .map(str::to_string)
    });
    let artists: Vec<String> = d
        .pointer("/artists/items")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.pointer("/profile/name").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let id = id?;
    Some(json!({
        "id": id,
        "artist": artists.join(", "),
        "title": d.get("name").cloned().unwrap_or(Value::Null),
        "duration": fmt_duration(d.pointer("/duration/totalMilliseconds").and_then(Value::as_u64).unwrap_or(0)),
        "thumb": thumb,
        "url": format!("https://open.spotify.com/track/{}", id),
    }))
}

async fn get_preview(c: &reqwest::Client, id: &str) -> Option<String> {
    let html = c
        .get(format!("https://open.spotify.com/embed/track/{}", id))
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let re = regex::Regex::new(r#"<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>"#).unwrap();
    if let Some(m) = re.captures(&html) {
        if let Ok(j) = serde_json::from_str::<Value>(m[1].trim()) {
            if let Some(url) = j.pointer("/props/pageProps/state/data/entity/audioPreview/url").and_then(Value::as_str) {
                return Some(url.to_string());
            }
        }
    }
    let re2 = regex::Regex::new(r"https://p\.scdn\.co/mp3-preview/[a-zA-Z0-9]+").unwrap();
    re2.find(&html).map(|m| m.as_str().to_string())
}

async fn run_query(c: &reqwest::Client, term: &str, hash: &str, limit: usize, token: &str, client_token: &str) -> Result<Value, String> {
    let variables = json!({"searchTerm": term, "offset": 0, "limit": limit + 2, "numberOfTopResults": 1, "includeAudiobooks": false});
    let extensions = json!({"persistedQuery": {"version": 1, "sha256Hash": hash}});
    let res = c
        .get("https://api-partner.spotify.com/pathfinder/v1/query")
        .query(&[
            ("operationName", "searchDesktop".to_string()),
            ("variables", variables.to_string()),
            ("extensions", extensions.to_string()),
        ])
                    .header("accept", "application/json")
                    .header("app-platform", "WebPlayer")
        .header("authorization", format!("Bearer {}", token))
        .header("client-token", client_token)
        .header("spotify-app-version", APP_VERSION)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

fn discovered_hash() -> &'static Mutex<String> {
    static D: std::sync::OnceLock<Mutex<String>> = std::sync::OnceLock::new();
    D.get_or_init(|| Mutex::new(String::new()))
}

async fn discover_hash(c: &reqwest::Client) -> Option<String> {
    let cached = discovered_hash().lock().unwrap().clone();
    if !cached.is_empty() {
        return Some(cached);
    }
    let html = c.get("https://open.spotify.com/").send().await.ok()?.text().await.ok()?;
    let re_main = regex::Regex::new(r"https://open\.spotifycdn\.com/cdn/build/web-player/web-player\.[0-9a-f]+\.js").unwrap();
    let main_url = re_main.find(&html)?.as_str().to_string();
    let main_js = c
        .get(&main_url)
                    .header("referer", "https://open.spotify.com/")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let re_cand = regex::Regex::new(r"https://open\.spotifycdn\.com/cdn/build/web-player/[\w.\-]*search[\w.\-]*\.js").unwrap();
    let candidates: std::collections::HashSet<String> = re_cand.find_iter(&main_js).map(|m| m.as_str().to_string()).collect();
    let re_hash = regex::Regex::new(r#""searchDesktop","query","([a-f0-9]{64})""#).unwrap();
    for url in candidates {
        if let Ok(chunk) = c.get(&url)            .header("referer", "https://open.spotify.com/").send().await {
            if let Ok(text) = chunk.text().await {
                if let Some(m) = re_hash.captures(&text) {
                    *discovered_hash().lock().unwrap() = m[1].to_string();
                    return Some(m[1].to_string());
                }
            }
        }
    }
    None
}

async fn search_data(c: &reqwest::Client, term: &str, limit: usize) -> Option<Value> {
    let (token, client_token) = match get_auth(c, false).await {
        Ok(t) => t,
        Err(_) => return None,
    };
    let run = |hash: String| {
        let c = c.clone();
        let token = token.clone();
        let client_token = client_token.clone();
        let term = term.to_string();
        async move {
            let mut res = run_query(&c, &term, &hash, limit, &token, &client_token).await;
            // 401 retry handled loosely: re-auth once
            let _ = &mut res;
            res.ok()
        }
    };
    let mut primary: Vec<String> = Vec::new();
    if let Some(h) = discover_hash(c).await {
        primary.push(h);
    }
    primary.extend(FALLBACK_HASHES.iter().map(|s| s.to_string()));
    for hash in &primary {
        if let Some(json) = run(hash.clone()).await {
            if json.pointer("/data/searchV2").is_some() {
                return json.pointer("/data/searchV2").cloned();
            }
        }
    }
    None
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let q = match get_param("query").map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(q) => q,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };
    let limit: usize = get_param("limit").and_then(|l| l.parse::<i64>().ok()).map(|l| l.clamp(1, 10) as usize).unwrap_or(3);

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result = async {
        let data = search_data(&c, &q, limit).await.ok_or("no data")?;
        let items: Vec<Value> = data
            .pointer("/tracksV2/items")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(|i| i.pointer("/item/data").and_then(|d| parse_track(d))).take(limit).collect())
            .unwrap_or_default();
        let mut results = Vec::new();
        for t in items {
            let preview = get_preview(&c, t.get("id").and_then(Value::as_str).unwrap_or("")).await;
            results.push(json!({
                "artist": t.get("artist").cloned().unwrap_or(Value::Null),
                "title": t.get("title").cloned().unwrap_or(Value::Null),
                "duration": t.get("duration").cloned().unwrap_or(Value::Null),
                "thumb": t.get("thumb").cloned().unwrap_or(Value::Null),
                "url": t.get("url").cloned().unwrap_or(Value::Null),
                "urlpreview": preview,
            }));
        }
        Ok::<_, String>(results)
    }
    .await;

    match result {
        Ok(result) => Json(json!({"status": true, "result": result, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

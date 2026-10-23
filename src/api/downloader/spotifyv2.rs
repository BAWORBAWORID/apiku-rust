// Spotify Downloader v2 (SpotiSaver) — native conversion of api/downloader/spotifyv2.js
// Flow: warmUp (live signature config from page HTML, fallback hardcoded) →
// /api/get_signature.php with obfuscated param names + base64 context →
// /api/get_playlist.php with signature headers → normalize tracks.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://spotisaver.net";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn b64_encode(s: &str) -> String {
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

fn parse_spotify_url(input: &str) -> Result<(String, String), String> {
    let url = input.trim();
    if let Some(rest) = url.strip_prefix("spotify:") {
        let parts: Vec<&str> = rest.split(':').collect();
        if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Ok((parts[1].split('?').next().unwrap_or("").to_string(), parts[0].to_lowercase()));
        }
        return Err("Format spotify URI tidak valid".into());
    }
    // regex: open.spotify.com/(embed/)?(track|album|playlist|artist|episode|show)/([a-zA-Z0-9]+)
    let lower = url.to_lowercase();
    if let Some(i) = lower.find("open.spotify.com/") {
        let rest = &url[i + 17..];
        let rest = rest.strip_prefix("embed/").unwrap_or(rest);
        for t in ["track", "album", "playlist", "artist", "episode", "show"] {
            if let Some(r2) = rest.strip_prefix(t) {
                if let Some(stripped) = r2.strip_prefix('/') {
                    let id: String = stripped.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
                    if !id.is_empty() {
                        return Ok((id, t.to_string()));
                    }
                }
            }
        }
    }
    Err("URL Spotify tidak valid".into())
}

fn extract_signature_config(html: &str) -> Option<Value> {
    // find "playlistRequestSignature" then "=" then "{" ... balanced "}"
    let idx = html.find("playlistRequestSignature")?;
    let eq = html[idx..].find('=')? + idx;
    let start = html[eq..].find('{')? + eq;
    let mut depth = 0i32;
    let mut in_string: Option<char> = None;
    let mut escaped = false;
    let bytes = html.as_bytes();
    for (bi, &b) in bytes.iter().enumerate().skip(start) {
        let c = b as char;
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
        if let Some(q) = in_string {
            if c == q {
                in_string = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            in_string = Some(c);
            continue;
        }
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                let obj = &html[start..=bi];
                // strip // line comments (crude) — JSON-ish
                let cleaned: String = obj
                    .lines()
                    .map(|l| match l.find("//") {
                        Some(i) if !l[..i].contains('"') || l[..i].matches('"').count() % 2 == 0 => l[..i].to_string(),
                        _ => l.to_string(),
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                // try strict parse, then quoted-keys repair is out of scope
                return serde_json::from_str(&cleaned).ok().or_else(|| serde_json::from_str(obj).ok());
            }
        }
    }
    None
}

fn fallback_config() -> Value {
    json!({
        "endpoint": "/api/get_signature.php",
        "requestToken": "4c0f61e8ca8b3d0fed1c1c2bce00e17f70cb76066c14831029ae9eb2710921e2",
        "wire": {
            "token_param": "ke6efef363b",
            "ctx_param": "c5b9bf82cb0",
            "action_param": "a32137ee70c",
            "sig_header": "X-SCC9AF0BD",
            "exp_header": "X-E000DDCBE",
            "actions": {
                "get_playlist": "xf025ca18c2"
            }
        }
    })
}

fn fmt_duration(ms: u64) -> String {
    let total = (ms / 1000) as u64;
    format!("{}:{:02}", total / 60, total % 60)
}

fn normalize(raw: &Value) -> Value {
    let info = raw.get("playlist_info").cloned().unwrap_or(Value::Null);
    let tracks: Vec<Value> = raw
        .get("tracks")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|t| {
            let dur_ms = t.get("duration_ms").and_then(|d| d.as_u64()).unwrap_or(0);
            json!({
                "id": t.get("id"),
                "name": t.get("name"),
                "artists": t.get("artists").cloned().unwrap_or(json!([])),
                "album": t.get("album").cloned().unwrap_or(Value::Null),
                "image": t.pointer("/image/url").cloned().unwrap_or(Value::Null),
                "duration_ms": dur_ms,
                "duration_human": fmt_duration(dur_ms),
                "popularity": t.get("popularity").cloned().unwrap_or(Value::Null),
                "explicit": t.get("explicit").cloned().unwrap_or(json!(false)),
                "isrc": t.pointer("/external_ids/isrc").cloned().unwrap_or(Value::Null),
                "label": t.get("label").cloned().unwrap_or(Value::Null),
                "release_date": t.get("release_date").cloned().unwrap_or(Value::Null),
                "track_number": t.get("track_number").cloned().unwrap_or(Value::Null),
                "external_url": t.get("external_url").cloned().unwrap_or(Value::Null)
            })
        })
        .collect();
    let total_ms = info.get("total_duration_ms").and_then(|t| t.as_u64()).unwrap_or(0);
    json!({
        "id": info.get("id"),
        "type": info.get("type"),
        "name": info.get("name"),
        "description": info.get("description").cloned().unwrap_or(Value::Null),
        "owner": info.get("owner").cloned().unwrap_or(Value::Null),
        "total_tracks": info.get("total_tracks").cloned().unwrap_or(json!(tracks.len())),
        "total_duration_ms": total_ms,
        "total_duration_human": fmt_duration(total_ms),
        "external_url": info.get("external_url").cloned().unwrap_or(Value::Null),
        "images": info.get("images").cloned().unwrap_or(json!([])),
        "tracks": tracks
    })
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
    if input.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response();
    }

    let (id, typ) = match parse_spotify_url(&input) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "message": e }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    // warmUp: fetch type page, try live signature config
    let (config, source) = match client
        .get(format!("{BASE}/en/{typ}/{id}"))
        .header("User-Agent", UA)
                    .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
    {
        Ok(r) => {
            let html = r.text().await.unwrap_or_default();
            match extract_signature_config(&html) {
                Some(live) => (live, "live"),
                None => (fallback_config(), "fallback"),
            }
        }
        Err(_) => (fallback_config(), "fallback"),
    };

    let endpoint = config.get("endpoint").and_then(|e| e.as_str()).unwrap_or("/api/get_signature.php").to_string();
    let request_token = config.get("requestToken").and_then(|e| e.as_str()).unwrap_or("").to_string();
    let wire = config.get("wire").cloned().unwrap_or(Value::Null);
    let token_param = wire.get("token_param").and_then(|e| e.as_str()).unwrap_or("ke6efef363b").to_string();
    let ctx_param = wire.get("ctx_param").and_then(|e| e.as_str()).unwrap_or("c5b9bf82cb0").to_string();
    let action_param = wire.get("action_param").and_then(|e| e.as_str()).unwrap_or("a32137ee70c").to_string();
    let sig_header = wire.get("sig_header").and_then(|e| e.as_str()).unwrap_or("X-SCC9AF0BD").to_string();
    let exp_header = wire.get("exp_header").and_then(|e| e.as_str()).unwrap_or("X-E000DDCBE").to_string();
    let action_code = wire.pointer("/actions/get_playlist").and_then(|e| e.as_str()).unwrap_or("xf025ca18c2").to_string();

    // getSignature
    let ctx = b64_encode(&json!({ "id": id, "type": typ, "lang": "en" }).to_string());
    let sig_url = format!(
        "{BASE}{endpoint}?{}={}&{}={}&{}={}",
        token_param,
        urlencoding::encode(&request_token),
        action_param,
        urlencoding::encode(&action_code),
        ctx_param,
        urlencoding::encode(&ctx)
    );
    let sig_json: Value = match client
        .get(&sig_url)
        .header("User-Agent", UA)
                    .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => {
            let st = r.status().as_u16();
            let j: Value = r.json().await.unwrap_or(Value::Null);
            let ok = j.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
            if st != 200 || !ok || j.get("token").is_none() {
                return (StatusCode::BAD_GATEWAY, Json(json!({
                    "status": false,
                    "message": format!("Signature gagal (HTTP {st}) — SpotiVault menolak signature (provider mungkin berubah).")
                }))).into_response();
            }
            j
        }
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": format!("Signature gagal: {e} — SpotiVault menolak signature (provider mungkin berubah).")
        }))).into_response(),
    };
    let token = sig_json.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let exp = sig_json.get("exp").and_then(|t| t.as_str()).unwrap_or("").to_string();

    // getPlaylist
    let url = format!("{BASE}/api/get_playlist.php?id={}&type={}&lang=en", urlencoding::encode(&id), urlencoding::encode(&typ));
    let raw: Value = match client
        .get(&url)
        .header("User-Agent", UA)
                    .header("Accept", "application/json")
        .header("Referer", format!("{BASE}/en/{typ}/{id}"))
        .header(&sig_header, token)
        .header(&exp_header, exp)
        .send()
        .await
    {
        Ok(r) => {
            let st = r.status().as_u16();
            let j: Value = r.json().await.unwrap_or(Value::Null);
            if st != 200 || j.get("playlist_info").is_none() {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                    "status": false, "message": format!("Playlist gagal (HTTP {st})")
                }))).into_response();
            }
            j
        }
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Playlist gagal: {e}")
        }))).into_response(),
    };

    Json(json!({
        "status": true,
        "duration": "0ms",
        "result": {
            "id": id,
            "type": typ,
            "configSource": source,
            "playlist": normalize(&raw)
        }
    })).into_response()

}

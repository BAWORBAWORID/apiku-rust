// Apple Music Downloader (AplMate) — native conversion of api/downloader/applemusic.js
// Node version shelled out to curl with a cookie jar (-b/-c cookie file). Native:
// reqwest + in-process cookie string (set-cookie captured from responses).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use reqwest::header;

const BASE: &str = "https://aplmate.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

static COOKIE: Mutex<Option<String>> = Mutex::new(None);

fn take_cookie() -> String {
    COOKIE.lock().ok().and_then(|c| c.clone()).unwrap_or_default()
}

fn store_cookie(headers: &reqwest::header::HeaderMap) {
    let jar: Vec<String> = headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").to_string())
        .collect();
    if jar.is_empty() {
        return;
    }
    let mut guard = COOKIE.lock().unwrap_or_else(|e| e.into_inner());
    let existing: HashMap<String, String> = guard
        .clone()
        .unwrap_or_default()
        .split("; ")
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let mut updated = existing;
    for kv in jar {
        if let Some((k, v)) = kv.split_once('=') {
            updated.insert(k.to_string(), v.to_string());
        }
    }
    *guard = Some(
        updated
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; "),
    );
}

fn b64_decode(input: &str) -> Option<Vec<u8>> {
    const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| *b != b'=' && *b != b'\n' && *b != b'\r')
        .collect();
    let mut out = Vec::new();
    for chunk in clean.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let idx = |c: u8| TBL.iter().position(|t| *t == c).map(|p| p as u32);
        let a = idx(chunk[0])?;
        let b = idx(chunk[1])?;
        let n = (a << 18) | (b << 12);
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            let c = idx(chunk[2])?;
            let n = n | (c << 6);
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            let d = idx(chunk[3])?;
            let n = n | d;
            out.push(n as u8);
        }
    }
    Some(out)
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())
}

async fn curl_form(client: &reqwest::Client, path: &str, form: &[(&str, &str)]) -> Result<String, String> {
    let mut req = client
        .post(format!("{BASE}{path}"))
        .header("User-Agent", UA)
        .header("Origin", BASE)
        .header("Referer", format!("{BASE}/"))
                    .header("X-Requested-With", "XMLHttpRequest")
                    .header("Accept", "*/*")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    let cookie = take_cookie();
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    let encoded: Vec<String> = form
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect();
    let resp = req
        .body(encoded.join("&"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    store_cookie(resp.headers());
    resp.text().await.map_err(|e| e.to_string())
}

async fn get_token(client: &reqwest::Client, url_value: &str, lang: &str) -> String {
    let raw = curl_form(client, "/action/userverify", &[("url", url_value), ("lang", lang)]).await.unwrap_or_default();
    let json: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    json.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string()
}

fn regex_find<'a>(text: &'a str, before: &str, terminator: char) -> Option<&'a str> {
    let i = text.find(before)?;
    let rest = &text[i + before.len()..];
    let end = rest.find(terminator)?;
    Some(&rest[..end])
}

fn parse_search(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for b in html.split("<div class=\"mb-3 grid-container\">").skip(1) {
        let num: Option<u32> = b
            .find("<span")
            .and_then(|i| {
                let seg = &b[i..];
                let gt = seg.find('>')? + 1;
                let end = seg[gt..].find('<')?;
                seg[gt..gt + end].trim_end_matches(':').parse().ok()
            });
        // info: <div class="grid-text"><span...>TITLE</span><br>ARTIST</div>
        let info: Option<(String, String)> = b.find("grid-text").and_then(|i| {
            let seg = &b[i..];
            let gt = seg.find('>')? + 1;
            let rest = &seg[gt..];
            let title_end = rest.find('<')?;
            let title = rest[..title_end].trim().to_string();
            let after_br = rest.split("<br>").nth(1)?;
            let artist_end = after_br.find('<').unwrap_or(after_br.len());
            let artist = after_br[..artist_end].trim().to_string();
            Some((title, artist))
        });
        let data = regex_find(b, "name=\"data\" value=\"", '"').map(|s| s.to_string());
        let base = regex_find(b, "name=\"base\" value=\"", '"').map(|s| s.to_string());
        let token = regex_find(b, "name=\"token\" value=\"", '"').map(|s| s.to_string());

        let decoded: Value = data
            .as_ref()
            .and_then(|d| b64_decode(d))
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);

        if let (Some(info), Some(data)) = (info, data) {
            out.push(json!({
                "no": num,
                "title": decode_entities(&info.0),
                "artist": decode_entities(&info.1),
                "album": decoded.get("album").cloned().unwrap_or(Value::Null),
                "cover": decoded.get("cover").cloned().unwrap_or(Value::Null),
                "duration": decoded.get("duration").cloned().unwrap_or(Value::Null),
                "apple_url": decoded.get("surl").cloned().or_else(|| base.clone().map(Value::String)).unwrap_or(Value::Null),
                "apple_id": decoded.get("id").cloned().unwrap_or(Value::Null),
                "data": data,
                "base": base,
                "token": token
            }));
        }
    }
    out
}

fn parse_downloads(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("<a ") {
        let seg = &rest[i..];
        let href = regex_find(seg, "href=\"", '"').unwrap_or("").to_string();
        let label_end = seg.find('>').map(|j| &seg[j + 1..]).unwrap_or("");
        let label = label_end.split('<').next().unwrap_or("").trim().to_string();
        if href.starts_with("http") {
            out.push(json!({ "label": label, "url": href }));
        }
        rest = &rest[(i + 3).min(rest.len())..];
    }
    out
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "query", "q", "action"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let input = ["url", "query", "q"]
        .iter()
        .find_map(|k| merged.get(*k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty()))
        .unwrap_or_default();
    let action = merged.get("action").map(|s| s.trim().to_lowercase()).unwrap_or_default();

    if input.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'url' atau 'query' wajib diisi (URL Apple Music atau judul lagu)"
        }))).into_response();
    }

    let client = match client() {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e
        }))).into_response(),
    };

    let is_apple_url = input.contains("music.apple.com");

    if action == "download" || (action.is_empty() && is_apple_url) {
        // downloadTrack
        let token = get_token(&client, &input, "en").await;
        let raw_search = match curl_form(&client, "/action", &[("url", &input), ("lang", "en"), ("cf-turnstile-response", &token)]).await {
            Ok(r) => r,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": format!("Respons provider bukan format JSON: {e}")
            }))).into_response(),
        };
        let search_json: Value = match serde_json::from_str(&raw_search) {
            Ok(j) => j,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": "Respons provider bukan format JSON"
            }))).into_response(),
        };
        if search_json.get("error").and_then(|e| e.as_bool()).unwrap_or(false) {
            let msg = search_json.get("message").and_then(|m| m.as_str()).unwrap_or("Gagal memproses URL lagu");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": msg }))).into_response();
        }
        let list = parse_search(search_json.get("html").and_then(|h| h.as_str()).unwrap_or(""));
        let apple_id: Option<String> = {
            let i = input.find("song/");
            i.and_then(|p| {
                let rest = &input[p + 5..];
                let id: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if id.is_empty() { None } else { Some(id) }
            })
        };
        let matched = apple_id
            .as_ref()
            .and_then(|id| list.iter().find(|x| x.get("apple_id").and_then(|a| a.as_str()) == Some(id.as_str())))
            .or_else(|| list.first());
        let matched = match matched {
            Some(m) => m,
            None => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": "Lagu tidak ditemukan pada Apple Music"
            }))).into_response(),
        };
        let data = matched.get("data").and_then(|d| d.as_str()).unwrap_or("");
        let base = matched.get("base").and_then(|d| d.as_str()).unwrap_or("");
        let tok = matched.get("token").and_then(|d| d.as_str()).unwrap_or("");
        let raw_track = match curl_form(&client, "/action/track", &[("lang", "en"), ("data", data), ("base", base), ("token", tok)]).await {
            Ok(r) => r,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": format!("Respons download provider bukan JSON: {e}")
            }))).into_response(),
        };
        let track_json: Value = match serde_json::from_str(&raw_track) {
            Ok(j) => j,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": "Respons download provider bukan JSON"
            }))).into_response(),
        };
        if track_json.get("error").and_then(|e| e.as_bool()).unwrap_or(false) {
            let msg = track_json.get("message").and_then(|m| m.as_str()).unwrap_or("Gagal mengambil data download");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": msg }))).into_response();
        }
        let downloads = parse_downloads(track_json.get("data").and_then(|d| d.as_str()).unwrap_or(""));
        Json(json!({
            "status": true,
            "source": input,
            "type": "download",
            "title": matched.get("title"),
            "artist": matched.get("artist"),
            "album": matched.get("album"),
            "cover": matched.get("cover"),
            "duration": matched.get("duration"),
            "apple_id": matched.get("apple_id"),
            "total_downloads": downloads.len(),
            "downloads": downloads
        }))
        .into_response()
    } else {
        // searchTracks
        let token = get_token(&client, &input, "en").await;
        let raw = match curl_form(&client, "/action", &[("url", &input), ("lang", "en"), ("cf-turnstile-response", &token)]).await {
            Ok(r) => r,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": format!("Respons provider bukan format JSON: {e}")
            }))).into_response(),
        };
        let json_val: Value = match serde_json::from_str(&raw) {
            Ok(j) => j,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": "Respons provider bukan format JSON"
            }))).into_response(),
        };
        if json_val.get("error").and_then(|e| e.as_bool()).unwrap_or(false) {
            let msg = json_val.get("message").and_then(|m| m.as_str()).unwrap_or("Gagal melakukan pencarian");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": msg }))).into_response();
        }
        let results = parse_search(json_val.get("html").and_then(|h| h.as_str()).unwrap_or(""));
        Json(json!({
            "status": true,
            "source": format!("{BASE}/"),
            "type": "search",
            "keyword": input,
            "total": results.len(),
            "results": results.iter().map(|r| json!({
                "no": r.get("no"),
                "title": r.get("title"),
                "artist": r.get("artist"),
                "album": r.get("album"),
                "cover": r.get("cover"),
                "duration": r.get("duration"),
                "apple_url": r.get("apple_url"),
                "apple_id": r.get("apple_id")
            })).collect::<Vec<_>>()
        }))
        .into_response()
    }
}

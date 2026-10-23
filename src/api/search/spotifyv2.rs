// Spotify Search V2 — native conversion of api/search/spotifyv2.js
// Pathfinder API v2 dengan sesi sp_dc: actions search (searchTracks) & track (getTrack + canvas).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

const SP_DC_DEFAULT: &str = "AQC-oNwaNiWJYiy-dUglqW4orzYTrXXUzpCRZ5KC0dckVOMlERTuDXPqBUSvdY58rjr3sM0ikIXZNEClBsMNliSF4kcxflyyn4NiB-NdFGU2lUp2G5J559Jj269ytQvNI8Mx2WxJFCo5HrEmcHevuIlyunoRHuV45WJmDnE_VlgMUaSSc2mF5wxtd8M3LEF14usdLZKw_VYNbzCipBhZzXcS-XQHZtP5tby6bywU4Gz0nYqT9OFGADZtvyd_WdqGDm3qUQOCsKWSyfI";

struct State {
    sp_dc: String,
    totp_secret: String,
    totp_version: String,
    access_token: Mutex<String>,
    client_token: Mutex<String>,
    token_expiry: Mutex<f64>,
}

fn state() -> &'static State {
    static S: std::sync::OnceLock<State> = std::sync::OnceLock::new();
    S.get_or_init(|| State {
        sp_dc: std::env::var("SP_DC").unwrap_or_else(|_| SP_DC_DEFAULT.to_string()),
        totp_secret: String::new(),
        totp_version: "61".to_string(),
        access_token: Mutex::new(String::new()),
        client_token: Mutex::new(String::new()),
        token_expiry: Mutex::new(0.0),
    })
}

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_latest_totp_from_web(c: &reqwest::Client) -> bool {
    let Ok(html) = c.get("https://open.spotify.com/").send().await else { return false };
    let Ok(html) = html.text().await else { return false };
    let re = regex::Regex::new(r#"src="([^"]*/cdn/build/(?:web-player/web-player|mobile-web-player/mobile-web-player)\.[a-f0-9]+\.js)""#).unwrap();
    let Some(m) = re.captures(&html) else { return false };
    let mut js_url = m[1].to_string();
    if !js_url.starts_with("http") {
        js_url = format!("https://open.spotifycdn.com{}", js_url);
    }
    let Ok(js) = c.get(&js_url).send().await else { return false };
    let Ok(js_text) = js.text().await else { return false };
    let re_arr = regex::Regex::new(r"(?s)let\s+[a-zA-Z0-9_$]+\s*=\s*(\[\s*\{secret:.*?\}\s*\])\.map").unwrap();
    let Some(am) = re_arr.captures(&js_text) else { return false };
    let re_items = regex::Regex::new(r#"secret:\s*(['"])(.*?)\1\s*,\s*version:\s*(\d+)"#).unwrap();
    let mut best: Option<(u32, String, String)> = None;
    for im in re_items.captures_iter(&am[1]) {
        let ver: u32 = im[3].parse().unwrap_or(0);
        if best.as_ref().map(|(b, _, _)| ver > *b).unwrap_or(true) {
            best = Some((ver, im[2].to_string(), im[3].to_string()));
        }
    }
    if let Some((_, secret, version)) = best {
        // Cannot mutate OnceLock fields; store into statics instead
        TOTP_SECRET_STORE.lock().unwrap().replace_range(.., &secret);
        TOTP_VERSION_STORE.lock().unwrap().replace_range(.., &version);
        return true;
    }
    false
}

static TOTP_SECRET_STORE: Mutex<String> = Mutex::new(String::new());
static TOTP_VERSION_STORE: Mutex<String> = Mutex::new(String::new());

fn current_totp_secret() -> String {
    let st = TOTP_SECRET_STORE.lock().unwrap().clone();
    if !st.is_empty() {
        st
    } else {
        state().totp_secret.clone()
    }
}

fn current_totp_version() -> String {
    let v = TOTP_VERSION_STORE.lock().unwrap().clone();
    if !v.is_empty() {
        v
    } else {
        state().totp_version.clone()
    }
}

fn generate_totp(ts_ms: u64, secret: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha1::Sha1;
    let mut r = String::new();
    for (i, ch) in secret.chars().enumerate() {
        r.push_str(&(ch as u32 ^ (((i % 33) + 9) as u32)).to_string());
    }
    let raw_key = r.as_bytes();
    let counter = ts_ms / 1000 / 30;
    let buf = counter.to_be_bytes();
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(raw_key) else { return "000000".to_string() };
    mac.update(&buf);
    let digest = mac.finalize().into_bytes();
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let truncated = u32::from_be_bytes([digest[offset], digest[offset + 1], digest[offset + 2], digest[offset + 3]]) & 0x7fffffff;
    format!("{:06}", truncated % 1000000)
}

async fn get_client_token(c: &reqwest::Client) -> Result<String, String> {
    let payload = json!({
        "client_data": {
            "client_version": "1.2.98.59.g81a1284c-development",
            "client_id": "d8a5ed958d274c2e8ee717e6a4b0971d",
            "js_sdk_data": {"device_brand": "Google", "device_model": "desktop", "os": "Windows", "os_version": "NT 10.0"},
        }
    });
    let res = c
        .post("https://clienttoken.spotify.com/v1/clienttoken")
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to get client-token: {}", res.status().as_u16()));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    data.pointer("/granted_token/token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "client-token tidak ada".to_string())
}

async fn get_access_token(c: &reqwest::Client) -> Result<String, String> {
    for attempt in 0..2 {
        let totp = generate_totp(chrono::Utc::now().timestamp_millis() as u64, &current_totp_secret());
        let url = format!(
            "https://open.spotify.com/api/token?reason=init&productType=web-player&totp={}&totpServer={}&totpVer={}",
            totp,
            totp,
            current_totp_version()
        );
        let res = c
            .get(&url)
            .header("Cookie", format!("sp_dc={}", state().sp_dc))
                        .header("Referer", "https://open.spotify.com/")
                        .header("Origin", "https://open.spotify.com")
                        .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().is_success() {
            let data: Value = res.json().await.map_err(|e| e.to_string())?;
            let token = data.get("accessToken").and_then(Value::as_str).unwrap_or("").to_string();
            *state().token_expiry.lock().unwrap() = data.get("accessTokenExpirationTimestampMs").and_then(Value::as_f64).unwrap_or(0.0) / 1000.0;
            *state().access_token.lock().unwrap() = token.clone();
            return Ok(token);
        }
        if res.status().as_u16() == 400 && attempt == 0 && fetch_latest_totp_from_web(c).await {
            continue;
        }
        return Err(format!("Failed to get access-token ({})", res.status().as_u16()));
    }
    Err("Failed to get access-token".into())
}

async fn ensure_tokens(c: &reqwest::Client) -> Result<(String, String), String> {
    if state().client_token.lock().unwrap().is_empty() {
        let ct = get_client_token(c).await?;
        *state().client_token.lock().unwrap() = ct;
    }
    let expiry = *state().token_expiry.lock().unwrap();
    if state().access_token.lock().unwrap().is_empty()
        || (chrono::Utc::now().timestamp_millis() as f64) / 1000.0 > expiry - 60.0
    {
        get_access_token(c).await?;
    }
    Ok((state().access_token.lock().unwrap().clone(), state().client_token.lock().unwrap().clone()))
}

async fn query_pathfinder(c: &reqwest::Client, operation_name: &str, sha256_hash: &str, variables: Value) -> Result<Value, String> {
    let (token, client_token) = ensure_tokens(c).await?;
    let payload = json!({
        "variables": variables,
        "operationName": operation_name,
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": sha256_hash}},
    });
    let res = c
        .post("https://api-partner.spotify.com/pathfinder/v2/query")
        .header("Authorization", format!("Bearer {}", token))
        .header("client-token", &client_token)
                    .header("Content-Type", "application/json;charset=UTF-8")
                    .header("Origin", "https://open.spotify.com")
                    .header("Referer", "https://open.spotify.com/")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Pathfinder '{}' failed ({})", operation_name, res.status().as_u16()));
    }
    res.json().await.map_err(|e| e.to_string())
}

fn extract_id(input: &str, expected_type: Option<&str>) -> Result<String, String> {
    if input.is_empty() {
        return Err("ID atau URL Spotify tidak boleh kosong.".into());
    }
    let input = input.trim();
    let re_url = regex::Regex::new(r"spotify\.com/[^#?*/]*/(track|artist|album|playlist)/([a-zA-Z0-9]+)").unwrap();
    if let Some(m) = re_url.captures(input) {
        let actual = &m[1];
        if let Some(exp) = expected_type {
            if actual != exp {
                return Err(format!("Input yang Anda masukkan adalah URL {}, sedangkan endpoint ini memerlukan {}.", actual, exp));
            }
        }
        return Ok(m[2].to_string());
    }
    let re_uri = regex::Regex::new(r"spotify:(track|artist|album|playlist):([a-zA-Z0-9]+)").unwrap();
    if let Some(m) = re_uri.captures(input) {
        let actual = &m[1];
        if let Some(exp) = expected_type {
            if actual != exp {
                return Err(format!("Input yang Anda masukkan adalah URI {}, sedangkan endpoint ini memerlukan {}.", actual, exp));
            }
        }
        return Ok(m[2].to_string());
    }
    let clean_id = input.split('?').next().unwrap_or("").split('/').next_back().unwrap_or("").split(':').next_back().unwrap_or("").trim().to_string();
    if !regex::Regex::new(r"^[a-zA-Z0-9]+$").unwrap().is_match(&clean_id) {
        return Err(format!("Format ID/URL Spotify tidak valid: '{}'", input));
    }
    Ok(clean_id)
}

async fn get_canvas_url(c: &reqwest::Client, track_id: &str) -> Option<String> {
    let (token, client_token) = ensure_tokens(c).await.ok()?;
    let track_uri = format!("spotify:track:{}", track_id);
    let uri_buf = track_uri.as_bytes();
    let track_msg: Vec<u8> = [vec![0x0a, uri_buf.len() as u8], uri_buf.to_vec()].concat();
    let req_msg: Vec<u8> = [vec![0x0a, track_msg.len() as u8], track_msg].concat();

    let res = c
        .post("https://spclient.wg.spotify.com/canvaz-cache/v0/canvases")
        .header("Authorization", format!("Bearer {}", token))
        .header("client-token", &client_token)
                    .header("App-Platform", "Android")
                    .header("Content-Type", "application/x-protobuf")
        .body(req_msg)
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let buf = res.bytes().await.ok()?;
    if buf.len() <= 10 {
        return None;
    }
    // Printable-only string scan
    let text: String = buf
        .iter()
        .filter(|&&b| (0x20..=0x7e).contains(&b))
        .map(|&b| b as char)
        .collect();
    let re = regex::Regex::new(r"https://canvaz\.scdn\.co/[^\s]*\.cnvs\.mp4").unwrap();
    re.find(&text).map(|m| m.as_str().to_string())
}

fn fmt_dur(ms: u64) -> String {
    format!("{}:{:02}", ms / 60000, (ms % 60000) / 1000)
}

async fn get_track_details(c: &reqwest::Client, input: &str) -> Result<Value, String> {
    let track_id = extract_id(input, Some("track"))?;
    let data = query_pathfinder(
        c,
        "getTrack",
        "1a2f0cce77c90a4a5b1730beecc4da7e34290d684324c16663bf09a268ebce48",
        json!({"uri": format!("spotify:track:{}", track_id)}),
    )
    .await?;
    let t = data.pointer("/data/trackUnion").ok_or_else(|| format!("Lagu dengan ID '{}' tidak ditemukan di Spotify.", track_id))?;
    if t.get("__typename").and_then(Value::as_str) == Some("NotFound") {
        return Err(format!("Lagu dengan ID '{}' tidak ditemukan di Spotify.", track_id));
    }
    let dur_ms = t.pointer("/duration/totalMilliseconds").and_then(Value::as_u64).unwrap_or(0);
    let album_data = t.get("albumOfTrack").cloned().unwrap_or(json!({}));
    let album_id = album_data.get("uri").and_then(Value::as_str).map(|u| u.split(':').next_back().unwrap_or("").to_string()).unwrap_or_default();
    let covers = album_data.pointer("/coverArt/sources").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut all_artists: Vec<Value> = Vec::new();
    if let Some(arr) = t.pointer("/firstArtist/items").and_then(Value::as_array) {
        all_artists.extend(arr.clone());
    }
    if let Some(arr) = t.pointer("/otherArtists/items").and_then(Value::as_array) {
        all_artists.extend(arr.clone());
    }
    let artists_names: Vec<String> = all_artists.iter().filter_map(|a| a.pointer("/profile/name").and_then(Value::as_str).map(str::to_string)).collect();
    let artist_id = all_artists.first().and_then(|a| a.get("uri")).and_then(Value::as_str).map(|u| u.split(':').next_back().unwrap_or("").to_string()).unwrap_or_default();

    let playcount_int = t.get("playcount").and_then(|p| p.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| p.as_i64()));
    let is_explicit = t.pointer("/contentRating/label").and_then(Value::as_str) == Some("EXPLICIT");
    let release_date = album_data.pointer("/date/isoString").and_then(Value::as_str).unwrap_or("").to_string();
    let canvas_url = get_canvas_url(c, &track_id).await;

    Ok(json!({
        "id": track_id,
        "title": t.get("name").cloned().unwrap_or(Value::Null),
        "artists": artists_names.join(", "),
        "artist_id": artist_id,
        "album": album_data.get("name").cloned().unwrap_or(Value::Null),
        "album_id": album_id,
        "release_date": if release_date.len() >= 10 { &release_date[..10] } else { "" },
        "duration": fmt_dur(dur_ms),
        "playcount": playcount_int,
        "playcount_formatted": playcount_int.map(|p| json!(p.to_string())).unwrap_or(json!("0")),
        "is_explicit": is_explicit,
        "cover_url": covers.last().and_then(|cc| cc.get("url")).cloned().unwrap_or(json!("")),
        "canvas_url": canvas_url,
        "spotify_url": format!("https://open.spotify.com/track/{}", track_id),
    }))
}

async fn search_tracks(c: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<Value>, String> {
    let variables = json!({
        "searchTerm": query,
        "offset": 0,
        "limit": limit,
        "numberOfTopResults": limit,
        "includeAudiobooks": true,
        "includeAuthors": false,
        "includePreReleases": true,
        "includeAlbumPreReleases": false,
        "includeEpisodeContentRatingsV2": true,
    });
    let data = query_pathfinder(c, "searchTracks", "59ee4a659c32e9ad894a71308207594a65ba67bb6b632b183abe97303a51fa55", variables).await?;
    let items = data.pointer("/data/searchV2/tracksV2/items").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut results = Vec::new();
    for it in items {
        let Some(t) = it.pointer("/item/data") else { continue };
        let tid = t.get("uri").and_then(Value::as_str).unwrap_or("").split(':').next_back().unwrap_or("").to_string();
        let artists_raw = t.pointer("/artists/items").and_then(Value::as_array).cloned().unwrap_or_default();
        let artists_names: Vec<String> = artists_raw.iter().filter_map(|a| a.pointer("/profile/name").and_then(Value::as_str).map(str::to_string)).collect();
        let first_artist_id = artists_raw.first().and_then(|a| a.get("uri")).and_then(Value::as_str).map(|u| u.split(':').next_back().unwrap_or("").to_string()).unwrap_or_default();
        let album_data = t.get("albumOfTrack").cloned().unwrap_or(json!({}));
        let album_id = album_data.get("uri").and_then(Value::as_str).map(|u| u.split(':').next_back().unwrap_or("").to_string()).unwrap_or_default();
        let covers = album_data.pointer("/coverArt/sources").and_then(Value::as_array).cloned().unwrap_or_default();
        let dur_ms = t.pointer("/duration/totalMilliseconds").and_then(Value::as_u64).unwrap_or(0);
        let is_explicit = t.pointer("/contentRating/label").and_then(Value::as_str) == Some("EXPLICIT");

        results.push(json!({
            "id": tid,
            "title": t.get("name").cloned().unwrap_or(json!("")),
            "artists": artists_names.join(", "),
            "artist_id": first_artist_id,
            "album": album_data.get("name").cloned().unwrap_or(json!("")),
            "album_id": album_id,
            "duration": fmt_dur(dur_ms),
            "is_explicit": is_explicit,
            "cover_url": covers.last().and_then(|cc| cc.get("url")).cloned().unwrap_or(json!("")),
            "spotify_url": format!("https://open.spotify.com/track/{}", tid),
        }));
    }
    Ok(results)
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

    let mode = get_param("action").unwrap_or_else(|| "search".to_string()).trim().to_lowercase();
    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    if mode == "track" {
        let url = get_param("url").unwrap_or_default();
        let re_ok = regex::Regex::new(r"spotify\.com/(?:[^#?]*/)?(?:track|album|playlist|artist)/").unwrap();
        if url.is_empty() || !re_ok.is_match(&url) {
            return err(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi dengan link Spotify");
        }
        return match get_track_details(&c, url.trim()).await {
            Ok(r) => Json(json!({"status": true, "result": r, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    if mode != "search" {
        return err(StatusCode::BAD_REQUEST, "Parameter 'action' harus 'search' atau 'track'");
    }

    let q = match get_param("query").map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(q) => q,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };
    let limit: usize = get_param("limit").and_then(|l| l.parse::<i64>().ok()).map(|l| l.clamp(1, 20) as usize).unwrap_or(5);

    match search_tracks(&c, &q, limit).await {
        Ok(result) => Json(json!({"status": true, "result": result, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

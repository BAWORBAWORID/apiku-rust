// 7REELS Movie & TV Stream Downloader — native conversion of api/downloader/7reels.js
// Flow: getEmbedKey (3-step bundle scrape 7reels.cc) → 11 embed server URLs →
// direct stream via resolvePagePlayer (enc-dec.app enc/dec round-trip).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Instant;
use reqwest::header;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FALLBACK_EMBED_KEY: &str = "key_c90081fa77254eb5";

static CACHED_EMBED_KEY: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", UA.parse().unwrap());
    h.insert("Accept", "application/json, text/plain, */*".parse().unwrap());
    h
}

fn json_headers(domain: &str) -> reqwest::header::HeaderMap {
    let mut h = base_headers();
    h.insert("Referer", format!("https://{domain}/").parse().unwrap());
    h.insert("X-Requested-With", "XMLHttpRequest".parse().unwrap());
    h
}

async fn get_embed_key(client: &reqwest::Client) -> String {
    {
        let g = CACHED_EMBED_KEY.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = g.as_ref() {
            return k.clone();
        }
    }
    let result: Option<String> = (|| async {
        let home = client
            .get("https://7reels.cc")
            .headers(base_headers())
            .send()
            .await
            .ok()?;
        let html = home.text().await.ok()?;
        // src="/assets/index-xxxxxxxx.js" or href=...
        let mut bundle_path: Option<String> = None;
        for marker in ["src=\"/assets/index-", "href=\"/assets/index-"] {
            if let Some(i) = html.find(marker) {
                let rest = &html[i + marker.len()..];
                // 8 alnum chars then .js
                let end = rest.find(".js")?;
                let name = &rest[..end];
                if name.len() == 8 && name.chars().all(|c| c.is_ascii_alphanumeric()) {
                    bundle_path = Some(format!("/assets/index-{name}.js"));
                    break;
                }
            }
        }
        let bundle_path = bundle_path?;
        let main = client
            .get(format!("https://7reels.cc{bundle_path}"))
            .headers(base_headers())
            .send()
            .await
            .ok()?;
        let main_js = main.text().await.ok()?;
        // chunk name containing AdSafetyWarning-xxxxxxxx.js
        let mut chunk: Option<String> = None;
        {
            let mut pos = 0usize;
            while let Some(rel) = main_js[pos..].find("AdSafetyWarning-") {
                let i = pos + rel;
                let before = &main_js[..i];
                let start = before
                    .char_indices()
                    .rev()
                    .take_while(|(_, c)| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                    .map(|(ci, _)| ci)
                    .last()
                    .unwrap_or(i);
                if let Some(j) = main_js[i..].find(".js") {
                    chunk = Some(main_js[start..i + j + 3].to_string());
                    break;
                }
                pos = i + 16;
            }
        }
        let chunk = chunk?;
        let warning = client
            .get(format!("https://7reels.cc/assets/{chunk}"))
            .headers(base_headers())
            .send()
            .await
            .ok()?;
        let warning_js = warning.text().await.ok()?;
        // key_[a-f0-9]+
        let mut found: Option<String> = None;
        let mut rest = warning_js.as_str();
        while let Some(i) = rest.find("key_") {
            let after = &rest[i + 4..];
            let hexlen = after.chars().take_while(|c| c.is_ascii_hexdigit()).count();
            if hexlen > 0 {
                found = Some(format!("key_{}", &after[..hexlen]));
                break;
            }
            rest = after;
        }
        found
    })()
    .await;
    let key = result.unwrap_or_else(|| FALLBACK_EMBED_KEY.to_string());
    *CACHED_EMBED_KEY.lock().unwrap_or_else(|e| e.into_inner()) = Some(key.clone());
    key
}

fn stream_url(key: &str, player: &str, is_tv: bool, id: &str, s: u32, e: u32) -> String {
    if !is_tv {
        match player {
            "2embed" => format!("https://www.2embed.cc/embed/{id}"),
            "strigil" => format!("https://strigil.cc/embed/movie/{id}?embedKey={key}&autoPlay=true&theme=16A085&sub=en"),
            "vidsuper" => format!("https://vidsuper.net/movie/{id}?overlay=true&color=16A085"),
            "videasy" => format!("https://player.videasy.net/movie/{id}?overlay=true&color=16A085"),
            "vidcore" => format!("https://vidcore.net/movie/{id}?autoPlay=true&sub=en"),
            "vidsrc0" => format!("https://vidsrc.mov/embed/movie/{id}"),
            "vidrock" => format!("https://vidrock.net/movie/{id}"),
            "vidnest" => format!("https://vidnest.fun/movie/{id}"),
            "vidlink" => format!("https://vidlink.pro/movie/{id}"),
            "vidify" => format!("https://player.vidify.top/embed/movie/{id}"),
            "vidzee" => format!("https://player.vidzee.wtf/embed/movie/{id}"),
            _ => String::new(),
        }
    } else {
        match player {
            "2embed" => format!("https://www.2embed.cc/embedtv/{id}&s={s}&e={e}"),
            "strigil" => format!("https://strigil.cc/embed/tv/{id}/{s}/{e}?embedKey={key}&autoPlay=true&theme=16A085&sub=en"),
            "vidsuper" => format!("https://vidsuper.net/tv/{id}/{s}/{e}?overlay=true&color=16A085"),
            "videasy" => format!("https://player.videasy.net/tv/{id}/{s}/{e}?overlay=true&color=16A085"),
            "vidcore" => format!("https://vidcore.net/tv/{id}/{s}/{e}?autoPlay=true&sub=en"),
            "vidsrc0" => format!("https://vidsrc.mov/embed/tv/{id}/{s}/{e}"),
            "vidrock" => format!("https://vidrock.net/tv/{id}/{s}/{e}"),
            "vidnest" => format!("https://vidnest.fun/tv/{id}/{s}/{e}"),
            "vidlink" => format!("https://vidlink.pro/tv/{id}/{s}/{e}"),
            "vidify" => format!("https://player.vidify.top/embed/tv/{id}/{s}/{e}"),
            "vidzee" => format!("https://player.vidzee.wtf/embed/tv/{id}/{s}/{e}"),
            _ => String::new(),
        }
    }
}

const EMBED_PLAYERS: &[(&str, &str, &str)] = &[
    ("strigil", "Strigil", "4K HDR"),
    ("videasy", "VidEasy", "4K"),
    ("vidsuper", "VidSuper", "4K"),
    ("vidcore", "VidCore", "1080p"),
    ("vidrock", "AdRock", "1080p"),
    ("vidnest", "VidNest", "1080p"),
    ("vidlink", "VidLink", "1080p"),
    ("vidify", "Vidify", "1080p"),
    ("vidzee", "VidZee", "1080p"),
    ("vidsrc0", "VidSrc", "1080p"),
    ("2embed", "2Embed", "1080p"),
];

async fn resolve_page_player(
    client: &reqwest::Client,
    player_key: &str,
    domain: &str,
    tmdb_id: &str,
    is_tv: bool,
    s: u32,
    e: u32,
) -> Result<Value, String> {
    let base_url = if is_tv {
        format!("https://{domain}/tv/{tmdb_id}/{s}/{e}/")
    } else {
        format!("https://{domain}/movie/{tmdb_id}/")
    };
    let page = client
        .get(&base_url)
        .headers(base_headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html = page.text().await.map_err(|e| e.to_string())?;

    // \"en\":\"...\" (escaped) or "en":"..."
    let mut text: Option<String> = None;
    for needle in ["\\\"en\\\":\\\"", "\"en\":\""] {
        if let Some(i) = html.find(needle) {
            let rest = &html[i + needle.len()..];
            if let Some(j) = rest.find(if needle.ends_with("\\\\\"") { "\\\"" } else { "\"" }) {
                text = Some(rest[..j].to_string());
                break;
            }
        }
    }
    let text = text.ok_or_else(|| format!("Failed to find encrypted content on {domain}"))?;

    let enc_url = format!("https://enc-dec.app/api/enc-{player_key}?text={text}");
    let parts: Value = client
        .get(&enc_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if parts.get("status").and_then(|s| s.as_i64()) != Some(200) {
        return Err(parts
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("Encryption failed")
            .to_string());
    }
    let result = parts.get("result").cloned().unwrap_or(Value::Null);
    let servers = result.get("servers").and_then(|s| s.as_str()).unwrap_or("").to_string();
    let stream = result.get("stream").and_then(|s| s.as_str()).unwrap_or("").to_string();
    let token = result.get("token").and_then(|s| s.as_str()).unwrap_or("").to_string();

    let mut headers = json_headers(domain);
    if let Ok(v) = token.parse() {
        headers.insert("X-CSRF-Token", v);
    }

    let servers_enc = client
        .post(&servers)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let dec_servers: Value = client
        .post(format!("https://enc-dec.app/api/dec-{player_key}"))
        .json(&json!({ "text": servers_enc }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if dec_servers.get("status").and_then(|s| s.as_i64()) != Some(200) {
        return Err("Failed to decrypt servers".into());
    }
    let servers_decrypted = dec_servers.get("result").cloned().unwrap_or(Value::Null);
    let server_data = servers_decrypted
        .get(0)
        .and_then(|s| s.get("data"))
        .cloned()
        .unwrap_or(Value::Null);

    let stream_enc_url = format!("{stream}/{server_data}");
    let stream_enc = client
        .post(&stream_enc_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let dec_stream: Value = client
        .post(format!("https://enc-dec.app/api/dec-{player_key}"))
        .json(&json!({ "text": stream_enc }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if dec_stream.get("status").and_then(|s| s.as_i64()) != Some(200) {
        return Err("Failed to decrypt stream".into());
    }
    Ok(dec_stream.get("result").cloned().unwrap_or(Value::Null))
}

async fn get_direct_stream_with_fallback(
    client: &reqwest::Client,
    id: &str,
    is_tv: bool,
    s: u32,
    e: u32,
    preferred: &str,
) -> Value {
    let player_configs: &[(&str, &str)] = &[
        ("vidcore", "vidcore.net"),
        ("vidup", "vidup.to"),
        ("vidfast", "vidfast.vc"),
    ];
    let mut player_list: Vec<&str> = vec![preferred];
    for (k, _) in player_configs {
        if !player_list.contains(k) {
            player_list.push(k);
        }
    }

    let mut last_error = String::new();
    for p_key in player_list {
        let domain = match player_configs.iter().find(|(k, _)| *k == p_key) {
            Some((_, d)) => *d,
            None => continue,
        };
        match resolve_page_player(client, p_key, domain, id, is_tv, s, e).await {
            Ok(data) => {
                if data.get("url").map(|u| !u.is_null()).unwrap_or(false) {
                    return json!({ "status": "success", "player": p_key, "result": data });
                }
            }
            Err(err) => last_error = err,
        }
    }
    json!({
        "status": "error",
        "message": if last_error.is_empty() { "No direct stream server responded.".to_string() } else { last_error }
    })
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = Instant::now();
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["id", "type", "season", "episode", "player", "mode"] {
            if let Some(u) = b.get(k) {
                let s = match u { Value::String(s) => s.clone(), other => other.to_string() };
                merged.insert(k.into(), s);
            }
        }
    }
    let get = |k: &str, d: &str| merged.get(k).map(|s| s.trim().to_string()).unwrap_or_else(|| d.to_string());

    let id = get("id", "");
    if id.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'id' (TMDB ID) wajib diisi",
            "example": "/api/downloader/7reels?id=157336&type=movie"
        }))).into_response();
    }
    let clean_type = if get("type", "movie").to_ascii_lowercase() == "tv" { "tv" } else { "movie" };
    let season: u32 = get("season", "1").parse().unwrap_or(1);
    let episode: u32 = get("episode", "1").parse().unwrap_or(1);
    let player = get("player", "vidcore").to_ascii_lowercase();
    let mode = get("mode", "all").to_ascii_lowercase();

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let run: Result<Value, String> = (async {
        let mut payload = json!({
            "status": true, "id": id, "type": clean_type, "mode": mode
        });
        if clean_type == "tv" {
            payload["season"] = json!(season);
            payload["episode"] = json!(episode);
        }

        if mode == "all" || mode == "stream" {
            let embed_key = get_embed_key(&client).await;
            let is_tv = clean_type == "tv";
            let servers: Vec<Value> = EMBED_PLAYERS
                .iter()
                .map(|(key, label, quality)| {
                    let url = stream_url(&embed_key, key, is_tv, &id, season, episode);
                    json!({ "key": key, "name": label, "quality": quality, "url": url })
                })
                .collect();
            payload["total_servers"] = json!(servers.len());
            payload["servers"] = json!(servers);
        }

        if mode == "all" || mode == "direct" {
            let direct = get_direct_stream_with_fallback(&client, &id, clean_type == "tv", season, episode, &player).await;
            payload["direct_stream"] = direct;
        }

        payload["metadata"] = json!({ "processing_time": format!("{}ms", start.elapsed().as_millis()) });
        Ok(payload)
    })
    .await;
    match run {
        Ok(p) => Json(p).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e,
            "metadata": { "processing_time": format!("{}ms", start.elapsed().as_millis()) }
        }))).into_response(),
    }
}

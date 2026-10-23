// Crunchyroll — native conversion of api/anime/crunchyroll.js
// beta-api.crunchyroll.com (client-credentials token) + JustWatch GraphQL + multi-embed builder.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

const CR: &str = "https://beta-api.crunchyroll.com";
const JW: &str = "https://apis.justwatch.com/graphql";
const UA_CR: &str = "Crunchyroll/3.74.2 Android/14";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASIC: &str = "Y3Jfd2ViOg==";

static TOKEN: Mutex<Option<(String, std::time::SystemTime)>> = Mutex::new(None);

fn merged(query: &HashMap<String, String>, body: Option<&Value>) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in query { m.insert(k.clone(), json!(v)); }
    if let Some(Value::Object(b)) = body { for (k, v) in b { m.insert(k.clone(), v.clone()); } }
    m
}

fn pstr(m: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::String(s) if !s.trim().is_empty() => return s.trim().to_string(),
                Value::Number(n) => return n.to_string(),
                _ => {}
            }
        }
    }
    String::new()
}

fn pnum(m: &serde_json::Map<String, Value>, keys: &[&str], default: i64) -> i64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::Number(n) => return n.as_i64().unwrap_or(default),
                Value::String(s) => { if let Ok(x) = s.trim().parse::<i64>() { return x; } }
                _ => {}
            }
        }
    }
    default
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(25)).build().unwrap()
}

async fn get_crunchyroll_token() -> Result<String, String> {
    {
        let guard = TOKEN.lock().unwrap();
        if let Some((tok, at)) = guard.as_ref() {
            // valid until expires - 60s
            if at.duration_since(UNIX_EPOCH).map_err(|_| "clock error")?.as_secs() > 60 {
                return Ok(tok.clone());
            }
        }
    }
    let res = client().post(format!("{}/auth/v1/token", CR))
        .header("User-Agent", UA_CR)
        .header("Authorization", format!("Basic {}", BASIC))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .body("grant_type=client_id")
        .send().await.map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    let access = j.get("access_token").and_then(|v| v.as_str()).ok_or("Gagal mendapatkan akses token Crunchyroll")?;
    let expires_in = j.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(300);
    let expiry = std::time::SystemTime::now() + Duration::from_secs(expires_in as u64);
    *TOKEN.lock().unwrap() = Some((access.to_string(), expiry));
    Ok(access.to_string())
}

async fn crunchyroll_get(path: &str) -> Result<Value, String> {
    let token = get_crunchyroll_token().await?;
    let res = client().get(format!("{}{}", CR, path))
        .header("User-Agent", UA_CR)
        .header("Authorization", format!("Bearer {}", token))
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if status >= 400 { return Err(format!("Crunchyroll API HTTP {}", status)); }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

async fn search_crunchyroll(query: &str) -> Result<Vec<Value>, String> {
    let json = crunchyroll_get(&format!(
        "/content/v2/discover/search?q={}&n=12&type=series,movie_listing&locale=en-US",
        urlencoding::encode(query))).await?;
    let mut out = Vec::new();
    for block in json.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
        for item in block.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            out.push(json!({
                "crId": item.get("id"),
                "type": item.get("type").filter(|t| !t.is_null()).cloned().unwrap_or(json!(block_type)),
                "title": item.get("title"),
                "description": item.get("description").and_then(|v| v.as_str()).map(|s| s.chars().take(200).collect::<String>()).unwrap_or_default(),
                "slug": item.get("slug_title"),
            }));
        }
    }
    Ok(out)
}

async fn get_crunchyroll_seasons(series_id: &str) -> Result<Vec<Value>, String> {
    let json = crunchyroll_get(&format!(
        "/content/v2/cms/series/{}/seasons?locale=en-US", urlencoding::encode(series_id))).await?;
    Ok(json.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default().into_iter().map(|s| json!({
        "id": s.get("id"),
        "title": s.get("title"),
        "season_number": s.get("season_number"),
        "episode_count": s.get("number_of_episodes").filter(|v| !v.is_null()).cloned()
            .or_else(|| s.get("episode_count").cloned()).unwrap_or(Value::Null),
    })).collect())
}

async fn get_crunchyroll_episodes(season_id: &str) -> Result<Vec<Value>, String> {
    let json = crunchyroll_get(&format!(
        "/content/v2/cms/seasons/{}/episodes?locale=en-US", urlencoding::encode(season_id))).await?;
    Ok(json.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default().into_iter().map(|e| json!({
        "id": e.get("id"),
        "title": e.get("title"),
        "episode_number": e.get("episode_number").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| e.get("episode").cloned().unwrap_or(Value::Null)),
        "season_number": e.get("season_number"),
        "duration_ms": e.get("duration_ms"),
        "air_date": e.get("episode_air_date"),
        "is_premium": e.get("is_premium_only"),
    })).collect())
}

async fn get_crunchyroll_detail(series_id: &str) -> Result<Value, String> {
    let json = crunchyroll_get(&format!(
        "/content/v2/cms/series/{}?locale=en-US", urlencoding::encode(series_id))).await?;
    let d = json.pointer("/data/0").or_else(|| json.get("data")).or_else(|| Some(&json)).cloned().unwrap_or(json!({}));
    let seasons = get_crunchyroll_seasons(series_id).await.unwrap_or_default();
    Ok(json!({
        "crId": d.get("id").cloned().unwrap_or(json!(series_id)),
        "title": d.get("title"),
        "description": d.get("description"),
        "episode_count": d.get("episode_count"),
        "season_count": d.get("season_count"),
        "seasons": seasons,
    }))
}

async fn map_justwatch(title: &str) -> Result<Vec<Value>, String> {
    let body = json!({
        "query": "query($q:String!){popularTitles(country:\"US\",first:8,filter:{searchQuery:$q}){edges{node{id objectId objectType content(country:\"US\",language:\"en\"){title originalReleaseYear externalIds{tmdbId imdbId}}}}}}",
        "variables": { "q": title }
    });
    let res = client().post(JW)
                    .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(j.pointer("/data/popularTitles/edges").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .into_iter().filter_map(|e| {
            let n = e.get("node")?;
            let c = n.get("content")?;
            let x = c.get("externalIds")?;
            let tmdb = x.get("tmdbId").cloned().unwrap_or(Value::Null);
            if tmdb.is_null() { return None; }
            Some(json!({
                "title": c.get("title"),
                "year": c.get("originalReleaseYear"),
                "type": n.get("objectType"),
                "tmdbId": tmdb,
                "imdbId": x.get("imdbId").cloned().unwrap_or(Value::Null),
                "jwId": n.get("objectId"),
            }))
        }).collect())
}

fn get_tv_embeds(tmdb: &str, season: i64, episode: i64) -> Vec<Value> {
    let s = if season <= 0 { 1 } else { season };
    let ep = if episode <= 0 { 1 } else { episode };
    json!([
        {"server": "VidSrc.to", "url": format!("https://vidsrc.to/embed/tv/{}/{}", tmdb, format!("{}/{}", s, ep))},
        {"server": "VidSrc.me", "url": format!("https://vidsrc.me/embed/tv?tmdb={}&season={}&episode={}", tmdb, s, ep)},
        {"server": "2Embed", "url": format!("https://www.2embed.cc/embedtv/{}&s={}&e={}", tmdb, s, ep)},
        {"server": "SuperEmbed", "url": format!("https://multiembed.mov/?video_id={}&tmdb=1&s={}&e={}", tmdb, s, ep)},
        {"server": "VidLink", "url": format!("https://vidlink.pro/tv/{}/{}", tmdb, format!("{}/{}", s, ep))},
    ]).as_array().cloned().unwrap_or_default()
}

fn get_movie_embeds(tmdb: &str) -> Vec<Value> {
    json!([
        {"server": "VidSrc.to", "url": format!("https://vidsrc.to/embed/movie/{}", tmdb)},
        {"server": "VidSrc.me", "url": format!("https://vidsrc.me/embed/movie?tmdb={}", tmdb)},
        {"server": "2Embed", "url": format!("https://www.2embed.cc/embed/{}", tmdb)},
        {"server": "SuperEmbed", "url": format!("https://multiembed.mov/?video_id={}&tmdb=1", tmdb)},
        {"server": "VidLink", "url": format!("https://vidlink.pro/movie/{}", tmdb)},
    ]).as_array().cloned().unwrap_or_default()
}

async fn get_full_anime_info(query: &str) -> Result<Value, String> {
    let cr_results = search_crunchyroll(query).await?;
    let jw_results = map_justwatch(query).await?;
    let top_cr = cr_results.first().cloned().unwrap_or(Value::Null);
    let top_jw = jw_results.first().cloned().unwrap_or(Value::Null);

    let mut seasons: Vec<Value> = Vec::new();
    if let Some(cr_id) = top_cr.get("crId").and_then(|v| v.as_str()) {
        seasons = get_crunchyroll_seasons(cr_id).await.unwrap_or_default();
    }

    let tmdb = top_jw.get("tmdbId").and_then(|v| v.as_str().map(|s| s.to_string()))
        .or_else(|| top_jw.get("tmdbId").and_then(|v| v.as_i64()).map(|n| n.to_string())).unwrap_or_default();
    let is_movie = top_jw.get("type").and_then(|v| v.as_str()) == Some("MOVIE");

    let streaming = if !tmdb.is_empty() {
        json!({
            "tmdbId": tmdb,
            "imdbId": top_jw.get("imdbId").cloned().unwrap_or(Value::Null),
            "type": if is_movie { "movie" } else { "tv" },
            "embeds": if is_movie { get_movie_embeds(&tmdb) } else { get_tv_embeds(&tmdb, 1, 1) },
            "note": if is_movie {
                "Tipe movie — gunakan embed langsung untuk menonton".to_string()
            } else {
                format!("Gunakan action=play&tmdb={}&season={{season}}&episode={{episode}} untuk memutar episode lain", tmdb)
            },
        })
    } else { Value::Null };

    Ok(json!({
        "query": query,
        "crunchyroll": {
            "top": top_cr,
            "results": cr_results,
            "seasons": seasons.into_iter().take(10).collect::<Vec<_>>(),
        },
        "justwatch": { "top": top_jw, "results": jw_results },
        "streaming": streaming,
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let start = std::time::Instant::now();
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = pstr(&params, &["action"]).trim().to_lowercase();
    let action = if action.is_empty() { "full".to_string() } else { action };
    let search_term = { let s = pstr(&params, &["q"]); if s.is_empty() { pstr(&params, &["query"]) } else { s } };
    let id = pstr(&params, &["id"]);

    let resp: Result<Value, (u16, String)> = match action.as_str() {
        "search" => {
            if search_term.is_empty() { return bad("Parameter 'q' wajib diisi untuk action search"); }
            match search_crunchyroll(&search_term).await {
                Ok(r) => Ok(json!({
                    "status": true, "action": "search", "query": search_term,
                    "total": r.len(), "result": r,
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                })),
                Err(e) => Err((500, e)),
            }
        }
        "detail" => {
            let series_id = if id.is_empty() { search_term.clone() } else { id.clone() };
            if series_id.is_empty() { return bad("Parameter 'id' (Series ID Crunchyroll) wajib diisi"); }
            match get_crunchyroll_detail(&series_id).await {
                Ok(d) => Ok(json!({
                    "status": true, "action": "detail", "result": d,
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                })),
                Err(e) => Err((500, e)),
            }
        }
        "seasons" => {
            let series_id = if id.is_empty() { search_term.clone() } else { id.clone() };
            if series_id.is_empty() { return bad("Parameter 'id' (Series ID Crunchyroll) wajib diisi"); }
            match get_crunchyroll_seasons(&series_id).await {
                Ok(s) => Ok(json!({
                    "status": true, "action": "seasons", "seriesId": series_id,
                    "total": s.len(), "result": s,
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                })),
                Err(e) => Err((500, e)),
            }
        }
        "episodes" => {
            let season_id = if id.is_empty() { search_term.clone() } else { id.clone() };
            if season_id.is_empty() { return bad("Parameter 'id' (Season ID Crunchyroll) wajib diisi"); }
            match get_crunchyroll_episodes(&season_id).await {
                Ok(ep) => Ok(json!({
                    "status": true, "action": "episodes", "seasonId": season_id,
                    "total": ep.len(), "result": ep,
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                })),
                Err(e) => Err((500, e)),
            }
        }
        "play" => {
            let tmdb = { let t = pstr(&params, &["tmdb"]); if t.is_empty() { id.clone() } else { t } };
            if tmdb.is_empty() { return bad("Parameter 'tmdb' wajib diisi untuk action play"); }
            let se = pnum(&params, &["season"], 1);
            let ep = pnum(&params, &["episode"], 1);
            let is_movie = pstr(&params, &["type"]).to_lowercase() == "movie";
            let embeds = if is_movie { get_movie_embeds(&tmdb) } else { get_tv_embeds(&tmdb, se, ep) };
            let mut out = json!({
                "status": true, "action": "play", "tmdb": tmdb,
                "type": if is_movie { "movie" } else { "tv" },
                "result": embeds,
                "responseTime": format!("{}ms", start.elapsed().as_millis()),
            });
            if !is_movie {
                out["season"] = json!(se);
                out["episode"] = json!(ep);
            }
            Ok(out)
        }
        "full" | _ => {
            if search_term.is_empty() { return bad("Parameter 'q' wajib diisi untuk pencarian anime"); }
            match get_full_anime_info(&search_term).await {
                Ok(info) => Ok(json!({
                    "status": true, "action": "full", "result": info,
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                })),
                Err(e) => Err((500, e)),
            }
        }
    };

    match resp {
        Ok(v) => Json(v).into_response(),
        Err((code, msg)) => (StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(json!({"status": false, "message": msg}))).into_response(),
    }
}

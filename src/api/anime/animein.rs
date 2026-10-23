// AnimeIn — native conversion of api/anime/animein.js
// AnimeInWeb proxy API (x-proxy-secret header). Pure HTTP, no scraping.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

const BASE: &str = "https://animeinweb.com";
const API: &str = "https://animeinweb.com/api/proxy";
const SECRET: &str = "animein-secure-proxy-key-123";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DAY_NAMES: [&str; 7] = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];

static JAR: Mutex<Option<String>> = Mutex::new(None);

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

fn pint(m: &serde_json::Map<String, Value>, keys: &[&str], dflt: i64) -> i64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            if let Some(n) = v.as_i64() { return n; }
            if let Some(s) = v.as_str() { if let Ok(n) = s.trim().parse::<i64>() { return n; } }
        }
    }
    dflt
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap()
}

async fn fetch_api(path: &str, params: Option<&[(&str, String)]>) -> Result<Value, String> {
    let mut url = format!("{}{}", API, path);
    if let Some(ps) = params {
        let qs: Vec<String> = ps.iter().map(|(k, v)| format!("{}={}", k, urlencoding::encode(v))).collect();
        url = format!("{}?{}", url, qs.join("&"));
    }
    let mut req = client().get(&url)
        .header("User-Agent", UA)
                    .header("Accept", "application/json, text/plain, */*")
        .header("Referer", format!("{}/", BASE))
        .header("x-proxy-secret", SECRET);
    if let Ok(guard) = JAR.lock() {
        if let Some(jar) = guard.as_ref() { req = req.header("Cookie", jar.clone()); }
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if let Ok(mut guard) = JAR.lock() {
        let mut parts: Vec<String> = guard.clone().map(|j| j.split("; ").map(|s| s.to_string()).collect()).unwrap_or_default();
        for c in res.headers().get_all("set-cookie") {
            if let Ok(cv) = c.to_str() {
                let kv = cv.split(';').next().unwrap_or("").trim().to_string();
                if kv.contains('=') {
                    let name = kv.split('=').next().unwrap_or("").to_string();
                    parts.retain(|p| !p.starts_with(&format!("{}=", name)));
                    parts.push(kv);
                }
            }
        }
        if !parts.is_empty() { *guard = Some(parts.join("; ")); }
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    let j: Value = serde_json::from_str(&text).map_err(|_| "Invalid JSON response dari provider AnimeIn".to_string())?;
    let has_err = j.get("error").map(|e| !e.is_null() && e.as_str() != Some("")).unwrap_or(false);
    let st = j.get("status").and_then(|s| s.as_i64()).unwrap_or(200);
    if has_err || st != 200 {
        let msg = j.get("message").and_then(|m| m.as_str()).map(|s| s.to_string())
            .or_else(|| j.get("error").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| "Gagal mengambil data AnimeIn".to_string());
        return Err(if j.get("status").is_some() { format!("{} (Status {})", msg, st) } else { msg });
    }
    Ok(j.get("data").cloned().unwrap_or(Value::Null))
}

fn extract_id(raw: &str) -> String {
    let s = raw.trim();
    if let Some(rest) = s.split("/anime/").nth(1) {
        return rest.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("").to_string();
    }
    if let Some(rest) = s.split("/watch/").nth(1) {
        return rest.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("").to_string();
    }
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) { return s.to_string(); }
    let mut cur = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() { cur.push(c); } else if !cur.is_empty() { break; }
    }
    if cur.len() >= 2 { return cur; }
    s.to_string()
}

fn image_full(p: &str) -> String {
    if p.is_empty() { return String::new(); }
    if p.starts_with("http") { return p.to_string(); }
    if p.starts_with("//") { return format!("https:{}", p); }
    if p.starts_with("/assets") { return format!("https://xyz-api.animein.net{}", p); }
    if p.starts_with('/') { return format!("https://animeinweb.com{}", p); }
    p.to_string()
}

fn movie_item(m: &Value, with_year: bool, with_time: bool) -> Value {
    let id = m.get("id").cloned().unwrap_or(Value::Null);
    let mut out = json!({
        "id": id.clone(),
        "title": m.get("title").cloned().unwrap_or(Value::Null),
        "url": format!("{}/anime/{}", BASE, id),
        "image_poster": image_full(m.get("image_poster").and_then(|v| v.as_str()).unwrap_or("")),
        "image_cover": image_full(m.get("image_cover").and_then(|v| v.as_str()).unwrap_or("")),
        "type": m.get("type").cloned().unwrap_or(Value::Null),
        "status": m.get("status").cloned().unwrap_or(Value::Null),
        "views": m.get("views").cloned().unwrap_or(Value::Null),
        "favorites": m.get("favorites").cloned().unwrap_or(Value::Null),
        "genre": m.get("genre").cloned().unwrap_or(Value::Null),
    });
    if let Value::Object(ref mut map) = out {
        if with_year { map.insert("year".into(), m.get("year").cloned().unwrap_or(Value::Null)); }
        if with_time { map.insert("time".into(), m.get("time").cloned().unwrap_or(Value::Null)); }
    }
    out
}

fn js_day_index() -> usize {
    match chrono::Datelike::weekday(&chrono::Utc::now()) {
        chrono::Weekday::Sun => 0,
        chrono::Weekday::Mon => 1,
        chrono::Weekday::Tue => 2,
        chrono::Weekday::Wed => 3,
        chrono::Weekday::Thu => 4,
        chrono::Weekday::Fri => 5,
        chrono::Weekday::Sat => 6,
    }
}

async fn scrape_home() -> Result<Value, String> {
    let day_name = DAY_NAMES[js_day_index()];
    let data = fetch_api("/3/2/home/data", Some(&[("day", day_name.to_string()), ("limit", "16".to_string())])).await?;
    let g = |k: &str| data.get(k).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let counts = json!({
        "slider": g("slider").len(), "hot": g("hot").len(), "new": g("new").len(),
        "today": g("today").len(), "popular": g("popular").len(),
        "waiting": g("waiting").len(), "random": g("random").len(),
    });
    Ok(json!({
        "source": format!("{}/", BASE),
        "type": "home",
        "day": day_name,
        "slider": g("slider").iter().map(|s| json!({
            "id": s.get("id").cloned().unwrap_or(Value::Null),
            "type": s.get("type").cloned().unwrap_or(Value::Null),
            "image": image_full(s.get("image").and_then(|v| v.as_str()).unwrap_or("")),
            "link": s.get("link").cloned().unwrap_or(Value::Null),
        })).collect::<Vec<_>>(),
        "hot": g("hot").iter().map(|m| movie_item(m, true, false)).collect::<Vec<_>>(),
        "new": g("new").iter().map(|m| movie_item(m, true, false)).collect::<Vec<_>>(),
        "today": g("today").iter().map(|m| movie_item(m, false, true)).collect::<Vec<_>>(),
        "popular": g("popular").iter().map(|m| movie_item(m, false, false)).collect::<Vec<_>>(),
        "waiting": g("waiting").iter().map(|m| json!({
            "id": m.get("id").cloned().unwrap_or(Value::Null),
            "title": m.get("title").cloned().unwrap_or(Value::Null),
            "url": format!("{}/anime/{}", BASE, m.get("id").cloned().unwrap_or(Value::Null)),
            "image_poster": image_full(m.get("image_poster").and_then(|v| v.as_str()).unwrap_or("")),
            "type": m.get("type").cloned().unwrap_or(Value::Null),
            "status": m.get("status").cloned().unwrap_or(Value::Null),
            "favorites": m.get("favorites").cloned().unwrap_or(Value::Null),
            "genre": m.get("genre").cloned().unwrap_or(Value::Null),
        })).collect::<Vec<_>>(),
        "random": g("random").iter().map(|m| movie_item(m, false, false)).collect::<Vec<_>>(),
        "trailer": data.get("trailer").cloned().unwrap_or(json!([])),
        "counts": counts,
    }))
}

async fn scrape_detail(raw_id: &str) -> Result<Value, String> {
    let id = extract_id(raw_id);
    if id.is_empty() { return Err("ID atau URL anime wajib diisi untuk detail anime".into()); }
    let data = fetch_api(&format!("/3/2/movie/detail/{}", urlencoding::encode(&id)), None).await?;
    let m = data.get("movie").cloned().unwrap_or(json!({}));
    let ep = data.get("episode").cloned().unwrap_or(Value::Null);
    let seasons = data.get("season").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let first_episode = if ep.is_object() {
        json!({
            "id": ep.get("id").cloned().unwrap_or(Value::Null),
            "index": ep.get("index").cloned().unwrap_or(Value::Null),
            "title": ep.get("title").cloned().unwrap_or(Value::Null),
            "views": ep.get("views").cloned().unwrap_or(Value::Null),
            "key_time": ep.get("key_time").cloned().unwrap_or(Value::Null),
            "image": image_full(ep.get("image").and_then(|v| v.as_str()).unwrap_or("")),
            "url": format!("{}/watch/{}", BASE, ep.get("id").cloned().unwrap_or(Value::Null)),
        })
    } else { Value::Null };
    Ok(json!({
        "source": format!("{}/anime/{}", BASE, id),
        "type": "anime",
        "id": m.get("id").cloned().unwrap_or(json!(id)),
        "title": m.get("title").cloned().unwrap_or(Value::Null),
        "synonyms": m.get("synonyms").cloned().unwrap_or(Value::Null),
        "synopsis": m.get("synopsis").cloned().unwrap_or(Value::Null),
        "image_poster": image_full(m.get("image_poster").and_then(|v| v.as_str()).unwrap_or("")),
        "image_cover": image_full(m.get("image_cover").and_then(|v| v.as_str()).unwrap_or("")),
        "poster": image_full(m.get("image_poster").and_then(|v| v.as_str()).unwrap_or("")),
        "cover": image_full(m.get("image_cover").and_then(|v| v.as_str()).unwrap_or("")),
        "type_anime": m.get("type").cloned().unwrap_or(Value::Null),
        "year": m.get("year").cloned().unwrap_or(Value::Null),
        "day": m.get("day").cloned().unwrap_or(Value::Null),
        "status": m.get("status").cloned().unwrap_or(Value::Null),
        "views": m.get("views").cloned().unwrap_or(Value::Null),
        "favorites": m.get("favorites").cloned().unwrap_or(Value::Null),
        "studio": m.get("studio").cloned().unwrap_or(Value::Null),
        "aired_start": m.get("aired_start").cloned().unwrap_or(Value::Null),
        "aired_end": m.get("aired_end").cloned().unwrap_or(Value::Null),
        "genre": m.get("genre").cloned().unwrap_or(Value::Null),
        "time": m.get("time").cloned().unwrap_or(Value::Null),
        "first_episode": first_episode,
        "seasons": seasons.iter().map(|s| json!({
            "id": s.get("id").cloned().unwrap_or(Value::Null),
            "title": s.get("title").cloned().unwrap_or(Value::Null),
            "season": s.get("season").cloned().unwrap_or(Value::Null),
            "type": s.get("type").cloned().unwrap_or(Value::Null),
            "year": s.get("year").cloned().unwrap_or(Value::Null),
            "status": s.get("status").cloned().unwrap_or(Value::Null),
            "views": s.get("views").cloned().unwrap_or(Value::Null),
            "favorites": s.get("favorites").cloned().unwrap_or(Value::Null),
            "url": format!("{}/anime/{}", BASE, s.get("id").cloned().unwrap_or(Value::Null)),
        })).collect::<Vec<_>>(),
        "seasons_count": seasons.len(),
    }))
}

async fn scrape_episodes(raw_id: &str) -> Result<Value, String> {
    let id = extract_id(raw_id);
    if id.is_empty() { return Err("ID atau URL anime wajib diisi untuk daftar episode".into()); }
    let detail = fetch_api(&format!("/3/2/movie/detail/{}", urlencoding::encode(&id)), None).await?;
    let title = detail.pointer("/movie/title").cloned().unwrap_or(json!(""));
    let mut episodes: Vec<Value> = Vec::new();
    let mut page: i64 = 0;
    loop {
        let data = fetch_api(&format!("/3/2/movie/episode/{}", urlencoding::encode(&id)), Some(&[("page", page.to_string())])).await?;
        let eps = data.get("episode").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if eps.is_empty() { break; }
        for e in &eps {
            let eid = e.get("id").cloned().unwrap_or(Value::Null);
            episodes.push(json!({
                "id": eid,
                "index": e.get("index").cloned().unwrap_or(Value::Null),
                "title": e.get("title").cloned().unwrap_or(Value::Null),
                "views": e.get("views").cloned().unwrap_or(Value::Null),
                "key_time": e.get("key_time").cloned().unwrap_or(Value::Null),
                "image": image_full(e.get("image").and_then(|v| v.as_str()).unwrap_or("")),
                "url": format!("{}/watch/{}", BASE, eid),
                "anime_url": format!("{}/anime/{}", BASE, id),
                "stream_api": format!("{}/api/proxy/3/2/episode/streamnew/{}", BASE, eid),
                "is_new": e.get("is_new").cloned().unwrap_or(json!("0")),
                "is_book": e.get("is_book").cloned().unwrap_or(json!(0)),
            }));
        }
        if eps.len() < 30 || page > 60 { break; }
        page += 1;
    }
    Ok(json!({
        "source": format!("{}/anime/{}", BASE, id),
        "type": "episodes",
        "anime_id": id,
        "anime_title": title,
        "count": episodes.len(),
        "episodes": episodes,
    }))
}

async fn explore(page: i64, keyword: &str) -> Result<Vec<Value>, String> {
    let data = fetch_api("/3/2/explore/movie", Some(&[
        ("page", page.to_string()),
        ("sort", "views".to_string()),
        ("keyword", keyword.to_string()),
    ])).await?;
    let items = data.get("movie").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(items.iter().map(|m| movie_item(m, true, false)).collect())
}

async fn scrape_jadwal(day_raw: &str) -> Result<Value, String> {
    let raw = day_raw.trim().to_uppercase();
    let sched_item = |m: &Value| json!({
        "id": m.get("id").cloned().unwrap_or(Value::Null),
        "title": m.get("title").cloned().unwrap_or(Value::Null),
        "url": format!("{}/anime/{}", BASE, m.get("id").cloned().unwrap_or(Value::Null)),
        "image_poster": image_full(m.get("image_poster").and_then(|v| v.as_str()).unwrap_or("")),
        "image_cover": image_full(m.get("image_cover").and_then(|v| v.as_str()).unwrap_or("")),
        "type": m.get("type").cloned().unwrap_or(Value::Null),
        "status": m.get("status").cloned().unwrap_or(Value::Null),
        "views": m.get("views").cloned().unwrap_or(Value::Null),
        "favorites": m.get("favorites").cloned().unwrap_or(Value::Null),
        "genre": m.get("genre").cloned().unwrap_or(Value::Null),
        "day": m.get("day").cloned().unwrap_or(Value::Null),
        "time": m.get("time").cloned().unwrap_or(Value::Null),
        "key_time": m.get("key_time").cloned().unwrap_or(Value::Null),
    });
    if DAY_NAMES.contains(&raw.as_str()) {
        let data = fetch_api("/3/2/schedule/data", Some(&[("day", raw.clone())])).await?;
        let items: Vec<Value> = data.get("movie").and_then(|v| v.as_array()).cloned().unwrap_or_default()
            .iter().map(&sched_item).collect();
        return Ok(json!({
            "source": format!("{}/schedule", BASE), "type": "jadwal", "day": raw,
            "count": items.len(), "items": items,
        }));
    }
    let mut all = Vec::new();
    let mut by_day = serde_json::Map::new();
    for d in DAY_NAMES {
        let data = fetch_api("/3/2/schedule/data", Some(&[("day", d.to_string())])).await?;
        let items: Vec<Value> = data.get("movie").and_then(|v| v.as_array()).cloned().unwrap_or_default()
            .iter().map(&sched_item).collect();
        all.extend(items.iter().cloned());
        by_day.insert(d.to_string(), json!({"count": items.len(), "items": items}));
    }
    Ok(json!({
        "source": format!("{}/schedule", BASE), "type": "jadwal",
        "count": all.len(), "by_day": Value::Object(by_day), "items": all,
    }))
}

async fn scrape_stream(raw_id: &str) -> Result<Value, String> {
    let id = extract_id(raw_id);
    if id.is_empty() { return Err("Parameter 'id' episode wajib diisi untuk stream episode".into()); }
    let data = fetch_api(&format!("/3/2/episode/streamnew/{}", urlencoding::encode(&id)), None).await?;
    let ep = data.get("episode").cloned().unwrap_or(json!({}));
    let next = data.get("episode_next").cloned().unwrap_or(Value::Null);
    let servers: Vec<Value> = data.get("server").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter().map(|s| {
            let link = s.get("link").and_then(|v| v.as_str()).unwrap_or("").to_string();
            json!({
                "id": s.get("id").cloned().unwrap_or(Value::Null),
                "name": s.get("name").cloned().unwrap_or(Value::Null),
                "quality": s.get("quality").cloned().unwrap_or(Value::Null),
                "type": s.get("type").cloned().unwrap_or(Value::Null),
                "link": link.clone(),
                "url_stream": link.clone(),
                "embed_url": link.clone(),
                "key_file_size": s.get("key_file_size").cloned().unwrap_or(Value::Null),
                "server_id": s.get("server_id").cloned().unwrap_or(Value::Null),
                "username": s.get("username").cloned().unwrap_or(json!("")),
            })
        }).collect();
    let default_stream = servers.iter()
        .find(|s| s.get("type").and_then(|v| v.as_str()) == Some("direct")
            && s.get("link").and_then(|v| v.as_str()).map(|l| l.contains(".mp4")).unwrap_or(false))
        .and_then(|s| s.get("link").and_then(|v| v.as_str()).map(|l| l.to_string()))
        .or_else(|| servers.first().and_then(|s| s.get("link").and_then(|v| v.as_str()).map(|l| l.to_string())))
        .unwrap_or_default();
    Ok(json!({
        "source": format!("{}/watch/{}", BASE, id),
        "type": "stream",
        "episode": if ep.is_object() { json!({
            "id": ep.get("id").cloned().unwrap_or(Value::Null),
            "index": ep.get("index").cloned().unwrap_or(Value::Null),
            "title": ep.get("title").cloned().unwrap_or(Value::Null),
            "views": ep.get("views").cloned().unwrap_or(Value::Null),
            "key_time": ep.get("key_time").cloned().unwrap_or(Value::Null),
            "image": image_full(ep.get("image").and_then(|v| v.as_str()).unwrap_or("")),
            "url": format!("{}/watch/{}", BASE, ep.get("id").cloned().unwrap_or(Value::Null)),
        }) } else { Value::Null },
        "episode_next": if next.is_object() { json!({
            "id": next.get("id").cloned().unwrap_or(Value::Null),
            "index": next.get("index").cloned().unwrap_or(Value::Null),
            "title": next.get("title").cloned().unwrap_or(Value::Null),
            "url": format!("{}/watch/{}", BASE, next.get("id").cloned().unwrap_or(Value::Null)),
        }) } else { Value::Null },
        "count": servers.len(),
        "stream_url": default_stream.clone(),
        "embed_url": default_stream,
        "servers": servers,
    }))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));

    let mut action = pstr(&params, &["action"]).to_lowercase();
    let q = pstr(&params, &["query", "q"]);
    let target = {
        let t = pstr(&params, &["id", "url"]);
        if t.is_empty() { q.clone() } else { t }
    };
    let page = pint(&params, &["page", "p"], 0);
    let day = pstr(&params, &["day"]).to_uppercase();
    let episode_id = pstr(&params, &["episode_id"]);
    let url_param = pstr(&params, &["url"]);

    if action.is_empty() {
        if !day.is_empty() || params.get("hari").is_some() { action = "jadwal".into(); }
        else if !episode_id.is_empty() { action = "stream".into(); }
        else if url_param.contains("/watch/") || url_param.contains("/episode/") { action = "stream".into(); }
        else if url_param.contains("/anime/") { action = "detail".into(); }
        else if !q.is_empty() { action = "search".into(); }
        else if params.get("id").is_some() { action = "detail".into(); }
        else { action = "home".into(); }
    }

    let result: Result<Value, String> = match action.as_str() {
        "home" => scrape_home().await,
        "search" | "cari" => {
            let kw = if q.is_empty() { target.clone() } else { q.clone() };
            if kw.is_empty() { return bad("Parameter 'query' wajib diisi untuk action=search"); }
            let items = match explore(page, &kw).await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({
                "source": format!("{}/explore?keyword={}", BASE, urlencoding::encode(&kw)),
                "type": "search", "query": kw, "page": page, "count": items.len(), "items": items,
            }))
        }
        "detail" | "anime" => {
            if target.is_empty() { return bad("Parameter 'id' atau 'url' anime wajib diisi untuk action=detail"); }
            scrape_detail(&target).await
        }
        "episode" | "episodes" | "eps" => {
            if target.is_empty() { return bad("Parameter 'id' atau 'url' anime wajib diisi untuk action=episode"); }
            scrape_episodes(&target).await
        }
        "stream" | "play" | "watch" => {
            let ep_id = if !episode_id.is_empty() { episode_id } else { target.clone() };
            if ep_id.is_empty() { return bad("Parameter 'id' episode wajib diisi untuk action=stream"); }
            scrape_stream(&ep_id).await
        }
        "populer" | "popular" | "trending" => {
            let items = match explore(page, "").await { Ok(v) => v, Err(e) => return server_err(&e) };
            Ok(json!({
                "source": format!("{}/explore", BASE), "type": "populer",
                "page": page, "count": items.len(), "items": items,
            }))
        }
        "jadwal" | "schedule" => scrape_jadwal(&day).await,
        _ => return bad(&format!("Action '{}' tidak valid. Pilihan: home, search, detail, episode, stream, populer, jadwal", action)),
    };

    match result {
        Ok(v) => Json(json!({"status": true, "result": v})).into_response(),
        Err(e) => server_err(&e),
    }
}

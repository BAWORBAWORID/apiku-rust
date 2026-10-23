// MovieBox — native conversion of api/movie/moviebox.js
// h5.moviebox-official.site API proxy (base64 AES-like key) with fallback URL variants.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36";
const KEYS: &[&str] = &["moviebox", "moviebox_official", "movieboxapi", "officalapi.moviebox", "moviebox_h5"];

fn merged(query: &HashMap<String, String>, body: Option<&Value>) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    for (k, v) in query { m.insert(k.clone(), json!(v)); }
    if let Some(Value::Object(b)) = body { for (k, v) in b { m.insert(k.clone(), v.clone()); } }
    m
}

fn pstr(m: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(Value::String(s)) = m.get(*k) { if !s.trim().is_empty() { return s.trim().to_string(); } }
        if let Some(Value::Number(n)) = m.get(*k) { return n.to_string(); }
    }
    String::new()
}

fn pnum(m: &serde_json::Map<String, Value>, keys: &[&str], default: i64) -> i64 {
    for k in keys {
        match m.get(*k) {
            Some(Value::Number(n)) => return n.as_i64().unwrap_or(default),
            Some(Value::String(s)) => { if let Ok(x) = s.trim().parse::<i64>() { return x; } }
            _ => {}
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
    reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent(UA).build().unwrap()
}

/// Base64 "signature" the JS used: btoa(key + timestamp). In Rust this is plain base64 encoding.
fn sign(key: &str, ts: i64) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(format!("{}{}", key, ts))
}

/// Collect candidate API host variants, mimicking JS URL fallback array.
fn hosts() -> Vec<String> {
    vec![
        "https://h5.moviebox-official.site".to_string(),
        "https://moviebox-official.site".to_string(),
        "https://h5.moviebox-official.com".to_string(),
    ]
}

async fn api_get(path: &str, extra_query: &str) -> Result<Value, String> {
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    let sep = if path.contains('?') { "&" } else { "?" };
    let mut last_err = String::new();
    for host in hosts() {
        for key in KEYS {
            let url = format!("{}{}{}{}&s={}&t={}", host, path, sep, extra_query, sign(key, ts), ts);
            let res = client().get(&url)
                            .header("Accept", "application/json")
                .header("Referer", format!("{}/", host))
                .send().await;
            match res {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let text = r.text().await.unwrap_or_default();
                    if (200..300).contains(&status) {
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            // API returns {"code":200,"data":...} style; accept non-error codes
                            let code = v.get("code").and_then(|c| c.as_i64());
                            if code.map(|c| c == 200 || c == 0).unwrap_or(true) {
                                return Ok(v);
                            }
                            last_err = format!("{} (code {:?})", text.chars().take(120).collect::<String>(), code);
                        } else {
                            last_err = "respon bukan JSON".into();
                        }
                    } else {
                        last_err = format!("HTTP {}", status);
                    }
                }
                Err(e) => last_err = e.to_string(),
            }
        }
    }
    Err(format!("MovieBox API gagal di semua host: {}", last_err))
}

fn map_movie(item: &Value) -> Value {
    json!({
        "id": item.get("id").or_else(|| item.get("movie_id")).or_else(|| item.get("vid")),
        "title": item.get("title").or_else(|| item.get("name")),
        "cover": item.get("cover").or_else(|| item.get("img")).or_else(|| item.get("poster")),
        "description": item.get("description").or_else(|| item.get("desc")),
        "score": item.get("score").or_else(|| item.get("rating")),
        "year": item.get("year"),
        "category": item.get("category").or_else(|| item.get("genre")),
        "language": item.get("language"),
        "duration": item.get("duration"),
        "update_time": item.get("update_time"),
    })
}

fn extract_list(v: &Value) -> Vec<Value> {
    for ptr in ["/data/list", "/data/list_info/list", "/data/hot_list", "/data/recommand_list", "/data", "/list"] {
        if let Some(arr) = v.pointer(ptr).and_then(|x| x.as_array()) {
            if !arr.is_empty() { return arr.clone(); }
        }
    }
    Vec::new()
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let action = { let a = pstr(&params, &["action"]); if a.is_empty() { pstr(&params, &["mode"]) } else { a } };
    let action = action.trim().to_lowercase();
    let action = if action.is_empty() { "home".to_string() } else { action };
    let id = pstr(&params, &["id", "vid", "movie_id"]);
    let query_kw = pstr(&params, &["query", "keyword", "q"]);
    let category = pstr(&params, &["category", "type"]);
    let page = pnum(&params, &["page"], 1);

    let result: Result<Value, String> = (|| async {
        if action == "home" {
            let data = api_get("/api/movie/hot/list", &format!("page={}&language=id", page)).await?;
            let items = extract_list(&data);
            return Ok(json!({"status": true, "action": "home", "page": page, "results": items.iter().map(map_movie).collect::<Vec<_>>()}));
        }
        if action == "trending" {
            let data = api_get("/api/movie/rank/list", &format!("page={}&language=id", page)).await?;
            let items = extract_list(&data);
            return Ok(json!({"status": true, "action": "trending", "page": page, "results": items.iter().map(map_movie).collect::<Vec<_>>()}));
        }
        if action == "search" {
            if query_kw.is_empty() { return Err("PARAM:Parameter 'query' wajib untuk action=search".into()); }
            let data = api_get("/api/movie/search", &format!("keyword={}&page={}&language=id", urlencoding::encode(&query_kw), page)).await?;
            let items = extract_list(&data);
            return Ok(json!({"status": true, "action": "search", "keyword": query_kw, "page": page, "results": items.iter().map(map_movie).collect::<Vec<_>>()}));
        }
        if action == "category" || action == "kategori" {
            if category.is_empty() { return Err("PARAM:Parameter 'category' wajib untuk action=category".into()); }
            let data = api_get("/api/movie/category/list", &format!("category={}&page={}&language=id", urlencoding::encode(&category), page)).await?;
            let items = extract_list(&data);
            return Ok(json!({"status": true, "action": "category", "category": category, "page": page, "results": items.iter().map(map_movie).collect::<Vec<_>>()}));
        }
        if action == "detail" {
            if id.is_empty() { return Err("PARAM:Parameter 'id' wajib untuk action=detail".into()); }
            let data = api_get("/api/movie/detail", &format!("id={}&language=id", urlencoding::encode(&id))).await?;
            let movie = data.pointer("/data").cloned().unwrap_or(json!({}));
            let episodes = extract_list(&movie).into_iter().map(|e| map_movie(&e)).collect::<Vec<_>>();
            return Ok(json!({"status": true, "action": "detail", "result": map_movie(&movie), "episodes": episodes}));
        }
        if action == "play" || action == "stream" || action == "download" {
            if id.is_empty() { return Err("PARAM:Parameter 'id' wajib untuk action=play".into()); }
            let ep = pstr(&params, &["episode"]);
            let data = api_get("/api/movie/play", &format!("id={}&episode={}&language=id", urlencoding::encode(&id), urlencoding::encode(&ep))).await?;
            let play = data.pointer("/data").cloned().unwrap_or(json!({}));
            let url = play.get("url").or_else(|| play.get("play_url")).or_else(|| play.get("video_url")).cloned().unwrap_or(Value::Null);
            return Ok(json!({
                "status": true, "action": action,
                "result": {
                    "id": id,
                    "episode": ep,
                    "url": url,
                    "headers": {"User-Agent": UA, "Referer": "https://h5.moviebox-official.site/"},
                    "qualities": extract_list(&play).iter().map(map_movie).collect::<Vec<_>>(),
                }
            }));
        }
        Err(format!("PARAM:Action '{}' tidak valid. Pilihan: home, trending, search, category, detail, play", action))
    })().await;

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            if let Some(rest) = e.strip_prefix("PARAM:") { return bad(rest); }
            server_err(&e)
        }
    }
}

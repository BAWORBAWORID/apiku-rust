// Free Movie — native conversion of api/movie/freemovie.js
// Internet Archive: advancedsearch + metadata, list/search/detail/stream/proxy (byte streaming + CORS).
use axum::{
    body::Body,
    extract::Query,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const IA: &str = "https://archive.org";
const IA_SEARCH: &str = "https://archive.org/advancedsearch.php";
const IA_META: &str = "https://archive.org/metadata";
const IA_DOWNLOAD: &str = "https://archive.org/download";

const COLLECTIONS: &[(&str, &str)] = &[
    ("feature_films", "Film fitur (1930-an, komedi, melodrama)"),
    ("silent_films", "Film bisu"),
    ("film_noir", "Film noir"),
    ("classic_cartoons", "Kartun klasik"),
    ("animationandcartoons", "Animasi & kartun"),
    ("16mmfilms", "Film 16mm"),
    ("Film_Noir", "Film noir (varian kapital)"),
];

const ADULT_TERMS: &[&str] = &[
    "nudity", "nudie", "nude", "sexploitation", "sexploition", "stripping", "striptease",
    "peeping tom", "erotic", "pornograph", "porn", "softcore", "hentai", "fetish", "sexual",
    "sex ", " sex", "burlesque", "exploitation", "venereal", "prostitut", "eroticism",
    "burlesque show", "seduction", "loose women", "vice", "corruption",
];

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

fn pnum(m: &serde_json::Map<String, Value>, keys: &[&str], default: f64) -> f64 {
    for k in keys {
        if let Some(v) = m.get(*k) {
            match v {
                Value::Number(n) => return n.as_f64().unwrap_or(default),
                Value::String(s) => { if let Ok(x) = s.trim().parse::<f64>() { return x; } }
                _ => {}
            }
        }
    }
    default
}

fn pbool(m: &serde_json::Map<String, Value>, keys: &[&str]) -> bool {
    for k in keys {
        match m.get(*k) {
            Some(Value::Bool(b)) => return *b,
            Some(Value::String(s)) => { let s = s.to_lowercase(); if s == "true" || s == "1" { return true; } if s == "false" || s == "0" { return false; } }
            _ => {}
        }
    }
    false
}

fn bad(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response()
}

fn server_err(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (compatible; apiku/1.0)")
        .build().unwrap()
}

fn to_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn has_adult(subjects: &[String]) -> bool {
    let list = subjects.join(" | ").to_lowercase();
    ADULT_TERMS.iter().any(|t| list.contains(t))
}

async fn fetch_json(url: &str) -> Result<Value, String> {
    let res = client().get(url)
                    .header("Accept", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) { return Err(format!("Sumber data HTTP {}", status)); }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

async fn do_search(params: &serde_json::Map<String, Value>) -> Result<Value, String> {
    let collection_in = pstr(params, &["collection"]);
    let coll = if COLLECTIONS.iter().any(|(k, _)| k == &collection_in) && !collection_in.is_empty() { collection_in } else { "feature_films".to_string() };
    let p = pnum(params, &["page"], 1.0).max(1.0) as i64;
    let n = pnum(params, &["rows"], 20.0).clamp(1.0, 50.0) as i64;
    let query = pstr(params, &["query"]);
    let subject = pstr(params, &["subject"]);
    let year = pstr(params, &["year"]);
    let sort_in = pstr(params, &["sort"]);
    let adult = pbool(params, &["adult"]);

    let mut clauses = vec![format!("collection:{}", coll), "mediatype:movies".to_string()];
    if !query.is_empty() { clauses.push(format!("({})", query)); }
    if !subject.is_empty() { clauses.push(format!("subject:{}", subject)); }
    if !year.is_empty() { clauses.push(format!("year:{}", year)); }
    let sort = match sort_in.as_str() {
        "date" => "publicdate desc",
        "title" => "titleSorter asc",
        "random" => "random",
        _ => "downloads desc",
    };
    let mut url = format!(
        "{}?q={}&rows={}&page={}&output=json&sort={}",
        IA_SEARCH, urlencoding::encode(&clauses.join(" AND ")), n, p, urlencoding::encode(sort)
    );
    for f in ["identifier", "title", "year", "subject", "downloads", "runtime", "creator", "description", "publicdate", "avg_rating"] {
        url.push_str(&format!("&fl[]={}", f));
    }
    let data = fetch_json(&url).await?;
    let total = data.pointer("/response/numFound").and_then(|v| v.as_i64()).unwrap_or(0);
    let mut docs = data.pointer("/response/docs").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if !adult {
        docs.retain(|d| !has_adult(&to_list(d.get("subject"))));
    }
    let results: Vec<Value> = docs.into_iter().map(|d| {
        let ident = d.get("identifier").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let creators = to_list(d.get("creator"));
        json!({
            "identifier": ident,
            "title": d.get("title").cloned().unwrap_or(json!(ident)),
            "year": d.get("year").cloned().unwrap_or(Value::Null),
            "runtime": d.get("runtime").cloned().unwrap_or(Value::Null),
            "creator": creators.first().cloned().map(Value::String).unwrap_or(Value::Null),
            "subjects": to_list(d.get("subject")).into_iter().take(6).collect::<Vec<_>>(),
            "downloads": d.get("downloads").cloned().unwrap_or(json!(0)),
            "rating": d.get("avg_rating").cloned().unwrap_or(Value::Null),
            "released": d.get("publicdate").cloned().unwrap_or(Value::Null),
            "page": format!("{}/details/{}", IA, ident),
        })
    }).collect();
    Ok(json!({
        "total": total, "page": p, "totalPages": (total + n - 1) / n,
        "collection": coll, "results": results,
    }))
}

async fn do_detail(identifier: &str, adult: bool) -> Result<Value, String> {
    let id = identifier.trim();
    if id.is_empty() { return Err("Parameter \"identifier\" wajib diisi.".into()); }
    if !regex::Regex::new(r"^[A-Za-z0-9._-]+$").unwrap().is_match(id) {
        return Err("Format identifier tidak valid.".into());
    }
    let data = fetch_json(&format!("{}/{}", IA_META, urlencoding::encode(id))).await?;
    let m = data.get("metadata").cloned().unwrap_or(json!({}));
    if m.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        return Err(format!("Film \"{}\" tidak ditemukan.", id));
    }
    let subjects = to_list(m.get("subject"));
    if !adult && has_adult(&subjects) {
        return Err(format!(
            "Film \"{}\" ditandai bertema dewasa dan tidak ditampilkan. Kirim adult=true bila memang perlu.", id));
    }
    let files = data.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let vid_re = regex::Regex::new(r"(?i)\.(mp4|m4v|ogv|mpeg|mpg|webm)$").unwrap();
    let mut videos: Vec<Value> = files.iter()
        .filter(|f| f.get("name").and_then(|v| v.as_str()).map(|n| vid_re.is_match(n) && !n.starts_with('.')).unwrap_or(false))
        .map(|f| {
            let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let size: f64 = f.get("size").and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64())).unwrap_or(0.0);
            json!({
                "name": name, "size": size as i64,
                "sizeMB": ((size / 1048576.0) * 10.0).round() / 10.0,
                "format": f.get("format").cloned().unwrap_or(Value::Null),
                "height": f.get("height").cloned().unwrap_or(Value::Null),
                "width": f.get("width").cloned().unwrap_or(Value::Null),
                "length": f.get("length").cloned().unwrap_or(Value::Null),
                "url": format!("{}/{}/{}", IA_DOWNLOAD, id, urlencoding::encode(&name)),
            })
        }).collect();
    videos.sort_by(|a, b| {
        let av = a.get("sizeMB").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let bv = b.get("sizeMB").and_then(|v| v.as_f64()).unwrap_or(0.0);
        av.partial_cmp(&bv).unwrap_or(std::cmp::Ordering::Equal)
    });
    let thumb_re = regex::Regex::new(r"(?i)^__ia_thumb|thumb|_\.jpg$").unwrap();
    let thumbs: Vec<String> = files.iter()
        .filter(|f| f.get("name").and_then(|v| v.as_str()).map(|n| thumb_re.is_match(n)).unwrap_or(false))
        .filter_map(|f| f.get("name").and_then(|v| v.as_str()))
        .map(|n| format!("{}/{}/{}", IA_DOWNLOAD, id, urlencoding::encode(n))).collect();
    let creators = to_list(m.get("creator"));
    let desc = match m.get("description") {
        Some(Value::String(s)) => json!(s),
        Some(Value::Array(a)) => a.first().cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    };
    Ok(json!({
        "identifier": id,
        "title": m.get("title").cloned().unwrap_or(json!(id)),
        "year": m.get("year").cloned().unwrap_or(Value::Null),
        "date": m.get("date").cloned().unwrap_or(Value::Null),
        "runtime": m.get("runtime").cloned().unwrap_or(Value::Null),
        "creator": creators,
        "description": desc,
        "subjects": subjects,
        "language": to_list(m.get("language")),
        "rights": m.get("rights").cloned().unwrap_or(json!("Public domain")),
        "page": format!("{}/details/{}", IA, id),
        "thumbnail": if let Some(t) = thumbs.first() { json!(t) } else { json!(format!("{}/services/img/{}", IA, id)) },
        "videoCount": videos.len(),
        "videos": videos,
    }))
}

fn pick_video<'a>(videos: &'a [Value], max_size_mb: f64, file: &str) -> Result<(Value, Vec<Value>), String> {
    if !file.is_empty() {
        let picked = videos.iter().find(|v| v.get("name").and_then(|x| x.as_str()) == Some(file))
            .cloned().ok_or_else(|| format!("File \"{}\" tidak ada di film ini.", file))?;
        return Ok((picked.clone(), vec![picked]));
    }
    let mut pool: Vec<Value> = videos.to_vec();
    let mp4: Vec<Value> = pool.iter().filter(|v| v.get("name").and_then(|x| x.as_str()).map(|n| n.to_lowercase().ends_with(".mp4")).unwrap_or(false)).cloned().collect();
    if !mp4.is_empty() { pool = mp4; }
    if max_size_mb > 0.0 {
        let capped: Vec<Value> = pool.iter().filter(|v| {
            let sz = v.get("sizeMB").and_then(|x| x.as_f64()).unwrap_or(0.0);
            sz == 0.0 || sz <= max_size_mb
        }).cloned().collect();
        if !capped.is_empty() { pool = capped; }
    }
    let best = pool.first().cloned().ok_or("Tidak ada file video yang bisa di-stream.")?;
    Ok((best, pool))
}

async fn do_stream(identifier: &str, max_size_mb: f64, adult: bool, file: &str) -> Result<Value, String> {
    let detail = do_detail(identifier, adult).await?;
    let videos = detail.get("videos").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let (best, pool) = pick_video(&videos, max_size_mb, file)?;
    let mut alternatives = pool.into_iter().skip(1).take(5).map(|v| json!({
        "file": v.get("name").cloned().unwrap_or(Value::Null),
        "sizeMB": v.get("sizeMB").cloned().unwrap_or(Value::Null),
        "url": v.get("url").cloned().unwrap_or(Value::Null),
    })).collect::<Vec<_>>();
    let _ = &mut alternatives;
    Ok(json!({
        "identifier": detail.get("identifier").cloned().unwrap_or(Value::Null),
        "title": detail.get("title").cloned().unwrap_or(Value::Null),
        "year": detail.get("year").cloned().unwrap_or(Value::Null),
        "file": best.get("name").cloned().unwrap_or(Value::Null),
        "sizeMB": best.get("sizeMB").cloned().unwrap_or(Value::Null),
        "height": best.get("height").cloned().unwrap_or(Value::Null),
        "width": best.get("width").cloned().unwrap_or(Value::Null),
        "url": best.get("url").cloned().unwrap_or(Value::Null),
        "embedUrl": format!("{}/embed/{}", IA, urlencoding::encode(identifier)),
        "directPlay": true,
        "corsEnabled": false,
        "proxy": format!("/api/movie/freemovie?action=proxy&identifier={}{}",
            urlencoding::encode(identifier),
            if file.is_empty() { String::new() } else { format!("&file={}", urlencoding::encode(file)) }),
        "thumbnail": detail.get("thumbnail").cloned().unwrap_or(Value::Null),
        "page": detail.get("page").cloned().unwrap_or(Value::Null),
        "alternatives": alternatives,
    }))
}

/// Byte proxy with CORS + Range forwarding. Returns raw video response.
async fn do_proxy(identifier: &str, headers: &HeaderMap, max_size_mb: f64, adult: bool, file: &str) -> Response {
    let detail = match do_detail(identifier, adult).await {
        Ok(d) => d,
        Err(e) => return server_err(&e),
    };
    let videos = detail.get("videos").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let Ok((best, _)) = pick_video(&videos, max_size_mb, file) else {
        return server_err("Tidak ada file video yang bisa di-stream.");
    };
    let Some(url) = best.get("url").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
        return server_err("Tidak ada file video yang bisa di-stream.");
    };

    let mut rb = client().get(&url).timeout(Duration::from_secs(60));
    if let Some(range) = headers.get("range").and_then(|v| v.to_str().ok()) {
        rb = rb.header("Range", range);
    }
    let upstream = match rb.send().await {
        Ok(u) => u,
        Err(e) => return server_err(&format!("Gagal mengambil video dari sumber: {}", e)),
    };
    let status = upstream.status();
    if !upstream.status().is_success() && status.as_u16() != 206 {
        return server_err(&format!("Gagal mengambil video dari sumber (HTTP {})", status.as_u16()));
    }

    let cors = [
        ("access-control-allow-origin", "*"),
        ("access-control-allow-methods", "GET, HEAD, OPTIONS"),
        ("access-control-allow-headers", "Range, Content-Type"),
        ("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type"),
    ];
    let mut builder = Response::builder().status(status);
    for (k, v) in cors { builder = builder.header(k, v); }
    let mut builder = builder
        .header("content-type", upstream.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("video/mp4"))
                    .header("accept-ranges", "bytes")
                    .header("cache-control", "public, max-age=86400");
    if let Some(cl) = upstream.headers().get("content-length").and_then(|v| v.to_str().ok()) {
        builder = builder.header("content-length", cl);
    }
    if let Some(cr) = upstream.headers().get("content-range").and_then(|v| v.to_str().ok()) {
        builder = builder.header("content-range", cr);
    }
    let fname = best.get("name").and_then(|v| v.as_str()).unwrap_or("video.mp4").replace('"', "");
    let body_bytes = upstream.bytes().await.unwrap_or_default();
    builder.body(Body::from(body_bytes)).unwrap_or_else(|_| server_err("gagal menyiapkan response"))
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, headers: HeaderMap, body: Option<Json<Value>>) -> Response {
    let params = merged(&query, body.as_ref().map(|Json(v)| v));
    let a = pstr(&params, &["action"]).trim().to_lowercase();
    let a = if a.is_empty() { "list".to_string() } else { a };
    let adult = pbool(&params, &["adult"]);
    let max_size = pnum(&params, &["maxSize", "maxSizeMB"], 0.0);
    let file = pstr(&params, &["file"]);
    let identifier = pstr(&params, &["identifier"]);

    let result: Result<Value, String> = (|| async {
        if a == "list" || a == "search" {
            let q = pstr(&params, &["query"]);
            if a == "search" && q.is_empty() { return Err("PARAM:Parameter \"query\" wajib untuk action=search".into()); }
            let data = do_search(&params).await?;
            let mut out = json!({"status": true, "action": a});
            if let Some(o) = data.as_object() { for (k, v) in o { out[k] = v.clone(); } }
            return Ok(out);
        }
        if a == "detail" {
            if identifier.is_empty() { return Err("PARAM:Parameter \"identifier\" wajib untuk action=detail".into()); }
            let d = do_detail(&identifier, adult).await?;
            return Ok(json!({"status": true, "action": a, "result": d}));
        }
        if a == "stream" {
            if identifier.is_empty() { return Err("PARAM:Parameter \"identifier\" wajib untuk action=stream".into()); }
            let s = do_stream(&identifier, max_size, adult, &file).await?;
            return Ok(json!({"status": true, "action": a, "result": s}));
        }
        if a == "proxy" || a == "play" {
            if identifier.is_empty() { return Err("PARAM:Parameter \"identifier\" wajib untuk action=proxy".into()); }
            return Err("BYTES:".into()); // handled below
        }
        Err(format!("PARAM:Action \"{}\" tidak dikenal. Pilihan: list, search, detail, stream, proxy", a))
    })().await;

    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            if e == "BYTES:" {
                return do_proxy(&identifier, &headers, max_size, adult, &file).await;
            }
            if let Some(rest) = e.strip_prefix("PARAM:") { return bad(rest); }
            let mut resp = server_err(&e);
            if let Some(Value::Object(_)) = None { let _ = &mut resp; }
            resp
        }
    }
}

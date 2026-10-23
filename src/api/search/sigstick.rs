// SigStick Sticker Search — native conversion of api/search/sigstick.js
// Ambil buildId dari sigstick.com/stickers, lalu panggil endpoint _next/data Next.js.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

const BASE: &str = "https://www.sigstick.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const MAX_LIMIT: usize = 50;

fn err(status: StatusCode, msg: &str, code: &str, started: &std::time::Instant) -> Response {
    (
        status,
        Json(json!({
            "status": false,
            "message": msg,
            "code": code,
            "responseTime": format!("{}ms", started.elapsed().as_millis()),
        })),
    )
        .into_response()
}

async fn extract_build_id(client: &reqwest::Client) -> Result<String, String> {
    static CACHE: OnceLock<String> = OnceLock::new();
    if let Some(id) = CACHE.get() {
        return Ok(id.clone());
    }
    let html = client
        .get(format!("{}/stickers", BASE))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let find_after = |marker: &str| -> Option<String> {
        let pos = html.find(marker)?;
        let rest = &html[pos + marker.len()..];
        let end = rest.find('"')?;
        let id = &rest[..end];
        if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') && !id.is_empty() {
            Some(id.to_string())
        } else {
            None
        }
    };

    let id = find_after("\"buildId\":\"")
        .or_else(|| find_after("data-build-id=\""))
        .ok_or("Build ID tidak ditemukan di halaman /stickers")?;
    let _ = CACHE.set(id.clone());
    Ok(id)
}

fn summarize(pack: &Value) -> Value {
    json!({
        "id": pack.get("id").cloned().unwrap_or(Value::Null),
        "title": pack.get("title").and_then(Value::as_str).unwrap_or("Tanpa Judul"),
        "author": pack.get("author").cloned().unwrap_or(Value::Null),
        "status": pack.get("status").cloned().unwrap_or(Value::Null),
        "stickers": pack.get("stickers").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0),
        "cover": pack.pointer("/cover/url").cloned().unwrap_or(Value::Null),
        "telegramUrl": pack.get("telegramUrl").cloned().unwrap_or(Value::Null),
        "signalUrl": pack.get("signalUrl").cloned().unwrap_or(Value::Null),
        "views": pack.get("views").cloned().unwrap_or(Value::Null),
        "download": pack.get("download").cloned().unwrap_or(Value::Null),
    })
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let search_query = match get_param("query").as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => q.to_string(),
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi", "MISSING_QUERY", &started),
    };

    let raw_limit: f64 = match get_param("limit") {
        Some(l) if !l.is_empty() => match l.parse() {
            Ok(v) => v,
            Err(_) => return err(StatusCode::BAD_REQUEST, "Parameter 'limit' harus angka non-negatif", "INVALID_LIMIT", &started),
        },
        _ => 10.0,
    };
    if !(raw_limit >= 0.0) {
        return err(StatusCode::BAD_REQUEST, "Parameter 'limit' harus angka non-negatif", "INVALID_LIMIT", &started);
    }
    let lim = if raw_limit == 0.0 { MAX_LIMIT } else { (raw_limit as usize).min(MAX_LIMIT) };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::BAD_GATEWAY, &e.to_string(), "UPSTREAM_ERROR", &started),
    };

    let build_id = match extract_build_id(&client).await {
        Ok(b) => b,
        Err(e) => return err(StatusCode::BAD_GATEWAY, &e, "UPSTREAM_ERROR", &started),
    };

    let res = client
        .get(format!("{}/_next/data/{}/stickers.json", BASE, build_id))
        .query(&[("keyword", search_query.as_str())])
        .header("sec-ch-ua", "\"Chromium\";v=\"139\", \"Not;A=Brand\";v=\"99\"")
                    .header("x-nextjs-data", "1")
        .header("Referer", format!("{}/stickers?keyword={}", BASE, urlencoding::encode(&search_query)))
                    .header("sec-ch-ua-mobile", "?1")
        .header("sec-ch-ua-platform", "\"Android\"")
        .send()
        .await;

    let data: Value = match res {
        Ok(r) => match r.json::<Value>().await {
            Ok(v) => v,
            Err(e) => return err(StatusCode::BAD_GATEWAY, &e.to_string(), "UPSTREAM_ERROR", &started),
        },
        Err(e) => return err(StatusCode::BAD_GATEWAY, &e.to_string(), "UPSTREAM_ERROR", &started),
    };

    let all = data
        .pointer("/pageProps/packs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let total = all.len();
    let packs: Vec<Value> = if lim > 0 { all.iter().take(lim).map(summarize).collect() } else { all.iter().map(summarize).collect() };

    Json(json!({
        "status": true,
        "query": search_query,
        "total": total,
        "limit": lim,
        "returned": packs.len(),
        "result": packs,
        "responseTime": format!("{}ms", started.elapsed().as_millis()),
    })).into_response()
}

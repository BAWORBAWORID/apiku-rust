// Search Pinterest — native conversion of api/search/pinterest.js
// Pinterest resource API BaseSearchResource dengan session cookie + csrf.
// Catatan: Node versi memutar CORS worker proxies karena Pinterest soft-block
// IP datacenter. Native ini mencoba langsung; jika soft-block, kembalikan 404
// dengan pesan yang sama seperti Node.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

async fn get_session(client: &reqwest::Client) -> (String, String) {
    let res = client
        .get("https://id.pinterest.com/")
        .header("User-Agent", UA)
                    .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await;
    let mut cookies = String::new();
    let mut csrf = String::new();
    if let Ok(r) = res {
        for val in r.headers().get_all("set-cookie") {
            if let Ok(c) = val.to_str() {
                let pair = c.split(';').next().unwrap_or("").to_string();
                if pair.starts_with("csrftoken=") {
                    csrf = pair.trim_start_matches("csrftoken=").to_string();
                }
                if !cookies.is_empty() {
                    cookies.push_str("; ");
                }
                cookies.push_str(&pair);
            }
        }
    }
    (cookies, csrf)
}

async fn search_pinterest(client: &reqwest::Client, q: &str, limit: u32) -> Result<Value, String> {
    let (cookies, csrf) = get_session(client).await;
    let data = json!({
        "options": {
            "query": q,
            "scope": "pins",
            "page_size": limit,
            "refine_search_with_filters": true,
        },
        "context": {},
    });
    let source_url = format!("/search/pins/?q={}", urlencoding::encode(q));
    let url = format!(
        "https://id.pinterest.com/resource/BaseSearchResource/get/?source_url={}&data={}&_={}",
        urlencoding::encode(&source_url),
        urlencoding::encode(&data.to_string()),
        chrono::Utc::now().timestamp_millis()
    );

    let mut req = client
        .get(&url)
                    .header("accept", "application/json, text/javascript, */*, q=0.01")
                    .header("accept-language", "en-US,en;q=0.9")
        .header("user-agent", UA)
        .header("referer", format!("https://id.pinterest.com{}", source_url))
                    .header("x-requested-with", "XMLHttpRequest")
                    .header("x-app-version", "6d51d5a")
                    .header("x-pinterest-appstate", "active")
                    .header("x-pinterest-pws-handler", "www/search/[scope].js")
        .header("x-pinterest-source-url", &source_url);
    if !csrf.is_empty() {
        req = req.header("x-csrftoken", &csrf);
    }
    if !cookies.is_empty() {
        req = req.header("cookie", &cookies);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    if res.status().as_u16() != 200 {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let j: Value = res.json().await.map_err(|e| e.to_string())?;
    let payload = match j.pointer("/resource_response/data") {
        Some(p) => p.clone(),
        None => return Err("no data".to_string()),
    };

    let arr: Vec<Value> = if payload.is_array() {
        payload.as_array().cloned().unwrap_or_default()
    } else {
        payload.get("results").and_then(Value::as_array).cloned().unwrap_or_default()
    };

    let results: Vec<Value> = arr
        .iter()
        .filter(|x| x.get("id").is_some())
        .map(|pin| {
            let image = pin
                .pointer("/images/orig/url")
                .or_else(|| pin.pointer("/images/736x/url"))
                .cloned()
                .unwrap_or(Value::Null);
            let video = pin
                .pointer("/videos/video_list/V_HLSV4/url")
                .or_else(|| pin.pointer("/videos/video_list/V_EXP7/url"))
                .or_else(|| pin.pointer("/videos/video_list/V_720P/url"))
                .cloned()
                .unwrap_or(Value::Null);
            json!({
                "title": pin.get("title").or_else(|| pin.get("grid_title")).and_then(Value::as_str).unwrap_or(""),
                "image": image,
                "video": video,
                "username": pin.pointer("/pinner/username").cloned().unwrap_or(Value::Null),
                "fullName": pin.pointer("/pinner/full_name").cloned().unwrap_or(Value::Null),
                "pinUrl": format!("https://id.pinterest.com/pin/{}/", pin.get("id").and_then(Value::as_str).unwrap_or("")),
            })
        })
        .collect();

    Ok(json!({
        "query": q,
        "count": arr.len(),
        "bookmark": payload.get("bookmark").cloned().unwrap_or(Value::Null),
        "results": results,
    }))
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

    let search_query = match get_param("query").as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => q.to_string(),
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };
    let limit: u32 = get_param("limit").and_then(|l| l.parse().ok()).unwrap_or(5);

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari data: {e}")),
    };

    let mut result: Option<Value> = None;
    for _ in 0..3 {
        match search_pinterest(&client, &search_query, limit).await {
            Ok(r) => {
                let count = r.get("count").and_then(Value::as_i64).unwrap_or(0);
                if count > 0 {
                    result = Some(r);
                    break;
                }
            }
            Err(e) if e == "no data" => return err(StatusCode::NOT_FOUND, "Data tidak ditemukan"),
            Err(_) => continue,
        }
    }

    let result = match result {
        Some(r) => r,
        None => return err(StatusCode::NOT_FOUND, "Pinterest memblokir IP ini (soft-block datacenter). Coba lagi nanti."),
    };

    let items: Vec<Value> = result
        .get("results")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, item)| {
                    json!({
                        "index": i + 1,
                        "title": item.get("title").cloned().unwrap_or(Value::Null),
                        "image": item.get("image").cloned().unwrap_or(Value::Null),
                        "video": item.get("video").cloned().unwrap_or(Value::Null),
                        "username": item.get("username").cloned().unwrap_or(Value::Null),
                        "fullName": item.get("fullName").cloned().unwrap_or(Value::Null),
                        "pinUrl": item.get("pinUrl").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Json(json!({
        "status": true,
        "result": {
            "query": result.get("query").cloned().unwrap_or(json!(search_query)),
            "total": result.get("count").cloned().unwrap_or(json!(0)),
            "bookmark": result.get("bookmark").cloned().unwrap_or(Value::Null),
            "via_proxy": false,
            "items": items,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

// Douyin Search — native conversion of api/search/douyin-search.js
// Scrape so.douyin.com; ekstrak inline `let data = {...}` lalu ambil aweme_info.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://so.douyin.com/";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

fn extract_let_data(script_text: &str) -> Option<Value> {
    let re = regex::Regex::new(r"(?s)let\s+data\s*=\s*(\{[\s\S]+?\});").unwrap();
    let m = re.captures(script_text)?;
    // JS object literal is close enough to JSON only sometimes; try JSON first,
    // then fall back to lenient quoted-key conversion.
    let raw = m.get(1)?.as_str();
    if let Ok(v) = serde_json::from_str::<Value>(raw) {
        return Some(v);
    }
    // convert unquoted keys: {key: -> {"key":
    let re_keys = regex::Regex::new(r"([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:").unwrap();
    let fixed = re_keys.replace_all(raw, "$1\"$2\":");
    serde_json::from_str::<Value>(&fixed).ok()
}

async fn search(c: &reqwest::Client, query: &str) -> Result<Vec<Value>, String> {
    let _ = c.get(BASE_URL).send().await;

    let ts = chrono::Utc::now().timestamp_millis().to_string();
    let params = [
        ("search_entrance", "aweme"),
        ("enter_method", "normal_search"),
        ("innerWidth", "431"),
        ("innerHeight", "814"),
        ("reloadNavStart", ts.as_str()),
        ("is_no_width_reload", "1"),
        ("keyword", query),
    ];
    let res = c
        .get(format!("{}s", BASE_URL))
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("search douyin gagal: {}", e))?;
    if res.status().as_u16() != 200 {
        return Err(format!("Gagal mengambil halaman pencarian: {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;

    let doc = scraper::Html::parse_document(&html);
    let sel_script = scraper::Selector::parse("script").map_err(|e| e.to_string())?;
    let mut script_with_data = String::new();
    for script in doc.select(&sel_script) {
        let text = script.text().collect::<String>();
        if text.contains("let data =") && text.contains("\"business_data\"") {
            script_with_data = text;
        }
    }
    if script_with_data.is_empty() {
        return Err("Data tidak ditemukan di halaman".into());
    }

    let data = extract_let_data(&script_with_data).ok_or("Format data tidak dikenali")?;

    let aweme_infos: Vec<&Value> = data
        .get("business_data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|e| e.pointer("/data/aweme_info"))
                .collect()
        })
        .unwrap_or_default();

    if aweme_infos.is_empty() {
        return Err("Tidak ditemukan hasil pencarian".into());
    }

    Ok(aweme_infos
        .iter()
        .take(10)
        .enumerate()
        .map(|(i, video)| {
            json!({
                "rank": i + 1,
                "aweme_id": video.get("aweme_id").cloned().unwrap_or(Value::Null),
                "description": video.get("desc").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("Tanpa deskripsi"),
                "author": {
                    "name": video.pointer("/author/nickname").cloned().unwrap_or(json!("Unknown")),
                    "unique_id": video.pointer("/author/unique_id").cloned().unwrap_or(json!("")),
                    "avatar": video.pointer("/author/avatar_thumb/url_list/0").cloned().unwrap_or(Value::Null),
                },
                "statistics": {
                    "likes": video.pointer("/statistics/digg_count").cloned().unwrap_or(json!(0)),
                    "comments": video.pointer("/statistics/comment_count").cloned().unwrap_or(json!(0)),
                    "shares": video.pointer("/statistics/share_count").cloned().unwrap_or(json!(0)),
                    "views": video.pointer("/statistics/play_count").cloned().unwrap_or(json!(0)),
                },
                "duration": video.pointer("/video/duration").cloned().unwrap_or(json!(0)),
                "cover": video.pointer("/video/cover/url_list/0").cloned().unwrap_or(Value::Null),
                "url": format!("https://www.douyin.com/video/{}", video.get("aweme_id").and_then(Value::as_str).unwrap_or("")),
                "created_at": video
                    .get("create_time")
                    .and_then(Value::as_i64)
                    .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                    .map(|d| json!(d.to_rfc3339()))
                    .unwrap_or(Value::Null),
            })
        })
        .collect())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let q = match query
        .get("query")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("query").and_then(Value::as_str).map(str::to_string)))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        Some(q) => q,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    match search(&c, &q).await {
        Ok(results) => Json(json!({
            "status": true,
            "result": {
                "query": q,
                "total": results.len(),
                "videos": results,
            },
            "timestamp": chrono::Utc::now().timestamp_millis(),
        })).into_response(),
        Err(e) => {
            let status = if e.contains("wajib diisi") || e.contains("tidak ditemukan") || e.contains("tidak dikenali") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            err(status, &e)
        }
    }
}

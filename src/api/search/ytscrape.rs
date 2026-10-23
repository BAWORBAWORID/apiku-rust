// YouTube Search (YTScrape) — native conversion of api/search/ytscrape.js
// ytInitialData + InnerTube continuation, tanpa API key.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const YT: &str = "https://www.youtube.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn scan_json(text: &str, start: usize) -> Option<&str> {
    let bytes: Vec<char> = text.chars().collect();
    // operate on char indices; caller passes byte index, convert once
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, c) in bytes.iter().enumerate().skip(start) {
        if in_str {
            if esc {
                esc = false;
            } else if *c == '\\' {
                esc = true;
            } else if *c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' | '[' => depth += 1,
            '}' | ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text.get(start..=i)?);
                }
            }
            _ => {}
        }
    }
    None
}

fn runs(o: Option<&Value>) -> String {
    o.and_then(|v| v.get("runs"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn walk_search(node: &Value, out: &mut Vec<Value>, token: &mut Option<String>) {
    match node {
        Value::Array(arr) => {
            for v in arr {
                walk_search(v, out, token);
            }
        }
        Value::Object(_) => {
            if let Some(v) = node.get("videoRenderer") {
                if let Some(id) = v.get("videoId").and_then(Value::as_str) {
                    let channel_url = v
                        .pointer("/ownerText/runs/0/navigationEndpoint/browseEndpoint/browseId")
                        .and_then(Value::as_str)
                        .map(|bid| format!("{}/channel/{}", YT, bid));
                    let title_t = runs(v.get("title"));
                    let title_v: Value = if title_t.is_empty() { Value::Null } else { json!(title_t) };
                    let chan_t = runs(v.get("ownerText"));
                    let channel_v: Value = if chan_t.is_empty() { Value::Null } else { json!(chan_t) };
                    out.push(json!({
                        "id": id,
                        "url": format!("https://www.youtube.com/watch?v={}", id),
                        "title": title_v,
                        "length": v.pointer("/lengthText/simpleText").cloned().unwrap_or(Value::Null),
                        "views": v.pointer("/viewCountText/simpleText").cloned().unwrap_or(Value::Null),
                        "channel": channel_v,
                        "channelUrl": channel_url,
                        "published": v.pointer("/publishedTimeText/simpleText").cloned().unwrap_or(Value::Null),
                        "thumb": v.pointer("/thumbnail/thumbnails")
                            .and_then(Value::as_array)
                            .and_then(|a| a.last())
                            .and_then(|t| t.get("url"))
                            .cloned()
                            .unwrap_or(Value::Null),
                    }));
                }
            }
            if token.is_none() {
                let t = node
                    .pointer("/continuationCommand/token")
                    .or_else(|| node.pointer("/continuationEndpoint/continuationCommand/token"))
                    .and_then(Value::as_str);
                if let Some(t) = t {
                    *token = Some(t.to_string());
                }
            }
            if let Value::Object(map) = node {
                for val in map.values() {
                    walk_search(val, out, token);
                }
            }
        }
        _ => {}
    }
}

async fn search(query: &str, limit: usize) -> Result<Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query kosong".into());
    }
    let max = limit.clamp(1, 60);

    let client = reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let page = client
        .get(format!("{}/results?search_query={}&hl=en&gl=US", YT, urlencoding::encode(q)))
                    .header("Accept", "text/html,application/xhtml+xml")
                    .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if page.status().as_u16() != 200 {
        return Err(format!("halaman search HTTP {}", page.status().as_u16()));
    }
    let text = page.text().await.map_err(|e| e.to_string())?;

    let key = regex::Regex::new(r#""INNERTUBE_API_KEY":"([^"]+)""#).unwrap();
    let ver_re = regex::Regex::new(r#""INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)""#).unwrap();
    let key = key.captures(&text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
    let ver = ver_re
        .captures(&text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "2.20261009.01.00".to_string());

    let at = text.find("var ytInitialData").ok_or("ytInitialData tidak ditemukan")?;
    let brace = text[at..].find('{').map(|i| at + i).ok_or("ytInitialData tidak ditemukan")?;
    // char-safe scan: use byte slice directly (JSON is ASCII-structural; multi-byte inside strings is fine for serde)
    let js = scan_json(&text, brace).ok_or("ytInitialData tidak ditemukan")?;
    let data: Value = serde_json::from_str(js).map_err(|e| e.to_string())?;

    let mut results: Vec<Value> = Vec::new();
    let mut token: Option<String> = None;
    walk_search(&data, &mut results, &mut token);

    let mut pages = 0;
    while pages < 2 && results.len() < max && token.is_some() {
        pages += 1;
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        let body = json!({
            "context": {"client": {"hl": "en", "gl": "US", "clientName": "WEB", "clientVersion": ver}},
            "continuation": token.clone().unwrap_or_default(),
        });
        let res = client
            .post(format!("{}/youtubei/v1/search?key={}&prettyPrint=false", YT, key))
                        .header("Content-Type", "application/json")
                        .header("X-Youtube-Client-Name", "1")
            .header("X-Youtube-Client-Version", &ver)
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().as_u16() != 200 {
            break;
        }
        let j: Value = res.json().await.map_err(|e| e.to_string())?;
        let before = results.len();
        let mut ref_token: Option<String> = None;
        walk_search(&j, &mut results, &mut ref_token);
        if results.len() == before {
            break;
        }
        token = ref_token;
    }

    let mut seen = std::collections::HashSet::new();
    let mut dedup: Vec<Value> = Vec::new();
    for r in results {
        let id = r.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        if !seen.insert(id) {
            continue;
        }
        let mut rr = r;
        if let Some(o) = rr.as_object_mut() {
            o.insert("rank".into(), json!(dedup.len() + 1));
        }
        dedup.push(rr);
        if dedup.len() >= max {
            break;
        }
    }

    Ok(json!({"query": q, "limit": max, "count": dedup.len(), "results": dedup}))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if !v.is_empty() {
                    return Some(v.clone());
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(s) = v.get(*k).and_then(Value::as_str) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        None
    };

    let q = match get_param(&["q", "query"]).as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => q.to_string(),
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'q' wajib diisi."),
    };
    let limit: usize = get_param(&["limit"])
        .and_then(|l| l.parse().ok())
        .unwrap_or(20);

    match search(&q, limit).await {
        Ok(result) => Json(json!({"status": true, "result": result})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

// Pinterest Video Search — native conversion of api/search/pinvid-search.js
// BaseSearchResource scope=videos dengan handshake cookie. Node memakai CORS
// worker proxies; native ini mencoba langsung dan jujur saat soft-block.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA_FIREFOX: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0";
const HOST: &str = "id.pinterest.com";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

async fn search_videos(q: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        
        .user_agent(UA_FIREFOX)
        .build()
        .map_err(|e| e.to_string())?;

    let init = client
        .get(format!("https://{}/", HOST))
                    .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                    .header("accept-language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !init.status().is_success() {
        return Err(format!("handshake HTTP {}", init.status().as_u16()));
    }
    let mut cookie_string = String::new();
    for val in init.headers().get_all("set-cookie") {
        if let Ok(c) = val.to_str() {
            let pair = c.split(';').next().unwrap_or("").to_string();
            if !cookie_string.is_empty() {
                cookie_string.push_str("; ");
            }
            cookie_string.push_str(&pair);
        }
    }

    let source_url = format!("/search/videos/?q={}&rs=content_type_filter&filter_location=1", urlencoding::encode(q));
    let data_payload = json!({
        "options": {
            "query": q, "scope": "videos", "appliedProductFilters": "---",
            "auto_correction_disabled": false, "redux_normalize_feed": true,
            "source_url": source_url, "rs": "content_type_filter",
        },
        "context": {},
    });
    let search_url = format!(
        "https://{}/resource/BaseSearchResource/get/?source_url={}&data={}&_={}",
        HOST,
        urlencoding::encode(&source_url),
        urlencoding::encode(&data_payload.to_string()),
        chrono::Utc::now().timestamp_millis()
    );

    let res = client
        .get(&search_url)
                    .header("accept", "application/json, text/javascript, */*; q=0.01")
                    .header("accept-language", "en-US,en;q=0.9")
        .header("referer", format!("https://{}{}", HOST, source_url))
                    .header("x-requested-with", "XMLHttpRequest")
                    .header("x-app-version", "8048c97")
                    .header("x-pinterest-appstate", "active")
        .header("x-pinterest-source-url", &source_url)
                    .header("x-pinterest-pws-handler", "www/search/[scope].js")
        .header("cookie", &cookie_string)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let results = data
        .pointer("/resource_response/data/results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let videos: Vec<Value> = results
        .iter()
        .filter_map(|p| {
            let vlist = p.pointer("/videos/video_list")?;
            let video = vlist
                .pointer("/V_HLSV4/url")
                .or_else(|| vlist.pointer("/V_HLSV3_MOBILE/url"))
                .and_then(Value::as_str)?
                .to_string();
            Some(json!({
                "id": p.get("id").cloned().unwrap_or(Value::Null),
                "title": p.get("grid_title").or_else(|| p.get("title")).cloned().unwrap_or(Value::Null),
                "description": p.get("description").cloned().unwrap_or(Value::Null),
                "video": video,
                "thumbnail": p.pointer("/images/orig/url").cloned().unwrap_or(Value::Null),
                "duration": p.pointer("/videos/duration").cloned().unwrap_or(Value::Null),
                "link": format!("https://www.pinterest.com/pin/{}", p.get("id").and_then(Value::as_str).unwrap_or("")),
                "pinner": p.pointer("/pinner/full_name").cloned().unwrap_or(Value::Null),
                "username": p.pointer("/pinner/username").cloned().unwrap_or(Value::Null),
                "likes": p.pointer("/reaction_counts/1").cloned().unwrap_or(json!(0)),
            }))
        })
        .collect();

    Ok(json!({"query": q, "total": videos.len(), "results": videos}))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let clean = match query
        .get("query")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("query").and_then(Value::as_str).map(str::to_string)))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        Some(q) => q,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };

    let mut last_error: Option<String> = None;
    for _ in 0..3 {
        match search_videos(&clean).await {
            Ok(r) => {
                let total = r.get("total").and_then(Value::as_i64).unwrap_or(0);
                if total > 0 {
                    let mut obj = json!({"status": true});
                    if let (Some(dst), Some(src)) = (obj.as_object_mut(), r.as_object()) {
                        dst.extend(src.iter().map(|(k, v)| (k.clone(), v.clone())));
                    }
                    return Json(obj).into_response();
                }
                last_error = Some("empty".to_string());
            }
            Err(e) => last_error = Some(e),
        }
    }
    if last_error.as_deref() == Some("empty") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"status": false, "message": "Pinterest memblokir IP ini (soft-block datacenter). Coba lagi nanti.", "query": clean, "total": 0, "results": []})),
        )
            .into_response();
    }
    err(StatusCode::INTERNAL_SERVER_ERROR, last_error.as_deref().unwrap_or("Gagal mencari video Pinterest"))
}

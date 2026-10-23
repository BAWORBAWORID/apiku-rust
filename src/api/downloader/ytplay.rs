// YouTube Play — native conversion of api/downloader/ytplay.js
// yt-search equivalent: scrape YouTube search results page (ytInitialData).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const DEFAULT_QUERY: &str = "Pilihan hatiku";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

fn format_number(num: f64) -> String {
    let suffixes = ["", "Rb", "Jt", "M", "T"];
    let num_string = format!("{}", num.abs() as i64);
    let num_digits = num_string.len();
    if num_digits <= 3 {
        return num_string;
    }
    let suffix_index = (num_digits - 1) / 3;
    let mut formatted = format!("{:.1}", num / 1000f64.powi(suffix_index as i32));
    if formatted.ends_with(".0") {
        formatted = formatted[..formatted.len() - 2].to_string();
    }
    format!("{formatted}{}", suffixes[suffix_index])
}

fn find_video_renderer(v: &Value) -> Option<Value> {
    if v.get("videoRenderer").is_some() {
        return v.get("videoRenderer").cloned();
    }
    if let Some(arr) = v.as_array() {
        for item in arr {
            if let Some(found) = find_video_renderer(item) {
                return Some(found);
            }
        }
    } else if let Some(obj) = v.as_object() {
        for (_, val) in obj {
            if let Some(found) = find_video_renderer(val) {
                return Some(found);
            }
        }
    }
    None
}

fn text_of(v: &Value) -> String {
    v.pointer("/runs/0/text")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .or_else(|| v.get("simpleText").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .unwrap_or_default()
}

fn parse_yt(vr: &Value) -> Option<Value> {
    let video_id = vr.get("videoId").and_then(|v| v.as_str())?;
    let title = text_of(vr.get("title")?);
    let author = text_of(vr.pointer("/ownerText/runs/0").unwrap_or(&Value::Null));
    let author_url = vr
        .pointer("/ownerText/runs/0/navigationEndpoint/browseEndpoint/canonicalBaseUrl")
        .and_then(|u| u.as_str())
        .map(|s| format!("https://www.youtube.com{s}"))
        .unwrap_or_default();
    let thumbnail = vr
        .pointer("/thumbnail/thumbnails/0/url")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let views_raw = vr
        .pointer("/viewCountText/simpleText")
        .or_else(|| vr.pointer("/viewCountText/runs/0/text"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .replace("x ditonton", "")
        .replace(" views", "")
        .replace(" ditonton", "")
        .replace(",", "");
    let raw_views: f64 = views_raw.trim().parse().unwrap_or(0.0);
    let views = format_number(raw_views);
    let length = text_of(vr.get("lengthText").unwrap_or(&Value::Null));
    let published = text_of(vr.get("publishedTimeText").unwrap_or(&Value::Null));

    Some(json!({
        "title": title,
        "author": author,
        "author_url": author_url,
        "thumbnail": thumbnail,
        "duration": length,
        "views": views,
        "uploaded": published,
        "url": format!("https://www.youtube.com/watch?v={video_id}"),
        "raw_views": raw_views as i64
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("query").and_then(|u| u.as_str()) {
            merged.insert("query".into(), u.to_string());
        }
    }
    let q_raw = merged.get("query").map(|s| s.trim().to_string()).unwrap_or_default();
    let query = if q_raw.is_empty() { DEFAULT_QUERY.to_string() } else { q_raw };

    if query.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Query pencarian wajib diisi",
            "default_example": DEFAULT_QUERY
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("YT Play: {e}")
        }))).into_response(),
    };

    let html = match client
        .get("https://www.youtube.com/results")
        .query(&[("search_query", query.as_str()), ("hl", "id")])
        .send()
        .await
    {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("YT Play: {e}")
        }))).into_response(),
    };

    let yt_data: Value = match html
        .split("var ytInitialData = ")
        .nth(1)
        .or_else(|| html.split("ytInitialData =").nth(1))
        .and_then(|s| serde_json::from_str::<Value>(s.split("</script>").next().unwrap_or("")).ok())
    {
        Some(v) => v,
        None => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": format!("YT Play: tidak dapat mem-parsing hasil pencarian untuk \"{query}\"")
            }))).into_response()
        }
    };

    match find_video_renderer(&yt_data).and_then(|vr| parse_yt(&vr)) {
        Some(data) => {
            let url = data["url"].clone();
            Json(json!({
                "status": true,
                "data": data,
                "query": query,
                "download_options": {
                    "audio": format!("Gunakan endpoint /ytmp3 dengan parameter url={url}"),
                    "video": format!("Gunakan endpoint /ytmp4 dengan parameter url={url}")
                },
                "timestamp": chrono::Utc::now().to_rfc3339()
            }))
            .into_response()
        }
        None => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": format!("Video dengan query \"{query}\" tidak ditemukan")
        }))).into_response(),
    }
}

// Search Song — native conversion of api/search/search-song.js
// searchthatsong.com: route-preview lalu full search dengan session cookie.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://searchthatsong.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 VyrSTS/1.0";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

async fn route_preview(c: &reqwest::Client, query: &str) -> Result<(Value, Option<String>), String> {
    let res = c
        .post(format!("{}/api/search/route-preview", BASE))
        .json(&json!({"query": query}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().as_u16() != 200 {
        return Err(format!("request failed [7f3a9c/rp] status={}", res.status().as_u16()));
    }
    let mut session_id = None;
    for val in res.headers().get_all("set-cookie") {
        if let Ok(cookie) = val.to_str() {
            if let Some(m) = regex::Regex::new(r"session_id=([^;]+)").unwrap().captures(cookie) {
                session_id = Some(m[1].to_string());
                break;
            }
        }
    }
    let route: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok((route, session_id))
}

async fn full_search(c: &reqwest::Client, query: &str, route_preview: &Value, session_id: Option<&str>) -> Result<Value, String> {
    let mut req = c
        .post(format!("{}/", BASE))
        .json(&json!({"data": query, "route_preview": route_preview, "search_mode": "web_search"}));
    if let Some(sid) = session_id {
        req = req.header("Cookie", format!("session_id={}", sid));
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if res.status().as_u16() != 200 {
        return Err(format!("request failed [4d4f4c565952/fs] status={}", res.status().as_u16()));
    }
    res.json().await.map_err(|e| e.to_string())
}

fn build_result(raw: &Value) -> Value {
    let empty = json!({});
    let a = raw.get("answer").unwrap_or(raw);
    let sid = raw.get("session_id").cloned();
    let marker = format!(
        "vyr.{}.7f3a9c",
        sid.as_ref().and_then(Value::as_str).map(|s| s.chars().take(8).collect::<String>()).unwrap_or_else(|| "local".to_string())
    );
    let a_get = |k: &str| a.get(k).cloned().unwrap_or(Value::Null);
    let lyrics = a.get("plain_lyrics").and_then(Value::as_str).filter(|s| *s != "n/a");
    let chunk = a.get("most_relevant_chunk").and_then(Value::as_str).filter(|s| *s != "n/a");
    json!({
        "song": a_get("song"),
        "artist": a_get("artist"),
        "album": a_get("album"),
        "year": a.get("year_song_released").cloned().or_else(|| a.get("year").cloned()).unwrap_or(Value::Null),
        "genre": a_get("genre"),
        "confidence": a_get("router_confidence"),
        "queryType": a_get("query_type"),
        "lyrics": lyrics,
        "relevantChunk": chunk,
        "previewUrl": a_get("preview_audio_url"),
        "albumArtwork": a.get("album_artwork_url").cloned().or_else(|| a.get("album_artwork").cloned()).unwrap_or(Value::Null),
        "artistPic": a_get("artist_profile_pic"),
        "youtubeUrl": a.get("Youtube_URL").cloned().or_else(|| a.get("youtube_url").cloned()).unwrap_or(Value::Null),
        "webSources": a.get("web_sources").cloned().unwrap_or(json!([])),
        "sessionId": sid.unwrap_or(Value::Null),
        "_cache": marker,
        "_raw": a.clone(),
    })
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

    let result = async {
        let (route, session_id) = route_preview(&c, &q).await?;
        let raw = full_search(&c, &q, &route, session_id.as_deref()).await?;
        Ok::<_, String>(build_result(&raw))
    }
    .await;

    match result {
        Ok(result) => Json(json!({"status": true, "result": result})).into_response(),
        Err(e) => {
            let status = if e.contains("not found") || e.contains("tidak ditemukan") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            err(status, &e)
        }
    }
}

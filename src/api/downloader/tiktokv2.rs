// TikTok Downloader v2 — native conversion of api/downloader/tiktokv2.js
// Provider: tikwm.com (pure HTTP API — POST url+hd=1)
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_API: &str = "https://tikwm.com/api/";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

fn or_null(v: Option<&Value>) -> Value {
    v.cloned().unwrap_or(Value::Null)
}

fn def_i64(v: Option<&Value>, d: i64) -> Value {
    json!(v.and_then(|x| x.as_i64()).unwrap_or(d))
}

fn default_str(v: Option<&Value>, d: &str) -> Value {
    v.and_then(|x| x.as_str())
        .map(|s| json!(s))
        .unwrap_or_else(|| json!(d))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())
}

async fn resolve_short_url(client: &reqwest::Client, url: &str) -> String {
    if url.contains("tt.site") || url.contains("vt.tiktok.com") || url.contains("vm.tiktok.com") {
        if let Ok(res) = client.head(url).send().await {
            let final_url = res.url().to_string();
            if final_url != url && final_url.starts_with("http") {
                return final_url;
            }
        }
    }
    url.to_string()
}

fn parse_response(api: &Value) -> Result<Value, String> {
    let code = api.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    let data = api.get("data");
    if code != 0 || data.is_none() {
        let msg = api.get("msg").and_then(|m| m.as_str()).unwrap_or("Failed to fetch TikTok data");
        return Err(msg.to_string());
    }
    let d = data.unwrap();

    let mut result = json!({
        "id": or_null(d.get("id")),
        "region": or_null(d.get("region")),
        "title": or_null(d.get("title")),
        "cover": or_null(d.get("cover")),
        "origin_cover": or_null(d.get("origin_cover")),
        "duration": def_i64(d.get("duration"), 0),
        "play": or_null(d.get("play")),
        "wmplay": or_null(d.get("wmplay")),
        "hdplay": or_null(d.get("hdplay")),
        "size": def_i64(d.get("size"), 0),
        "wm_size": def_i64(d.get("wm_size"), 0),
        "hd_size": def_i64(d.get("hd_size"), 0),
        "music": or_null(d.get("music")),
        "music_info": or_null(d.get("music_info")),
        "play_count": def_i64(d.get("play_count"), 0),
        "digg_count": def_i64(d.get("digg_count"), 0),
        "comment_count": def_i64(d.get("comment_count"), 0),
        "share_count": def_i64(d.get("share_count"), 0),
        "download_count": def_i64(d.get("download_count"), 0),
        "collect_count": def_i64(d.get("collect_count"), 0),
        "create_time": def_i64(d.get("create_time"), 0),
        "author": or_null(d.get("author")),
        "type": null,
        "downloads": { "nowm": [], "wm": [], "hd": [] },
        "audio": [],
        "images": [],
    });

    let images: Vec<Value> = d.get("images").and_then(|i| i.as_array()).cloned().unwrap_or_default();

    if !images.is_empty() {
        result["type"] = json!("photo");
        let imgs: Vec<Value> = images
            .iter()
            .enumerate()
            .map(|(i, img)| json!({ "index": i + 1, "url": img, "preview": img }))
            .collect();
        result["images"] = json!(imgs);
        if let Some(wm) = d.get("wmplay").and_then(|w| w.as_str()) {
            result["downloads"]["wm"] = json!([{
                "url": wm, "quality": "watermarked",
                "size": or_null(d.get("wm_size")), "format": "mp4"
            }]);
        }
    } else {
        result["type"] = json!("video");
        if let Some(play) = d.get("play").and_then(|p| p.as_str()) {
            result["downloads"]["nowm"] = json!([{
                "url": play, "quality": "normal",
                "size": or_null(d.get("size")), "format": "mp4"
            }]);
        }
        if let Some(wm) = d.get("wmplay").and_then(|p| p.as_str()) {
            result["downloads"]["wm"] = json!([{
                "url": wm, "quality": "watermarked",
                "size": or_null(d.get("wm_size")), "format": "mp4"
            }]);
        }
        if let Some(hd) = d.get("hdplay").and_then(|p| p.as_str()) {
            result["downloads"]["hd"] = json!([{
                "url": hd, "quality": "hd",
                "size": or_null(d.get("hd_size")), "format": "mp4"
            }]);
        }
    }

    if let Some(music) = d.get("music").and_then(|m| m.as_str()) {
        let mi = d.get("music_info");
        result["audio"] = json!([{
            "url": music,
            "title": default_str(mi.and_then(|m| m.get("title")), "Unknown"),
            "author": default_str(mi.and_then(|m| m.get("author")), "Unknown"),
            "duration": def_i64(mi.and_then(|m| m.get("duration")), 0),
            "cover": or_null(mi.and_then(|m| m.get("cover"))),
            "format": "mp3"
        }]);
    }

    if let Some(author) = result.get_mut("author") {
        if author.is_object() {
            *author = json!({
                "id": or_null(author.get("id")),
                "unique_id": or_null(author.get("unique_id")),
                "nickname": or_null(author.get("nickname")),
                "avatar": or_null(author.get("avatar")),
                "signature": or_null(author.get("signature")),
                "verified": author.get("verified").and_then(|v| v.as_bool()).unwrap_or(false),
                "private_account": author.get("private_account").and_then(|v| v.as_bool()).unwrap_or(false),
                "region": or_null(author.get("region")),
            });
        }
    }

    if let Some(ct) = d.get("create_time").and_then(|c| c.as_i64()) {
        if ct > 0 {
            use chrono::TimeZone;
            if let Some(dt) = chrono::Utc.timestamp_opt(ct, 0).single() {
                result["create_time_formatted"] = json!(dt.to_rfc3339());
            }
        }
    }

    Ok(result)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged: HashMap<String, String> = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }

    let raw_url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "code": 400,
                "message": "Parameter 'url' wajib diisi",
                "example": "https://vt.tiktok.com/ZSbm6fY8P/"
            }))).into_response()
        }
    };

    if !(raw_url.contains("tiktok.com") || raw_url.contains("tt.site")) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "code": 400,
            "message": "URL tidak valid. Harus berupa link TikTok"
        }))).into_response();
    }

    let client = match client() {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false, "code": 502,
            "message": format!("API Error: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    let url = resolve_short_url(&client, &raw_url).await;

    let form = [("url", url.as_str()), ("hd", "1")];
    let resp = client
        .post(BASE_API)
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    .header("Cookie", "current_language=en")
        .form(&form)
        .send()
        .await;

    let api: Value = match resp {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false, "code": 502,
                "message": format!("API Error: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()
            }))).into_response(),
        },
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false, "code": 502,
            "message": format!("API Error: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    };

    match parse_response(&api) {
        Ok(result) => Json(json!({
            "status": true, "code": 200,
            "provider": "tikwm.com", "input": url,
            "result": result,
            "timestamp": chrono::Utc::now().timestamp_millis()
        })).into_response(),
        Err(msg) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "code": 500,
            "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response(),
    }
}

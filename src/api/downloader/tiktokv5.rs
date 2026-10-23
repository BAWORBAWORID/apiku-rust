// TikTok Downloader Direct v5 — native conversion of api/downloader/tiktokv5.js
// Scrape HTML TikTok: <script id="api-data"> / __UNIVERSAL_DATA_FOR_REHYDRATION__
// → itemStruct; player API untuk direct URL video.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

fn script_json<'a>(html: &'a str, id_marker: &str) -> Option<&'a str> {
    let idx = html.find(id_marker)?;
    let after = &html[idx + id_marker.len()..];
    // skip to end of opening tag
    let after = after.split_once('>')?.1;
    let end = after.find("</script>")?;
    Some(after[..end].trim())
}

fn extract_item_struct(html: &str) -> Option<Value> {
    if let Some(script) = script_json(html, "id=\"api-data\"") {
        if let Ok(j) = serde_json::from_str::<Value>(script) {
            if let Some(s) = j.pointer("/videoDetail/itemInfo/itemStruct").or_else(|| j.pointer("/itemInfo/itemStruct")) {
                return Some(s.clone());
            }
            if let Some(item_module) = j.get("ItemModule").and_then(|m| m.as_object()) {
                if let Some((_, first)) = item_module.iter().next() {
                    return Some(first.clone());
                }
            }
        }
    }
    if let Some(script) = script_json(html, "id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"") {
        if let Ok(j) = serde_json::from_str::<Value>(script) {
            if let Some(scope) = j.get("__DEFAULT_SCOPE__").and_then(|s| s.as_object()) {
                for (_, v) in scope {
                    if let Some(s) = v.pointer("/itemInfo/itemStruct") {
                        return Some(s.clone());
                    }
                }
            }
        }
    }
    None
}

async fn fetch_player_api(client: &reqwest::Client, item_id: &str) -> Option<String> {
    let url = format!("https://www.tiktok.com/player/api/v1/items?item_ids={item_id}");
    let data: Value = client.get(&url).header("user-agent", UA).send().await.ok()?.json().await.ok()?;
    data.pointer("/items/0/video_info/url_list/0")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
}

fn i64_of(v: Option<&Value>) -> i64 {
    v.and_then(|x| x.as_i64()).unwrap_or(0)
}

fn build_result(detail: &Value, direct_url: Option<String>) -> Value {
    let is_image = detail.get("imagePost").is_some();
    let photos: Vec<String> = if is_image {
        detail
            .pointer("/imagePost/images")
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default()
            .iter()
            .enumerate()
            .filter_map(|(i, img)| {
                img.pointer("/imageURL/urlList/0")
                    .and_then(|u| u.as_str())
                    .map(|u| json!({ "index": i + 1, "url": u }))
            })
            .filter_map(|v| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
            .collect()
    } else {
        Vec::new()
    };
    let photo_objs: Vec<Value> = photos
        .iter()
        .enumerate()
        .map(|(i, u)| json!({ "index": i + 1, "url": u }))
        .collect();

    let nowm = direct_url.or_else(|| {
        detail.pointer("/video/playAddr").and_then(|v| v.as_str()).map(|s| s.to_string())
    });
    let wm = detail.pointer("/video/downloadAddr").cloned().unwrap_or(Value::Null);

    json!({
        "id": detail.get("id").or_else(|| detail.get("aweme_id")).cloned().unwrap_or(Value::Null),
        "type": if is_image { "image" } else { "video" },
        "title": detail.get("desc").and_then(|d| d.as_str())
            .or_else(|| detail.pointer("/suggestedWords/0").and_then(|d| d.as_str()))
            .unwrap_or(""),
        "region": detail.get("locationCreated").cloned().unwrap_or(Value::Null),
        "duration": i64_of(detail.pointer("/video/duration")).max(i64_of(detail.pointer("/music/duration"))),
        "cover": detail.pointer("/video/cover").cloned()
            .or_else(|| detail.pointer("/video/originCover").cloned())
            .unwrap_or(Value::Null),
        "video": if is_image { Value::Null } else { json!({ "nowm": nowm, "wm": wm }) },
        "images": photos,
        "music": {
            "id": detail.pointer("/music/id").cloned().unwrap_or(Value::Null),
            "title": detail.pointer("/music/title").and_then(|t| t.as_str()).unwrap_or(""),
            "author": detail.pointer("/music/authorName").and_then(|t| t.as_str()).unwrap_or(""),
            "duration": i64_of(detail.pointer("/music/duration")),
            "url": detail.pointer("/music/playUrl").cloned().unwrap_or(Value::Null),
            "thumbnail": detail.pointer("/music/coverLarge").cloned()
                .or_else(|| detail.pointer("/music/coverMedium").cloned())
                .or_else(|| detail.pointer("/music/coverThumb").cloned())
                .unwrap_or(Value::Null)
        },
        "stats": {
            "views": i64_of(detail.pointer("/stats/playCount")),
            "likes": i64_of(detail.pointer("/stats/diggCount")),
            "shares": i64_of(detail.pointer("/stats/shareCount")),
            "comments": i64_of(detail.pointer("/stats/commentCount")),
            "collects": i64_of(detail.pointer("/stats/collectCount"))
        },
        "author": {
            "id": detail.pointer("/author/id").cloned().unwrap_or(json!("")),
            "secUid": detail.pointer("/author/secUid").cloned().unwrap_or(json!("")),
            "username": detail.pointer("/author/uniqueId").cloned().unwrap_or(json!("")),
            "nickname": detail.pointer("/author/nickname").cloned().unwrap_or(json!("")),
            "avatar": detail.pointer("/author/avatarLarger").cloned()
                .or_else(|| detail.pointer("/author/avatarMedium").cloned())
                .or_else(|| detail.pointer("/author/avatarThumb").cloned())
                .unwrap_or(Value::Null),
            "verified": detail.pointer("/author/verified").and_then(|v| v.as_bool()).unwrap_or(false),
            "followers": i64_of(detail.pointer("/authorStats/followerCount")).max(i64_of(detail.pointer("/author/followerCount"))),
            "following": i64_of(detail.pointer("/authorStats/followingCount")).max(i64_of(detail.pointer("/author/followingCount"))),
            "likes": i64_of(detail.pointer("/authorStats/heartCount")).max(i64_of(detail.pointer("/author/heartCount"))),
            "videoCount": i64_of(detail.pointer("/authorStats/videoCount")).max(i64_of(detail.pointer("/author/videoCount")))
        },
        "downloads": {
            "nowm": nowm,
            "wm": wm,
            "music": detail.pointer("/music/playUrl").cloned().unwrap_or(Value::Null),
            "photos": photos
        },
        "_photo_objects": photo_objs
    })
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi"
        }))).into_response(),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal memproses data TikTok: {e}")
        }))).into_response(),
    };

    let html = match client.get(&url).send().await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": format!("Gagal memproses data TikTok: {e}")
        }))).into_response(),
    };

    let detail = match extract_item_struct(&html) {
        Some(d) => d,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": "Gagal mengekstrak data dari HTML TikTok"
        }))).into_response(),
    };

    let is_image = detail.get("imagePost").is_some();
    let mut direct_url: Option<String> = None;
    if !is_image {
        if let Some(id) = detail.get("id").and_then(|i| i.as_str()) {
            direct_url = fetch_player_api(&client, id).await;
        }
    }

    let mut result = build_result(&detail, direct_url);
    if let Some(o) = result.as_object_mut() {
        o.remove("_photo_objects");
    }

    Json(json!({ "status": true, "result": result })).into_response()
}

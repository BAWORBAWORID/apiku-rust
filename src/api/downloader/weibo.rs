// Weibo Downloader — native conversion of api/downloader/weibo.js
// Modes: home (containerid=102803 feed), search, detail (statuses/show).
// Cookie dari env WEIBO_COOKIE jika tersedia, fallback hardcoded (bisa expired).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const WEIBO_COOKIE: &str = "SUB=_2AkMdOOs0f8NxqwFRnPEVyW3lZYV_zgDEieKrZBrvJRM3HRl-yT9xqm0mtRB6NrjF2ws6784K5UaFsG-d2l6wRLIjfKfI; SUBP=0033WrSXqPxfM72-Ws9jqgMF55529P9D9WWVYhi7Cl_K6n9h5dsHPg6m; MLOGIN=0; _T_WM=76852741608; XSRF-TOKEN=a84336";

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    let cookie = std::env::var("WEIBO_COOKIE").unwrap_or_else(|_| WEIBO_COOKIE.to_string());
    h.insert("User-Agent", mk("Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15"));
    h.insert("Referer", mk("https://m.weibo.cn/"));
    h.insert("Cookie", mk(&cookie));
    h.insert("X-Requested-With", mk("XMLHttpRequest"));
    h.insert("Accept", mk("application/json, text/plain, */*"));
    h
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(c);
        }
    }
    out.trim().to_string()
}

fn extract_post_id(input: &str) -> Option<String> {
    let id = input.trim();
    if id.starts_with("http") {
        for marker in ["m.weibo.cn/detail/", "m.weibo.cn/status/"] {
            if let Some(i) = id.find(marker) {
                let rest = &id[i + marker.len()..];
                let d: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !d.is_empty() {
                    return Some(d);
                }
            }
        }
        // weibo.com/<digits>/<id>
        if let Some(i) = id.find("weibo.com/") {
            let rest = &id[i + 10..];
            let parts: Vec<&str> = rest.split('/').collect();
            if parts.len() >= 2 {
                let cand: String = parts[1].chars().take_while(|c| c.is_ascii_digit()).collect();
                if !cand.is_empty() {
                    return Some(cand);
                }
            }
        }
        return None;
    }
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        return Some(id.to_string());
    }
    None
}

fn geti(v: &Value, path: &[&str]) -> Value {
    let mut cur = v;
    for p in path {
        cur = match cur.get(p) {
            Some(n) => n,
            None => return Value::Null,
        };
    }
    cur.clone()
}

fn map_mblog(card: &Value) -> Value {
    let mblog = card.get("mblog").cloned().unwrap_or(Value::Null);
    let has_media = mblog.get("page_info").map(|p| !p.is_null()).unwrap_or(false)
        || mblog.get("pics").and_then(|p| p.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
    let media_source = if has_media { mblog.clone() } else { mblog.get("retweeted_status").cloned().unwrap_or(mblog.clone()) };

    let text_content = strip_tags(mblog.get("text").and_then(|t| t.as_str()).unwrap_or(""));
    let raw_mp4 = media_source
        .pointer("/page_info/media_info/stream_url_hd")
        .or_else(|| media_source.pointer("/page_info/media_info/stream_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let cover = media_source.pointer("/page_info/page_pic/url").and_then(|v| v.as_str()).map(|s| s.to_string());
    let duration_raw = media_source.pointer("/page_info/media_info/duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let images: Vec<String> = media_source
        .get("pics")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|p| p.pointer("/large/url").or_else(|| p.get("url")).and_then(|u| u.as_str()).map(|s| s.to_string()))
        .collect();

    let mtype = if raw_mp4.is_some() { "video" } else if !images.is_empty() { "image" } else { "none" };
    let duration_str = if duration_raw > 0.0 {
        format!("{}m {}s", (duration_raw / 60.0) as u64, (duration_raw % 60.0) as u64)
    } else {
        "-".to_string()
    };

    json!({
        "id": mblog.get("id").cloned().unwrap_or(card.get("itemid").cloned().unwrap_or(Value::Null)),
        "author": {
            "name": mblog.pointer("/user/screen_name").cloned().unwrap_or(json!("Unknown")),
            "followers": mblog.pointer("/user/followers_count_str").cloned().unwrap_or(json!("0")),
            "verified_reason": mblog.pointer("/user/verified_reason").cloned().unwrap_or(Value::Null)
        },
        "created_at": mblog.get("created_at").cloned().unwrap_or(Value::Null),
        "location": mblog.get("region_name").and_then(|r| r.as_str()).map(|s| json!(s.replace("发布于 ", ""))).unwrap_or(Value::Null),
        "device": mblog.get("source").cloned().unwrap_or(json!("Web")),
        "stats": {
            "likes": mblog.get("attitudes_count").cloned().unwrap_or(json!(0)),
            "comments": mblog.get("comments_count").cloned().unwrap_or(json!(0)),
            "reposts": mblog.get("reposts_count").cloned().unwrap_or(json!(0))
        },
        "content": { "text": text_content, "is_repost": mblog.get("retweeted_status").map(|r| !r.is_null()).unwrap_or(false) },
        "media": {
            "type": mtype,
            "video": raw_mp4.map(|u| json!({
                "views": media_source.pointer("/page_info/play_count").cloned().unwrap_or(json!(0)),
                "duration_seconds": duration_raw,
                "duration_str": duration_str,
                "cover_url": cover,
                "mp4_url": u,
                "original_page": media_source.pointer("/page_info/page_url").cloned().unwrap_or(Value::Null)
            })).unwrap_or(Value::Null),
            "images": images
        },
        "original_post_url": card.get("scheme").cloned().unwrap_or(Value::Null)
    })
}

async fn fetch_feed(client: &reqwest::Client, mode: &str, keyword: &str, since_id: &str, page: u32) -> Result<Value, String> {
    let target = match mode {
        "home" => {
            let mut u = "https://m.weibo.cn/api/container/getIndex?containerid=102803&openApp=0".to_string();
            if !since_id.is_empty() && since_id != "0" {
                u.push_str(&format!("&since_id={since_id}"));
            }
            u
        }
        _ => format!(
            "https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D{}&page_type=searchall&page={page}",
            urlencoding::encode(keyword)
        ),
    };
    let resp = client.get(&target).headers(base_headers()).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.unwrap_or_default();
    let j: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    if j.get("ok").and_then(|o| o.as_i64()) == Some(-100) {
        return Err("COOKIE EXPIRED — ambil cookie baru dari browser dan set WEIBO_COOKIE".into());
    }
    if j.get("ok").and_then(|o| o.as_i64()) != Some(1) {
        return Err(format!("Weibo API error: {}", j.get("msg").and_then(|m| m.as_str()).unwrap_or("Unknown")));
    }

    let cards = j.pointer("/data/cards").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let mut parsed: Vec<Value> = Vec::new();
    for c in cards {
        if c.get("mblog").map(|m| !m.is_null()).unwrap_or(false) {
            parsed.push(c);
        } else if let Some(groups) = c.get("card_group").and_then(|g| g.as_array()) {
            for cg in groups {
                if cg.get("mblog").map(|m| !m.is_null()).unwrap_or(false) {
                    parsed.push(cg.clone());
                }
            }
        }
    }
    parsed.truncate(20);

    let results: Vec<Value> = parsed.iter().map(|c| map_mblog(c)).collect();
    let next = if mode == "home" {
        j.pointer("/data/cardlistInfo/since_id").cloned().unwrap_or(json!(0))
    } else {
        Value::Null
    };

    Ok(json!({ "count": results.len(), "next_page_token": next, "data": results }))
}

async fn fetch_detail(client: &reqwest::Client, post_id: &str) -> Result<Value, String> {
    let resp = client
        .get(format!("https://m.weibo.cn/statuses/show?id={post_id}"))
        .headers(base_headers())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = resp.text().await.unwrap_or_default();
    let j: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if j.get("ok").and_then(|o| o.as_i64()) != Some(1) || j.get("data").map(|d| d.is_null()).unwrap_or(true) {
        return Err(format!("Failed to fetch post: {}", j.get("msg").and_then(|m| m.as_str()).unwrap_or("Post not found")));
    }
    let m = j.get("data").cloned().unwrap_or(Value::Null);
    let text_content = strip_tags(m.get("text").and_then(|t| t.as_str()).unwrap_or(""));
    let raw_mp4 = m.pointer("/page_info/media_info/stream_url_hd")
        .or_else(|| m.pointer("/page_info/media_info/stream_url"))
        .and_then(|v| v.as_str()).map(|s| s.to_string());
    let duration_raw = m.pointer("/page_info/media_info/duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let images: Vec<String> = m.get("pics").and_then(|p| p.as_array()).cloned().unwrap_or_default().iter()
        .filter_map(|p| p.pointer("/large/url").or_else(|| p.get("url")).and_then(|u| u.as_str()).map(|s| s.to_string()))
        .collect();
    let mtype = if raw_mp4.is_some() { "video" } else if !images.is_empty() { "image" } else { "none" };
    let duration_str = if duration_raw > 0.0 {
        format!("{}m {}s", (duration_raw / 60.0) as u64, (duration_raw % 60.0) as u64)
    } else {
        "-".to_string()
    };

    Ok(json!({
        "id": m.get("id"),
        "author": {
            "name": m.pointer("/user/screen_name").cloned().unwrap_or(json!("Unknown")),
            "id": m.pointer("/user/id").cloned().unwrap_or(Value::Null),
            "avatar": m.pointer("/user/avatar_hd").or_else(|| m.pointer("/user/profile_image_url")).cloned().unwrap_or(Value::Null),
            "followers": m.pointer("/user/followers_count_str").cloned().unwrap_or(json!("0")),
            "verified_reason": m.pointer("/user/verified_reason").cloned().unwrap_or(Value::Null),
            "description": m.pointer("/user/description").cloned().unwrap_or(Value::Null)
        },
        "created_at": m.get("created_at"),
        "location": m.get("region_name").and_then(|r| r.as_str()).map(|s| json!(s.replace("发布于 ", ""))).unwrap_or(Value::Null),
        "device": m.get("source").cloned().unwrap_or(json!("Web")),
        "stats": {
            "likes": m.get("attitudes_count").cloned().unwrap_or(json!(0)),
            "comments": m.get("comments_count").cloned().unwrap_or(json!(0)),
            "reposts": m.get("reposts_count").cloned().unwrap_or(json!(0))
        },
        "content": { "text": text_content, "is_repost": m.get("retweeted_status").map(|r| !r.is_null()).unwrap_or(false) },
        "media": {
            "type": mtype,
            "video": raw_mp4.map(|u| json!({
                "views": m.pointer("/page_info/play_count").cloned().unwrap_or(json!(0)),
                "duration_seconds": duration_raw,
                "duration_str": duration_str,
                "cover_url": m.pointer("/page_info/page_pic/url").cloned().unwrap_or(Value::Null),
                "mp4_url": u,
                "mp4_720p": m.pointer("/page_info/urls/mp4_720p_mp4").cloned().unwrap_or(Value::Null),
                "mp4_hd": m.pointer("/page_info/urls/mp4_hd_mp4").cloned().unwrap_or(Value::Null),
                "mp4_ld": m.pointer("/page_info/urls/mp4_ld_mp4").cloned().unwrap_or(Value::Null),
                "original_page": m.pointer("/page_info/page_url").cloned().unwrap_or(Value::Null)
            })).unwrap_or(Value::Null),
            "images": images
        },
        "original_post_url": format!("https://m.weibo.cn/detail/{}", m.get("id").and_then(|i| i.as_str()).unwrap_or(post_id))
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["mode", "id", "url", "keyword", "since_id", "page"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let s = |k: &str| merged.get(k).map(|v| v.to_string()).unwrap_or_default();
    let mode = s("mode");
    if !["home", "search", "detail"].contains(&mode.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'mode' wajib diisi: home, search, atau detail"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let result = match mode.as_str() {
        "detail" => {
            let input_id = {
                let id = s("id");
                let url = s("url");
                if !id.is_empty() { id } else if !url.is_empty() { url } else { String::new() }
            };
            if input_id.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'id' atau 'url' wajib diisi untuk mode detail"
                }))).into_response();
            }
            match extract_post_id(&input_id) {
                Some(pid) => fetch_detail(&client, &pid).await.map(|r| json!({ "data": r })),
                None => return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false,
                    "message": "ID/URL Weibo tidak valid. Gunakan ID numerik, atau URL: https://m.weibo.cn/detail/{id} / https://weibo.com/{user}/{id}"
                }))).into_response(),
            }
        }
        "search" => {
            let kw = s("keyword");
            if kw.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter 'keyword' wajib diisi untuk mode search"
                }))).into_response();
            }
            let page: u32 = s("page").parse().unwrap_or(1);
            fetch_feed(&client, "search", &kw, "", page).await
        }
        _ => fetch_feed(&client, "home", "", &s("since_id"), 1).await,
    };

    match result {
        Ok(r) => Json(json!({ "status": true, "result": r })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e }))).into_response(),
    }
}

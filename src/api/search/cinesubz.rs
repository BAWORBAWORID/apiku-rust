// CineSubz — native conversion of api/search/cinesubz.js
// Scraper cinesubz.net: q=search, url=detail, action=dl ambil link download langsung.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
const BASE: &str = "https://cinesubz.net";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

async fn get_html(c: &reqwest::Client, url: &str) -> Result<String, String> {
    c.get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

fn decode_entities(s: &str) -> String {
    let re = regex::Regex::new(r"&#(\d+);").unwrap();
    let replaced = re.replace_all(s, |c: &regex::Captures| {
        char::from_u32(c[1].parse().unwrap_or(0)).map(|ch| ch.to_string()).unwrap_or_default()
    });
    replaced.replace("&amp;", "&")
}

async fn search(c: &reqwest::Client, q: &str) -> Result<Vec<Value>, String> {
    let html = get_html(c, &format!("{}/?s={}", BASE, urlencoding::encode(q))).await?;
    let re = regex::Regex::new(
        r#"<div id="item-\d+" class="display-item">[\s\S]*?<a href="([^"]+)" data-url="[^"]+" data-ptype="([^"]+)" title="[^"]+">[\s\S]*?<img[^>]*data-original="([^"]+)"[\s\S]*?imdb-score">([^<]+)<[\s\S]*?badge-(?:quality|episode|season)-corner">([^<]+)<[\s\S]*?<h3>([^<]+)</h3>"#,
    )
    .map_err(|e| e.to_string())?;
    Ok(re
        .captures_iter(&html)
        .map(|m| {
            json!({
                "title": decode_entities(m.get(6).map(|g| g.as_str()).unwrap_or("")),
                "url": m.get(1).map(|g| g.as_str()).unwrap_or(""),
                "type": m.get(2).map(|g| g.as_str()).unwrap_or(""),
                "poster": m.get(3).map(|g| g.as_str()).unwrap_or(""),
                "imdb": m.get(4).map(|g| g.as_str().trim()).unwrap_or(""),
                "badge": m.get(5).map(|g| g.as_str().trim()).unwrap_or(""),
            })
        })
        .collect())
}

async fn detail(c: &reqwest::Client, url: &str) -> Result<Value, String> {
    let html = get_html(c, url).await?;
    let title = regex::Regex::new(r"<title>([^<]+)</title>")
        .map_err(|e| e.to_string())?
        .captures(&html)
        .and_then(|m| m.get(1))
        .map(|g| g.as_str().to_string())
        .unwrap_or_default()
        .split(" | සිංහල")
        .next()
        .unwrap_or("")
        .to_string();

    let re_dl = regex::Regex::new(
        r#"href='([^']+)'[^>]*class='(?:movie-)?download-button'[^>]*>[\s\S]*?(?:movie-)?download-meta'>([^<]+)<"#,
    )
    .map_err(|e| e.to_string())?;
    let downloads: Vec<Value> = re_dl
        .captures_iter(&html)
        .map(|m| {
            json!({
                "api": m.get(1).map(|g| g.as_str()).unwrap_or(""),
                "meta": m.get(2).map(|g| g.as_str().trim()).unwrap_or(""),
            })
        })
        .collect();

    let re_ep = regex::Regex::new(
        r#"class='episode-link' href='([^']+)' data-pid='\d+' data-season='(\d+)' data-episode='(\d+)'>[\s\S]*?ep-title'>([^<]+)<[\s\S]*?ep-date'>([^<]+)<"#,
    )
    .map_err(|e| e.to_string())?;
    let episodes: Vec<Value> = re_ep
        .captures_iter(&html)
        .map(|m| {
            json!({
                "url": m.get(1).map(|g| g.as_str()).unwrap_or(""),
                "season": m.get(2).and_then(|g| g.as_str().parse::<i64>().ok()).unwrap_or(0),
                "episode": m.get(3).and_then(|g| g.as_str().parse::<i64>().ok()).unwrap_or(0),
                "title": decode_entities(m.get(4).map(|g| g.as_str()).unwrap_or("")),
                "date": m.get(5).map(|g| g.as_str()).unwrap_or(""),
            })
        })
        .collect();

    Ok(json!({"title": title, "downloads": downloads, "episodes": episodes}))
}

async fn dl(c: &reqwest::Client, url: &str) -> Result<String, String> {
    let html = get_html(c, url).await?;
    let re = regex::Regex::new(r#"href="(https?://[^"]*/server\d+/[^"]+)""#).map_err(|e| e.to_string())?;
    re.captures(&html)
        .and_then(|m| m.get(1))
        .map(|g| g.as_str().to_string())
        .ok_or_else(|| "direct link not found".to_string())
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

    let q = get_param("q").map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let url = get_param("url").map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let action = get_param("action").unwrap_or_default();

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    if let Some(q) = q {
        return match search(&c, &q).await {
            Ok(found) => Json(json!({
                "status": true,
                "result": {"type": "search", "query": q, "total": found.len(), "items": found}
            }))
            .into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    if let Some(url) = url {
        if action.to_lowercase() == "dl" {
            let mut info = detail(&c, &url).await.ok();
            let api_url = info
                .as_ref()
                .and_then(|v| v.pointer("/downloads/0/api").and_then(Value::as_str).map(str::to_string))
                .or_else(|| {
                    let ep = info
                        .as_ref()
                        .and_then(|v| v.pointer("/episodes/0/url").and_then(Value::as_str).map(str::to_string))?;
                    tokio::task::block_in_place(|| {
                        tokio::runtime::Handle::current().block_on(async { detail(&c, &ep).await })
                    })
                    .ok()
                    .and_then(|v| v.pointer("/downloads/0/api").and_then(Value::as_str).map(str::to_string))
                });
            let api_url = match api_url {
                Some(u) => u,
                None => return err(StatusCode::INTERNAL_SERVER_ERROR, "download tidak ditemukan"),
            };
            return match dl(&c, &api_url).await {
                Ok(direct) => Json(json!({"status": true, "result": {"type": "download", "direct": direct}})).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
            };
        }
        return match detail(&c, &url).await {
            Ok(mut info) => {
                let mut obj = json!({"type": "detail"});
                if let (Some(dst), Some(src)) = (obj.as_object_mut(), info.as_object_mut()) {
                    dst.extend(src.iter().map(|(k, v)| (k.clone(), v.clone())));
                }
                Json(json!({"status": true, "result": obj})).into_response()
            }
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    err(StatusCode::BAD_REQUEST, "Isi parameter 'q' (search) atau 'url' (detail/download)")
}

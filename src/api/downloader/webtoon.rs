// Webtoon Downloader — native conversion of api/downloader/webtoon.js
// action=search: HTML scraping webtoons.com (native). action=download: episode
// images → PDF (pdfkit di Node) — PDF assembly belum didukung native, error jujur.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const HEADERS_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

fn attr_of<'a>(html: &'a str, tag_pos: usize, attr: &str) -> String {
    let seg = &html[tag_pos..];
    let pat = format!("{attr}=\"");
    match seg.find(&pat) {
        Some(j) => seg[j + pat.len()..].split('"').next().unwrap_or("").to_string(),
        None => String::new(),
    }
}

fn text_after(html: &str, marker: &str) -> String {
    match html.find(marker) {
        Some(i) => {
            let rest = &html[i + marker.len()..];
            match rest.find('>') {
                Some(j) => {
                    let r2 = &rest[j + 1..];
                    r2.split('<').next().unwrap_or("").trim().to_string()
                }
                None => String::new(),
            }
        }
        None => String::new(),
    }
}

async fn search_webtoon(client: &reqwest::Client, query: &str) -> Result<Value, String> {
    let url = format!("https://www.webtoons.com/id/search?keyword={}", urlencoding::encode(query));
    let resp = client
        .get(&url)
        .header("User-Agent", HEADERS_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data = resp.text().await.unwrap_or_default();

    // .card_lst li a, .webtoon_list li a, .search_result li a — first href
    let mut link = String::new();
    for sel in ["card_lst", "webtoon_list", "search_result"] {
        if let Some(i) = data.find(sel) {
            let seg = &data[i..];
            if let Some(a) = seg.find("<a ") {
                let href = attr_of(seg, a, "href");
                if !href.is_empty() {
                    link = href;
                    break;
                }
            }
        }
    }
    if link.is_empty() {
        return Err(format!("Komik \"{query}\" tidak ditemukan."));
    }
    let detail_url = if link.starts_with("http") { link } else { format!("https://www.webtoons.com{link}") };

    let resp2 = client
        .get(&detail_url)
        .header("User-Agent", HEADERS_UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let detail = resp2.text().await.unwrap_or_default();

    // episodes: #_episodeList li / .detail_lst li — <a href> + .subj
    let mut episodes: Vec<Value> = Vec::new();
    {
        let seg_start = detail.find("_episodeList").or_else(|| detail.find("detail_lst"));
        if let Some(s) = seg_start {
            let seg = &detail[s..];
            let end = seg.find("</ul>").unwrap_or(seg.len().min(200_000));
            let scope = &seg[..end];
            let mut idx = 0usize;
            let mut rest = scope;
            while let Some(li) = rest.find("<li") {
                let chunk_end = rest[li..].find("</li>").map(|e| li + e + 5).unwrap_or(rest.len());
                let li_html = &rest[li..chunk_end];
                if let Some(a) = li_html.find("<a ") {
                    let mut href = attr_of(li_html, a, "href");
                    if !href.is_empty() {
                        if !href.starts_with("http") {
                            href = format!("https://www.webtoons.com{href}");
                        }
                        idx += 1;
                        let title = {
                            let mut t = text_after(li_html, "subj");
                            if t.is_empty() {
                                t = format!("Episode {idx}");
                            }
                            t
                        };
                        episodes.push(json!({ "index": idx, "title": title, "url": href }));
                    }
                }
                rest = &rest[chunk_end.min(rest.len())..];
            }
            episodes.reverse();
        }
    }

    let mut title = text_after(&detail, "info");
    // crude: subject inside info block
    if title.is_empty() {
        title = String::new();
    }
    let meta_title = match detail.find("property=\"og:title\"") {
        Some(i) => {
            let content = attr_of(&detail, i, "content");
            content.split('|').next().unwrap_or("").trim().to_string()
        }
        None => String::new(),
    };
    if title.is_empty() {
        title = meta_title;
    }
    let author = {
        let a = text_after(&detail, "author");
        if a.is_empty() { "Unknown".to_string() } else { a }
    };
    let synopsis = {
        let s = text_after(&detail, "summary");
        if s.is_empty() {
            match detail.find("property=\"og:description\"") {
                Some(i) => attr_of(&detail, i, "content"),
                None => String::new(),
            }
        } else {
            s
        }
    };

    Ok(json!({
        "title": title,
        "author": author,
        "synopsis": synopsis,
        "link": detail_url,
        "episodes": episodes
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["query", "action", "episode"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let q = merged.get("query").map(|s| s.trim().to_string()).unwrap_or_default();
    if q.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'query' wajib diisi"
        }))).into_response();
    }
    let action = merged.get("action").cloned().unwrap_or_default();

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    match search_webtoon(&client, &q).await {
        Ok(webtoon) => {
            if action == "download" {
                let ep: u64 = merged.get("episode").and_then(|e| e.parse().ok()).unwrap_or(0);
                if ep < 1 {
                    return (StatusCode::BAD_REQUEST, Json(json!({
                        "status": false, "message": "Parameter 'episode' wajib diisi (angka positif)"
                    }))).into_response();
                }
                (StatusCode::NOT_IMPLEMENTED, Json(json!({
                    "status": false,
                    "message": "Download episode ke PDF butuh PDF writer engine — belum didukung native.",
                    "webtoon": webtoon.get("title"),
                    "episode": ep
                })))
                .into_response()
            } else {
                Json(json!({
                    "status": true,
                    "result": webtoon,
                    "timestamp": chrono::Utc::now().timestamp_millis()
                }))
                .into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e
        }))).into_response(),
    }
}

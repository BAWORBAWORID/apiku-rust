use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/// Merge query params + JSON body params (mirrors `{ ...req.query, ...req.body }`).
fn param(query: &HashMap<String, String>, body: &Option<Json<Value>>, key: &str) -> Option<String> {
    if let Some(v) = query.get(key) {
        if !v.trim().is_empty() {
            return Some(v.clone());
        }
    }
    if let Some(Json(b)) = body {
        if let Some(s) = b.get(key).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("client error: {e}"))
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": message}))).into_response()
}

fn server_error(message: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": message}))).into_response()
}


// Webtoon Search — native conversion of api/search/webtoon.js
// Cari komik di webtoons.com (id) lalu scrape halaman detailnya.
const WT_HEADERS: &[(&str, &str)] = &[
    ("Referer", "https://www.webtoons.com"),
];

async fn fetch_html(c: &reqwest::Client, url: &str) -> Result<String, String> {
    let mut req = c.get(url);
    for (k, v) in WT_HEADERS {
        req = req.header(*k, *v);
    }
    let r = req.send().await.map_err(|e| format!("request error: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    r.text().await.map_err(|e| format!("read error: {e}"))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    let q = match query.get("query") {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => {
            return bad_request("Parameter 'query' wajib diisi");
        }
    };

    let c = match client(30) {
        Ok(c) => c,
        Err(e) => return server_error(&e),
    };

    let search_url = format!(
        "https://www.webtoons.com/id/search?keyword={}",
        urlencoding::encode(&q)
    );
    let search_html = match fetch_html(&c, &search_url).await {
        Ok(h) => h,
        Err(e) => return server_error(&format!("Gagal mencari Webtoon: {e}")),
    };
    let link = {
        let doc = scraper::Html::parse_document(&search_html);
        let link_sel = scraper::Selector::parse(".card_lst li a, .webtoon_list li a, .search_result li a").unwrap();
        match doc.select(&link_sel).next().and_then(|a| a.value().attr("href")) {
            Some(l) => l.to_string(),
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({
                        "status": false,
                        "message": format!("Komik \"{}\" tidak ditemukan.", q),
                        "timestamp": now_ms(),
                    })),
                )
                    .into_response()
            }
        }
    };
    let detail_url = if link.starts_with("http") {
        link
    } else {
        format!("https://www.webtoons.com{}", link)
    };

    let detail_html = match fetch_html(&c, &detail_url).await {
        Ok(h) => h,
        Err(e) => return server_error(&format!("Gagal memuat detail Webtoon: {e}")),
    };
    let d = scraper::Html::parse_document(&detail_html);

    let text_first = |sel: &scraper::Selector| -> String {
        d.select(sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default()
    };
    let meta_content = |prop: &str| -> Option<String> {
        let sel = scraper::Selector::parse(&format!("meta[property=\"{}\"]", prop)).ok()?;
        d.select(&sel)
            .next()
            .and_then(|m| m.value().attr("content"))
            .map(|s| s.to_string())
    };

    let title = {
        let sel = scraper::Selector::parse(".info .subj").unwrap();
        let t = text_first(&sel);
        if t.is_empty() {
            meta_content("og:title")
                .map(|m| m.split('|').next().unwrap_or("").trim().to_string())
                .unwrap_or_default()
        } else {
            t
        }
    };
    let author = {
        let sel = scraper::Selector::parse(".info .author").unwrap();
        let a = text_first(&sel);
        if a.is_empty() { "Unknown".to_string() } else { a }
    };
    let synopsis = {
        let sel = scraper::Selector::parse(".summary").unwrap();
        let s = text_first(&sel);
        if s.is_empty() {
            meta_content("og:description").unwrap_or_default()
        } else {
            s
        }
    };

    let ep_sel = scraper::Selector::parse("#_episodeList li, .detail_lst li").unwrap();
    let subj_sel = scraper::Selector::parse(".subj span, .subj").unwrap();
    let a_sel = scraper::Selector::parse("a").unwrap();
    let mut episodes: Vec<Value> = Vec::new();
    for (i, el) in d.select(&ep_sel).enumerate() {
        let title = {
            let t = el
                .select(&subj_sel)
                .next()
                .map(|s| s.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            if t.is_empty() {
                format!("Episode {}", i + 1)
            } else {
                t
            }
        };
        let url = el
            .select(&a_sel)
            .next()
            .and_then(|a| a.value().attr("href"))
            .map(|h| {
                if h.starts_with("http") {
                    h.to_string()
                } else {
                    format!("https://www.webtoons.com{}", h)
                }
            })
            .unwrap_or_default();
        episodes.push(json!({"index": i + 1, "title": title, "url": url}));
    }
    episodes.reverse();

    // synopsis truncated to 500 chars like Node substring(0, 500)
    let synopsis_short: String = synopsis.chars().take(500).collect();

    Json(json!({
        "status": true,
        "result": {
            "title": title,
            "author": author,
            "synopsis": synopsis_short,
            "link": detail_url,
            "total_episodes": episodes.len(),
            "episodes": episodes.iter().map(|e| json!({"index": e["index"], "title": e["title"]})).collect::<Vec<_>>(),
        },
        "timestamp": now_ms(),
    })).into_response()

}

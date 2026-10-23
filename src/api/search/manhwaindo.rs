// Manhwaindo Detail — native conversion of api/search/manhwaindo.js
// Scraping detail manhwa dari manhwaindo.my berdasarkan slug.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://www.manhwaindo.my";
const UA: &str = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let search_query = match query
        .get("query")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("query").and_then(Value::as_str).map(str::to_string)))
    {
        Some(q) if !q.trim().is_empty() => q,
        _ => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };

    let slug: String = search_query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let url = format!("{}/series/{}/", BASE_URL, slug);

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let res = client
        .get(&url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await;

    let html = match res {
        Ok(r) if r.status().as_u16() == 404 => return err(StatusCode::INTERNAL_SERVER_ERROR, "Manhwa tidak ditemukan"),
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        },
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let document = scraper::Html::parse_document(&html);
    let text_of = |sel_text: &str| -> String {
        scraper::Selector::parse(sel_text)
            .map(|sel| {
                document
                    .select(&sel)
                    .next()
                    .map(|el| el.text().collect::<String>().trim().to_string())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    };

    let not_found = "Tidak ditemukan".to_string();
    let title = {
        let t = text_of("h1.entry-title[itemprop=\"name\"]");
        if t.is_empty() { not_found.clone() } else { t }
    };
    let alternative = {
        let t = text_of("span.alternative");
        if t.is_empty() { not_found.clone() } else { t }
    };

    let info_text = {
        let mut t = String::new();
        for sel in [".info-content", ".infox", ".spe"] {
            if let Ok(s) = scraper::Selector::parse(sel) {
                for el in document.select(&s) {
                    t.push_str(&el.text().collect::<String>());
                }
            }
        }
        t
    };
    let status = {
        let mut found = String::new();
        if let Some(pos) = info_text.find("Status") {
            let rest = info_text[pos + 6..].trim_start();
            if let Some(line_end) = rest.find('\n') {
                found = rest[..line_end].trim().to_string();
            } else {
                found = rest.trim().to_string();
            }
        }
        if found.is_empty() { not_found.clone() } else { found }
    };

    let m_type = {
        let t = text_of("a[rel=\"tag\"][href*=\"genres\"]");
        if !t.is_empty() {
            t
        } else {
            let t2 = scraper::Selector::parse(".infox a")
                .ok()
                .and_then(|sel| document.select(&sel).next().map(|el| el.text().collect::<String>().trim().to_string()))
                .unwrap_or_default();
            if t2.is_empty() { not_found.clone() } else { t2 }
        }
    };

    let author = {
        let t = text_of("i[itemprop=\"name\"]");
        if t.is_empty() { not_found.clone() } else { t }
    };

    let (posted_on, updated_on) = {
        let times: Vec<String> = scraper::Selector::parse("time")
            .map(|sel| document.select(&sel).map(|el| el.text().collect::<String>().trim().to_string()).collect())
            .unwrap_or_default();
        if times.is_empty() {
            (not_found.clone(), not_found.clone())
        } else {
            (times[0].clone(), times.last().cloned().unwrap_or(not_found.clone()))
        }
    };

    let rating = {
        let from_attr = scraper::Selector::parse("div[itemprop=\"ratingValue\"], .num[content]")
            .ok()
            .and_then(|sel| {
                document.select(&sel).next().and_then(|el| {
                    el.value()
                        .attr("content")
                        .map(str::to_string)
                        .or_else(|| Some(el.text().collect::<String>().trim().to_string()))
                })
            })
            .unwrap_or_default();
        if from_attr.is_empty() { not_found.clone() } else { from_attr }
    };

    let genres: Vec<String> = scraper::Selector::parse("span.mgen a[rel=\"tag\"]")
        .map(|sel| {
            let mut g: Vec<String> = document
                .select(&sel)
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if g.is_empty() {
                if let Ok(sel2) = scraper::Selector::parse(".genres a, .genre a") {
                    g = document
                        .select(&sel2)
                        .map(|el| el.text().collect::<String>().trim().to_string())
                        .collect();
                }
            }
            g
        })
        .unwrap_or_default();

    let synopsis = {
        let s = scraper::Selector::parse("div.entry-content-single[itemprop=\"description\"], div.entry-content")
            .ok()
            .and_then(|sel| {
                document.select(&sel).next().map(|el| {
                    el.text()
                        .collect::<String>()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                })
            })
            .unwrap_or_default();
        if s.is_empty() { not_found.clone() } else { s }
    };

    let thumbnail = scraper::Selector::parse("img[post-id], .thumb img, .series-thumb img, img[itemprop=\"image\"]")
        .ok()
        .and_then(|sel| document.select(&sel).next().and_then(|el| el.value().attr("src").map(str::to_string)))
        .unwrap_or(not_found.clone());

    Json(json!({
        "status": true,
        "result": {
            "title": title,
            "alternative": alternative,
            "status": status,
            "type": m_type,
            "author": author,
            "posted_on": posted_on,
            "updated_on": updated_on,
            "rating": rating,
            "genres": genres,
            "synopsis": synopsis,
            "thumbnail": thumbnail,
            "url": url,
        }
    })).into_response()
}

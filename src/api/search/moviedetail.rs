// Movie Detail (TMDB) — native conversion of api/search/moviedetail.js
// Scraping halaman themoviedb.org: poster, user score, overview, cast, top contributors.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const HEADERS_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let url = query
        .get("url")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("url").and_then(Value::as_str).map(str::to_string)));

    let url = match url {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return err(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };

    if !url.contains("themoviedb.org") {
        return err(StatusCode::BAD_REQUEST, "URL harus dari themoviedb.org");
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(HEADERS_UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mengambil detail film: {e}")),
    };

    let html = match client
        .get(&url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mengambil detail film: {e}")),
        },
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mengambil detail film: {e}")),
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
    let attr_of = |sel_text: &str, attr: &str| -> String {
        scraper::Selector::parse(sel_text)
            .map(|sel| {
                document
                    .select(&sel)
                    .next()
                    .and_then(|el| el.value().attr(attr))
                    .unwrap_or("")
                    .to_string()
            })
            .unwrap_or_default()
    };

    let poster = attr_of(".blurred img.poster", "src");
    let user_score = attr_of(".user_score_chart", "data-percent");
    let description = text_of(".overview p");

    let mut cast: Vec<Value> = Vec::new();
    if let Ok(sel_card) = scraper::Selector::parse(".people.scroller li.card") {
        for card in document.select(&sel_card) {
            let person_url = card
                .select(&scraper::Selector::parse("a").unwrap())
                .next()
                .and_then(|el| el.value().attr("href"))
                .unwrap_or("")
                .to_string();
            let name = card
                .select(&scraper::Selector::parse("p a").unwrap())
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let character = card
                .select(&scraper::Selector::parse(".character").unwrap())
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let episodes = card
                .select(&scraper::Selector::parse(".episode_count").unwrap())
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            if !person_url.is_empty() && !name.is_empty() {
                let full_url = if person_url.starts_with("http") {
                    person_url
                } else {
                    format!("https://www.themoviedb.org{}", person_url)
                };
                cast.push(json!({
                    "name": name,
                    "character": if character.is_empty() { Value::Null } else { json!(character) },
                    "episodes": if episodes.is_empty() { Value::Null } else { json!(episodes) },
                    "url": full_url,
                }));
            }
        }
    }

    let mut top_contributors: Vec<Value> = Vec::new();
    if let Ok(sel_leader) = scraper::Selector::parse(".leaderboard .edit_leader") {
        for leader in document.select(&sel_leader) {
            let contributor_url = leader
                .select(&scraper::Selector::parse("a").unwrap())
                .next()
                .and_then(|el| el.value().attr("href"))
                .unwrap_or("")
                .to_string();
            let contributor_name = leader
                .select(&scraper::Selector::parse(".info a").unwrap())
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();
            let edit_count = leader
                .select(&scraper::Selector::parse(".edit_count").unwrap())
                .next()
                .map(|el| {
                    el.text()
                        .collect::<String>()
                        .lines()
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string()
                })
                .unwrap_or_default();
            let profile_pic = leader
                .select(&scraper::Selector::parse(".avatar img").unwrap())
                .next()
                .and_then(|el| el.value().attr("src"))
                .unwrap_or("")
                .to_string();
            if !contributor_url.is_empty() && !contributor_name.is_empty() {
                let full_url = if contributor_url.starts_with("http") {
                    contributor_url
                } else {
                    format!("https://www.themoviedb.org{}", contributor_url)
                };
                top_contributors.push(json!({
                    "name": contributor_name,
                    "edits": if edit_count.is_empty() { Value::Null } else { json!(edit_count) },
                    "profilePic": if profile_pic.is_empty() { Value::Null } else { json!(profile_pic) },
                    "url": full_url,
                }));
            }
        }
    }

    let mut title = text_of("h2 a");
    if title.is_empty() {
        title = text_of("h1");
    }
    if title.is_empty() {
        title = "Unknown".to_string();
    }

    Json(json!({
        "status": true,
        "result": {
            "title": title,
            "poster": if poster.is_empty() { Value::Null } else { json!(poster) },
            "userScore": if user_score.is_empty() { Value::Null } else { json!(user_score) },
            "description": if description.is_empty() { Value::Null } else { json!(description) },
            "cast": cast,
            "topContributors": top_contributors,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

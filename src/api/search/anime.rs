// Anime Search (LiveChart) — native conversion of api/search/anime.js
// Scraping livechart.me: search -> ambil link /anime/ pertama -> parse detail.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

fn meta(doc: &scraper::Html, sel: &str, attr: &str) -> String {
    scraper::Selector::parse(sel)
        .ok()
        .and_then(|s| doc.select(&s).next())
        .and_then(|el| el.value().attr(attr))
        .unwrap_or("")
        .to_string()
}

fn text_of(doc: &scraper::Html, sel: &str) -> Option<String> {
    scraper::Selector::parse(sel)
        .ok()
        .map(|s| {
            doc.select(&s)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
        })
        .flatten()
}

async fn search_anime(c: &reqwest::Client, query: &str) -> Result<Value, String> {
    let search_url = format!("https://www.livechart.me/search?q={}", urlencoding::encode(query));
    let html = c
        .get(&search_url)
                    .header("Referer", "https://www.livechart.me/")
                    .header("Origin", "https://www.livechart.me")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let anime_url = {
        let doc = scraper::Html::parse_document(&html);
        let mut anime_url = String::new();
        if let Ok(sel_a) = scraper::Selector::parse("a") {
            'outer: for a in doc.select(&sel_a) {
                if let Some(href) = a.value().attr("href") {
                    if href.starts_with("/anime/") && href.split('/').count() == 3 {
                        anime_url = format!("https://www.livechart.me{}", href);
                        break 'outer;
                    }
                }
            }
        }
        anime_url
    };
    if anime_url.is_empty() {
        return Err("Anime tidak ditemukan".into());
    }

    let page_html = c
        .get(&anime_url)
        .header("Referer", &anime_url)
                    .header("Origin", "https://www.livechart.me")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let doc = scraper::Html::parse_document(&page_html);

    let mut title = String::new();
    let mut english_title = String::new();
    let mut japanese_title = String::new();
    let mut image = String::new();
    let mut description = String::new();
    let mut genres: Vec<String> = Vec::new();
    let mut studios: Vec<String> = Vec::new();
    let mut release_date = "Unknown".to_string();
    let mut status = "Unknown".to_string();
    let mut total_episodes = "Unknown".to_string();
    let mut runtime = "Unknown".to_string();
    let mut score = "Unknown".to_string();
    let mut rating_count = "0".to_string();
    let mut season = "Unknown".to_string();
    let mut format = "Unknown".to_string();
    let mut source = "Unknown".to_string();
    let mut latest_episode = "Unknown".to_string();
    let mut website = String::new();
    let mut official_x = String::new();

    if let Ok(sel) = scraper::Selector::parse("script[type=\"application/ld+json\"]") {
        if let Some(script) = doc.select(&sel).next() {
            let txt = script.text().collect::<String>();
            if let Ok(jd) = serde_json::from_str::<Value>(txt.trim()) {
                title = jd.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                if let Some(alt) = jd.get("alternateName").and_then(Value::as_array) {
                    english_title = alt.first().and_then(Value::as_str).unwrap_or("").to_string();
                    japanese_title = alt.get(1).and_then(Value::as_str).unwrap_or("").to_string();
                }
                image = jd.get("image").and_then(Value::as_str).unwrap_or("").to_string();
                description = jd.get("description").and_then(Value::as_str).unwrap_or("").to_string();
                match jd.get("genre") {
                    Some(Value::Array(a)) => genres = a.iter().filter_map(Value::as_str).map(str::to_string).collect(),
                    Some(Value::String(s)) => genres = vec![s.clone()],
                    _ => {}
                }
                if let Some(n) = jd.get("numberOfEpisodes").and_then(Value::as_i64) {
                    total_episodes = n.to_string();
                }
                if let Some(dp) = jd.get("datePublished").and_then(Value::as_str) {
                    // format ISO date ke "Mon D, YYYY"
                    if let Ok(d) = chrono::NaiveDate::parse_from_str(&dp[..10.min(dp.len())], "%Y-%m-%d") {
                        release_date = d.format("%b %-d, %Y").to_string();
                    }
                }
                if let Some(pc) = jd.get("productionCompany").and_then(Value::as_array) {
                    studios = pc.iter().filter_map(|s| s.get("name").and_then(Value::as_str)).map(str::to_string).collect();
                }
                if let Some(ar) = jd.get("aggregateRating") {
                    score = format!("{}/10", ar.get("ratingValue").and_then(Value::as_f64).unwrap_or(0.0));
                    rating_count = ar.get("ratingCount").map(|v| v.to_string().replace('"', "")).unwrap_or_else(|| "0".into());
                }
                if let Some(u) = jd.get("url").and_then(Value::as_str) {
                    let anime_url = anime_url.clone();
                    let _ = anime_url;
                }
            }
        }
    }

    if title.is_empty() {
        title = meta(&doc, "meta[property=\"og:title\"]", "content");
        if title.is_empty() {
            title = text_of(&doc, "title").unwrap_or_default();
        }
    }
    if image.is_empty() {
        image = meta(&doc, "meta[property=\"og:image\"]", "content");
    }
    if description.is_empty() {
        description = meta(&doc, "meta[property=\"og:description\"]", "content");
        if description.is_empty() {
            description = meta(&doc, "meta[name=\"description\"]", "content");
        }
    }

    if genres.is_empty() {
        let blacklist = ["Manga", "Light Novel", "Original", "Web Manga", "Game", "Visual Novel", "Novel"];
        if let Ok(sel) = scraper::Selector::parse("a[href*=\"/tags/\"]") {
            for el in doc.select(&sel) {
                let g = el.text().collect::<String>().trim().to_string();
                if !g.is_empty() && g.len() < 25 && !blacklist.contains(&g.as_str()) {
                    genres.push(g);
                }
            }
        }
    }

    if studios.is_empty() {
        if let Ok(sel) = scraper::Selector::parse("a[href*=\"/studios/\"]") {
            for el in doc.select(&sel) {
                let s = el.text().collect::<String>().trim().to_string();
                if !s.is_empty() {
                    studios.push(s);
                }
            }
        }
    }

    if status == "Unknown" {
        if let (Ok(sel_label), Ok(sel_parent)) = (
            scraper::Selector::parse(".text-sm .font-medium"),
            scraper::Selector::parse(".text-sm"),
        ) {
            for el in doc.select(&sel_label) {
                if el.text().collect::<String>().trim() == "Status" {
                    for parent in doc.select(&sel_parent) {
                        if parent.select(&sel_label).next().is_some() {
                            let st = parent
                                .text()
                                .collect::<String>()
                                .replace("Status", "")
                                .trim()
                                .lines()
                                .next()
                                .unwrap_or("")
                                .trim()
                                .to_string();
                            if !st.is_empty() {
                                status = st;
                            }
                            break;
                        }
                    }
                    break;
                }
            }
        }
    }

    if release_date == "Unknown" {
        let body_text = doc
            .root_element()
            .text()
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let re = regex::Regex::new(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}\b").unwrap();
        if let Some(m) = re.find(&body_text) {
            release_date = m.as_str().to_string();
        }
    }

    if season == "Unknown" {
        if let Ok(sel) = scraper::Selector::parse(
            "a[href*=\"/summer-\"][href*=\"/tv\"],a[href*=\"/winter-\"][href*=\"/tv\"],a[href*=\"/spring-\"][href*=\"/tv\"],a[href*=\"/fall-\"][href*=\"/tv\"]",
        ) {
            if let Some(el) = doc.select(&sel).next() {
                if let Some(href) = el.value().attr("href") {
                    let re = regex::Regex::new(r"/(winter|spring|summer|fall)-(\d{4})").unwrap();
                    if let Some(c) = re.captures(href) {
                        let s = format!("{} {}", &c[1], &c[2]);
                        season = s
                            .split(' ')
                            .map(|w| {
                                let mut cs = w.chars();
                                match cs.next() {
                                    Some(f) => f.to_uppercase().collect::<String>() + cs.as_str(),
                                    None => String::new(),
                                }
                            })
                            .collect::<Vec<_>>()
                            .join(" ");
                    } else {
                        season = el.text().collect::<String>().trim().to_string();
                    }
                }
            }
        }
    }

    if latest_episode == "Unknown" {
        if let Some(t) = text_of(&doc, ".line-clamp-1.text-sm.text-base-content\\/75.link-hover .font-medium") {
            latest_episode = t;
        }
    }

    if format == "Unknown" || source == "Unknown" || runtime == "Unknown" {
        if let (Ok(sel_label), Ok(sel_grid)) = (
            scraper::Selector::parse(".grid.grid-flow-col.auto-cols-fr .text-xs.text-base-content\\/75"),
            scraper::Selector::parse(".grid.grid-flow-col.auto-cols-fr"),
        ) {
            for grid in doc.select(&sel_grid) {
                if let Some(label) = grid.select(&sel_label).next() {
                    let lt = label.text().collect::<String>().trim().to_string();
                    let full = grid.text().collect::<String>().replace(&lt, "").trim().to_string();
                    match lt.as_str() {
                        "Format" if format == "Unknown" => format = full,
                        "Source" if source == "Unknown" && !full.is_empty() => source = full,
                        "Run time" if runtime == "Unknown" && !full.is_empty() => runtime = full,
                        _ => {}
                    }
                }
            }
        }
    }

    if total_episodes == "Unknown" {
        if let Ok(sel) = scraper::Selector::parse("[data-anime-details-target=\"viewerProgress\"]") {
            if let Some(el) = doc.select(&sel).next() {
                let parent_text = el
                    .parent()
                    .and_then(scraper::ElementRef::wrap).map(|p| p.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                let re = regex::Regex::new(r"/(\d+)").unwrap();
                if let Some(c) = re.captures(&parent_text) {
                    total_episodes = c[1].to_string();
                }
            }
        }
    }

    if let Ok(sel) = scraper::Selector::parse(".lc-btn.lc-btn-sm.lc-btn-outline") {
        for el in doc.select(&sel) {
            let href = el.value().attr("href").unwrap_or("");
            let text = el.text().collect::<String>().trim().to_string();
            if text == "Website" && !href.is_empty() {
                website = href.to_string();
            }
            if text == "Official X" && !href.is_empty() {
                official_x = href.to_string();
            }
        }
    }

    let clean_genres: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        genres
            .into_iter()
            .filter(|g| !g.is_empty() && g.len() < 30 && seen.insert(g.clone()))
            .take(10)
            .collect()
    };
    let clean_studios: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        studios.into_iter().filter(|s| seen.insert(s.clone())).collect()
    };

    Ok(json!({
        "title": title,
        "englishTitle": if english_title != title { english_title.clone() } else { String::new() },
        "japaneseTitle": if japanese_title != title && japanese_title != english_title { japanese_title } else { String::new() },
        "image": image,
        "synopsis": if description.is_empty() { "Tidak ada deskripsi".to_string() } else { description },
        "status": status,
        "rating": score,
        "ratingCount": rating_count,
        "format": format,
        "runtime": runtime,
        "source": if source.is_empty() { "Unknown".to_string() } else { source },
        "genres": clean_genres,
        "studios": clean_studios,
        "season": season,
        "releaseDate": release_date,
        "episodes": if latest_episode != "Unknown" { latest_episode } else { "1".to_string() },
        "totalEpisodes": total_episodes,
        "website": if website.is_empty() { Value::Null } else { json!(website) },
        "officialX": if official_x.is_empty() { Value::Null } else { json!(official_x) },
        "url": anime_url,
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let q = match query
        .get("q")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("q").and_then(Value::as_str).map(str::to_string)))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        Some(q) => q,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'q' (judul anime) wajib diisi"),
    };

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    match search_anime(&c, &q).await {
        Ok(result) => Json(json!({"status": true, "result": result, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

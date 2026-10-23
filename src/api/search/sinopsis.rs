// Sinopsis Film — native conversion of api/search/sinopsis.js
// Scrape sinopsisfilm.id: actions home, search, detail (JSON-LD Movie + detail grid).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://sinopsisfilm.id";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Linux; Android 14; V2238) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

async fn get_html(c: &reqwest::Client, url: &str, referer: &str) -> Result<String, u16> {
    let res = c
        .get(url)
        .header("Referer", referer)
        .send()
        .await
        .map_err(|_| 0u16)?;
    let st = res.status().as_u16();
    if !(200..300).contains(&st) {
        return Err(st);
    }
    res.text().await.map_err(|_| 0u16)
}

fn parse_duration(duration: &str) -> Value {
    if duration.is_empty() {
        return Value::Null;
    }
    let re = regex::Regex::new(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$").unwrap();
    if let Some(c) = re.captures(duration) {
        let g = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
        let mut h = g(1);
        let min = g(2);
        let s = g(3);
        if h == 0 && min >= 60 {
            h = min / 60;
        }
        let min2 = if h > 0 { min % 60 } else { min };
        let total_min = (h * 3600 + min2 * 60 + s) / 60;
        return json!({
            "raw": duration,
            "minutes": total_min,
            "hours": h,
            "text": if h > 0 { format!("{}j {}m", h, min2) } else { format!("{}m", min2) },
        });
    }
    json!({"raw": duration})
}

fn parse_meta_line(text: &str) -> (Value, Value, Value, Vec<Value>) {
    // Format: "2021 • Hong Kong • ★ 7.2 • Action" -> (year, country, rating, genres)
    let mut year: Value = Value::Null;
    let mut country: Value = Value::Null;
    let mut rating: Value = Value::Null;
    let mut genres: Vec<Value> = Vec::new();
    for part in text.split('\u{2022}') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        if p.len() == 4 && p.chars().all(|c| c.is_ascii_digit()) {
            year = json!(p.parse::<i64>().unwrap_or(0));
        } else if p.starts_with(['\u{2605}', '*', '\u{2606}']) {
            let cleaned = p.replace(['\u{2605}', '*', '\u{2606}'], "");
            rating = json!(cleaned.trim().parse::<f64>().unwrap_or(0.0));
        } else if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit() || c == '.') {
            rating = json!(p.parse::<f64>().unwrap_or(0.0));
        } else if country.is_null() {
            country = json!(p);
        } else {
            genres.push(json!(p));
        }
    }
    (year, country, rating, genres)
}

fn abs_url(href: &str) -> String {
    if href.starts_with("http") {
        href.to_string()
    } else if href.starts_with('/') {
        format!("{}{}", BASE_URL, href)
    } else {
        format!("{}/{}", BASE_URL, href)
    }
}

async fn home(c: &reqwest::Client) -> Result<Value, String> {
    let _ = get_html(c, BASE_URL, &format!("{}/", BASE_URL)).await.map_err(|e| e.to_string());
    let html = get_html(c, BASE_URL, &format!("{}/", BASE_URL))
        .await
        .map_err(|e| format!("HTTP {}", e))?;
    let doc = scraper::Html::parse_document(&html);

    let mut hero = Vec::new();
    if let Ok(sel_track) = scraper::Selector::parse("#heroTrack > *") {
        if let (Ok(sel_a), Ok(sel_img), Ok(sel_title), Ok(sel_bg), Ok(sel_rating), Ok(sel_badge), Ok(sel_genre)) = (
            scraper::Selector::parse("a.hero-poster"),
            scraper::Selector::parse("img"),
            scraper::Selector::parse(".hero-title a"),
            scraper::Selector::parse(".hero-bg"),
            scraper::Selector::parse(".hero-badge-rating"),
            scraper::Selector::parse(".hero-badge"),
            scraper::Selector::parse(".hero-badge-genre"),
        ) {
            for el in doc.select(&sel_track) {
                let Some(a) = el.select(&sel_a).next() else { continue };
                let Some(href) = a.value().attr("href") else { continue };
                let url = abs_url(href);
                let endpoint = url
                    .replace(&format!("{}/sinopsis/", BASE_URL), "")
                    .trim_end_matches('/')
                    .to_string();
                let img = a.select(&sel_img).next().and_then(|i| i.value().attr("src")).unwrap_or("").to_string();
                let title = a
                    .select(&sel_img)
                    .next()
                    .and_then(|i| i.value().attr("alt"))
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .or_else(|| el.select(&sel_title).next().map(|t| t.text().collect::<String>().trim().to_string()))
                    .unwrap_or_else(|| endpoint.replace('-', " "));
                let backdrop = el
                    .select(&sel_bg)
                    .next()
                    .and_then(|b| b.value().attr("style"))
                    .and_then(|style| {
                        regex::Regex::new(r#"url\(['"]?(.*?)['"]?\)"#).ok()?.captures(style)?.get(1).map(|m| m.as_str().to_string())
                    })
                    .unwrap_or_default();
                let rating_text = el.select(&sel_rating).next().map(|r| r.text().collect::<String>().trim().to_string()).unwrap_or_default();
                let rating: Value = if rating_text.is_empty() {
                    Value::Null
                } else {
                    rating_text.replace("/10", "").trim().parse::<f64>().ok().map(Value::from).unwrap_or(Value::Null)
                };
                let year: Value = el
                    .select(&sel_badge)
                    .find(|b| {
                        let cls = b.value().attr("class").unwrap_or("");
                        !cls.contains("hero-badge-rating") && !cls.contains("hero-badge-genre")
                    })
                    .map(|b| b.text().collect::<String>().trim().to_string())
                    .filter(|t| t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()))
                    .map(|t| json!(t.parse::<i64>().unwrap_or(0)))
                    .unwrap_or(Value::Null);
                let genres: Vec<Value> = el.select(&sel_genre).map(|g| json!(g.text().collect::<String>().trim())).collect();
                hero.push(json!({"title": title, "url": url, "endpoint": endpoint, "image": img, "backdrop": backdrop, "rating": rating, "year": year, "genres": genres}));
            }
        }
    }

    let mut popular = Vec::new();
    if let Ok(sel_h2) = scraper::Selector::parse("h2") {
        for h2 in doc.select(&sel_h2) {
            if h2.text().collect::<String>().contains("Popular Sinopsis") {
                if let Some(section) = h2.parent().and_then(scraper::ElementRef::wrap) {
                    if let Ok(sel_links) = scraper::Selector::parse("a[href*=\"/sinopsis/\"]") {
                        for (i, el) in section.select(&sel_links).enumerate() {
                            let Some(href) = el.value().attr("href") else { continue };
                            let url = abs_url(href);
                            let endpoint = url.replace(&format!("{}/sinopsis/", BASE_URL), "").trim_end_matches('/').to_string();
                            let img = scraper::Selector::parse("img").ok().and_then(|s| el.select(&s).next().and_then(|im| im.value().attr("src"))).unwrap_or("").to_string();
                            let rank = scraper::Selector::parse("span").ok()
                                .and_then(|s| el.select(&s).find(|sp| sp.text().collect::<String>().contains('#')))
                                .map(|sp| sp.text().collect::<String>().trim().trim_start_matches('#').to_string())
                                .unwrap_or_else(|| (i + 1).to_string());
                            let title = scraper::Selector::parse("h3").ok()
                                .and_then(|s| el.select(&s).next().map(|h| h.text().collect::<String>().trim().to_string()))
                                .filter(|t| !t.is_empty())
                                .or_else(|| scraper::Selector::parse("img").ok().and_then(|s| el.select(&s).next().and_then(|im| im.value().attr("alt")).map(|a| a.trim().to_string())))
                                .unwrap_or_else(|| endpoint.clone());
                            let meta = scraper::Selector::parse("p").ok()
                                .and_then(|s| el.select(&s).next().map(|p| p.text().collect::<String>().trim().to_string()))
                                .unwrap_or_default();
                            let (year, country, rating, _) = parse_meta_line(&meta);
                            popular.push(json!({"rank": rank.parse::<i64>().unwrap_or((i + 1) as i64), "title": title, "url": url, "endpoint": endpoint, "image": img, "year": year, "country": country, "rating": rating}));
                        }
                    }
                }
                break;
            }
        }
    }

    let mut seen: std::collections::HashSet<String> = hero
        .iter()
        .filter_map(|h| h.get("url").and_then(Value::as_str).map(str::to_string))
        .chain(popular.iter().filter_map(|p| p.get("url").and_then(Value::as_str).map(str::to_string)))
        .collect();
    let mut latest = Vec::new();
    if let Ok(sel_links) = scraper::Selector::parse("a[href*=\"/sinopsis/\"]") {
        for el in doc.select(&sel_links) {
            let Some(href) = el.value().attr("href") else { continue };
            let url = abs_url(href);
            if seen.contains(&url) || !url.starts_with(&format!("{}/sinopsis/", BASE_URL)) {
                continue;
            }
            seen.insert(url.clone());
            let title = scraper::Selector::parse("h3").ok()
                .and_then(|s| el.select(&s).next().map(|h| h.text().collect::<String>().trim().to_string()))
                .filter(|t| !t.is_empty())
                .or_else(|| scraper::Selector::parse("img").ok().and_then(|s| el.select(&s).next().and_then(|im| im.value().attr("alt")).map(|a| a.trim().to_string())))
                .unwrap_or_default();
            if title.is_empty() {
                continue;
            }
            let img = scraper::Selector::parse("img").ok().and_then(|s| el.select(&s).next().and_then(|im| im.value().attr("src"))).unwrap_or("").to_string();
            let endpoint = url.replace(&format!("{}/sinopsis/", BASE_URL), "").trim_end_matches('/').to_string();
            latest.push(json!({"title": title, "url": url, "endpoint": endpoint, "image": img}));
            if latest.len() >= 12 {
                break;
            }
        }
    }

    let mut genres = Vec::new();
    let mut gseen = std::collections::HashSet::new();
    if let Ok(sel_links) = scraper::Selector::parse("a[href*=\"/genre/\"]") {
        for el in doc.select(&sel_links) {
            let Some(href) = el.value().attr("href") else { continue };
            let slug = href.split("/genre/").nth(1).unwrap_or("").trim_end_matches('/').to_string();
            if !gseen.insert(slug.clone()) {
                continue;
            }
            genres.push(json!({
                "name": el.text().collect::<String>().trim(),
                "slug": slug,
                "url": abs_url(href),
            }));
        }
    }

    Ok(json!({
        "hero": hero,
        "popular": popular,
        "latest": latest,
        "genres": genres,
        "total": {"hero": hero.len(), "popular": popular.len(), "latest": latest.len()},
    }))
}

async fn search(c: &reqwest::Client, query: &str) -> Result<Vec<Value>, String> {
    let html = get_html(c, &format!("{}/search?q={}", BASE_URL, urlencoding::encode(query)), &format!("{}/", BASE_URL))
        .await
        .map_err(|e| format!("HTTP {}", e))?;
    let doc = scraper::Html::parse_document(&html);
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(sel_a) = scraper::Selector::parse("a[href]") {
        for el in doc.select(&sel_a) {
            let Some(href) = el.value().attr("href") else { continue };
            let film_url = abs_url(href);
            if !film_url.starts_with(&format!("{}/sinopsis/", BASE_URL)) || !seen.insert(film_url.clone()) {
                continue;
            }
            let title = scraper::Selector::parse("h1,h2,h3,h4,h5").ok()
                .and_then(|s| el.select(&s).next().map(|h| h.text().collect::<String>().trim().to_string()))
                .filter(|t| !t.is_empty())
                .or_else(|| el.value().attr("title").map(|t| t.trim().to_string()).filter(|t| !t.is_empty()))
                .or_else(|| scraper::Selector::parse("img").ok().and_then(|s| el.select(&s).next().and_then(|im| im.value().attr("alt")).map(|a| a.trim().to_string())).filter(|t| !t.is_empty()))
                .unwrap_or_else(|| el.text().collect::<String>().trim().to_string());
            let title = if title.is_empty() {
                film_url.split('/').next_back().unwrap_or("").replace('-', " ")
            } else {
                title
            };
            let spans: Vec<String> = scraper::Selector::parse("span").ok()
                .map(|s| el.select(&s).map(|sp| sp.text().collect::<String>().trim().to_string()).collect())
                .unwrap_or_default();
            let typ = spans.first().filter(|t| !t.is_empty()).cloned();
            let meta_line = spans.get(1).cloned().unwrap_or_default();
            let (year, country, rating, genres) = parse_meta_line(&meta_line);
            let description = scraper::Selector::parse("p").ok().and_then(|s| el.select(&s).next().map(|p| p.text().collect::<String>().trim().to_string())).unwrap_or_default();
            let thumb = scraper::Selector::parse("img").ok()
                .and_then(|s| el.select(&s).next().and_then(|im| im.value().attr("src").or_else(|| im.value().attr("data-src"))).map(str::to_string))
                .unwrap_or_default();
            results.push(json!({
                "title": title,
                "type": typ,
                "year": year,
                "country": country,
                "rating": rating,
                "genres": genres,
                "thumbnail": thumb,
                "description": description,
                "endpoint": film_url.replace(&format!("{}/sinopsis/", BASE_URL), "").trim_end_matches('/'),
                "url": film_url,
            }));
        }
    }
    Ok(results)
}

fn list_detail_fields(doc: &scraper::Html) -> serde_json::Map<String, Value> {
    let mut detail_map = serde_json::Map::new();
    if let (Ok(sel_details), Ok(sel_rows), Ok(sel_div)) = (
        scraper::Selector::parse("details"),
        scraper::Selector::parse("div[class*=\"grid-cols-[\"]"),
        scraper::Selector::parse("div"),
    ) {
        for root in doc.select(&sel_details) {
            let summary = root.select(&scraper::Selector::parse("summary").unwrap()).next().map(|s| s.text().collect::<String>()).unwrap_or_default();
            if !summary.contains("Detail Film") {
                continue;
            }
            for row in root.select(&sel_rows) {
                let cells: Vec<_> = row.select(&sel_div).collect();
                if cells.len() < 2 {
                    continue;
                }
                let key = cells[0].text().collect::<String>().trim().replace(':', "");
                let val_el = cells[1];
                if key == "Genre" || key == "Cast" {
                    let vals: Vec<Value> = scraper::Selector::parse("a").ok()
                        .map(|s| val_el.select(&s).map(|a| json!(a.text().collect::<String>().trim())).collect())
                        .unwrap_or_default();
                    detail_map.insert(key.to_lowercase(), Value::Array(vals));
                } else {
                    detail_map.insert(key.to_lowercase(), json!(val_el.text().collect::<String>().trim()));
                }
            }
        }
    }
    detail_map
}

async fn detail(c: &reqwest::Client, url: &str) -> Result<Value, String> {
    let html = get_html(c, url, &format!("{}/search?q=", BASE_URL))
        .await
        .map_err(|st| if st == 404 { "Film tidak ditemukan (404)".to_string() } else { format!("HTTP {}", st) })?;
    let doc = scraper::Html::parse_document(&html);

    let mut movie: Option<Value> = None;
    if let Ok(sel) = scraper::Selector::parse("script[type=\"application/ld+json\"]") {
        for script in doc.select(&sel) {
            let txt = script.text().collect::<String>();
            if let Ok(data) = serde_json::from_str::<Value>(txt.trim()) {
                let found = match &data {
                    Value::Array(a) => a.iter().find(|v| v.get("@type").and_then(Value::as_str) == Some("Movie")).cloned(),
                    v if v.get("@type").and_then(Value::as_str) == Some("Movie") => Some(v.clone()),
                    _ => None,
                };
                if found.is_some() {
                    movie = found;
                    break;
                }
            }
        }
    }

    let title = movie
        .as_ref()
        .and_then(|m| m.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            scraper::Selector::parse("meta[property=\"og:title\"]").ok()
                .and_then(|s| doc.select(&s).next().and_then(|el| el.value().attr("content")).map(str::to_string))
                .unwrap_or_else(|| scraper::Selector::parse("title").ok().map(|s| doc.select(&s).next().map(|t| t.text().collect::<String>().trim().to_string())).flatten().unwrap_or_default())
        });

    let detail_map = list_detail_fields(&doc);
    let get_map_str = |k: &str| detail_map.get(k).cloned().unwrap_or(Value::Null);

    let mut cast_count: Value = Value::Null;
    let shown_cast = detail_map.get("cast").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    let cast_plus = scraper::Selector::parse("details").ok()
        .and_then(|s| {
            doc.select(&s).filter_map(|d| {
                let summary = d.select(&scraper::Selector::parse("summary").ok()?).next()?.text().collect::<String>();
                if !summary.contains("Detail Film") { return None; }
                d.select(&scraper::Selector::parse("span").ok()?).find_map(|sp| {
                    let t = sp.text().collect::<String>().trim().to_string();
                    if regex::Regex::new(r"^\+\d+$").ok()?.is_match(&t) { Some(t) } else { None }
                })
            }).next()
        });
    if let Some(cp) = cast_plus {
        let extra: i64 = cp.trim_start_matches('+').parse().unwrap_or(0);
        cast_count = json!(shown_cast as i64 + extra);
    } else if shown_cast > 0 {
        cast_count = json!(shown_cast);
    }

    let body_text = doc.root_element().text().collect::<String>();
    let score_re = regex::Regex::new(r"(?i)Score Penonton\s*([\d.]+)\s*/\s*10\s*\(\s*([\d.]+)\s*votes?\s*\)").unwrap();
    let audience_score = score_re.captures(&body_text).map(|m| {
        json!({"rating": m[1].parse::<f64>().unwrap_or(0.0), "votes": m[2].parse::<f64>().unwrap_or(0.0)})
    });

    let trailer_src = scraper::Selector::parse("iframe").ok()
        .and_then(|s| doc.select(&s).next().and_then(|f| f.value().attr("src")).map(str::to_string))
        .or_else(|| movie.as_ref().and_then(|m| m.pointer("/trailer/embedUrl").and_then(Value::as_str).map(str::to_string)))
        .unwrap_or_default();
    let trailer = if trailer_src.is_empty() {
        Value::Null
    } else {
        json!({
            "url": if trailer_src.starts_with("http") { trailer_src.clone() } else { format!("https:{}", trailer_src) },
            "thumbnail": movie.as_ref().and_then(|m| m.pointer("/trailer/thumbnailUrl").cloned().or_else(|| m.get("image").cloned())).unwrap_or(json!("")),
        })
    };

    let mut full_synopsis = String::new();
    if let Ok(sel) = scraper::Selector::parse(".article-prose") {
        if let Some(prose) = doc.select(&sel).next() {
            if let Ok(sel_p) = scraper::Selector::parse("p") {
                full_synopsis = prose
                    .select(&sel_p)
                    .map(|p| p.text().collect::<String>().trim().to_string())
                    .collect::<Vec<_>>()
                    .join("\n\n");
            }
        }
    }

    let directors: Vec<Value> = movie
        .as_ref()
        .and_then(|m| m.get("director"))
        .map(|d| match d {
            Value::Array(a) => a.iter().map(|v| json!(v.as_str().unwrap_or_else(|| v.get("name").and_then(Value::as_str).unwrap_or("")))).filter(|v| !v.as_str().unwrap_or("").is_empty()).collect(),
            v if !v.is_null() => vec![json!(v.as_str().unwrap_or_else(|| v.get("name").and_then(Value::as_str).unwrap_or("")))],
            _ => vec![],
        })
        .unwrap_or_default();
    let director: Value = if !directors.is_empty() {
        json!(directors)
    } else if let Some(d) = detail_map.get("director").and_then(Value::as_str) {
        json!([d])
    } else {
        json!([])
    };

    let ld_actors: Vec<Value> = movie
        .as_ref()
        .and_then(|m| m.get("actor"))
        .map(|d| match d {
            Value::Array(a) => a.iter().map(|v| json!(v.as_str().unwrap_or_else(|| v.get("name").and_then(Value::as_str).unwrap_or("")))).filter(|v| !v.as_str().unwrap_or("").is_empty()).collect(),
            v if !v.is_null() => vec![json!(v.as_str().unwrap_or_else(|| v.get("name").and_then(Value::as_str).unwrap_or("")))],
            _ => vec![],
        })
        .unwrap_or_default();
    let cast_arr = detail_map.get("cast").and_then(Value::as_array).cloned().unwrap_or_default();
    let actors = if ld_actors.len() >= cast_arr.len() && !ld_actors.is_empty() {
        ld_actors.clone()
    } else if !cast_arr.is_empty() {
        cast_arr.clone()
    } else {
        ld_actors
    };

    let aggregate = movie.as_ref().and_then(|m| m.get("aggregateRating")).cloned().unwrap_or(json!({}));
    let country = movie
        .as_ref()
        .and_then(|m| m.pointer("/countryOfOrigin/name").and_then(Value::as_str))
        .map(str::to_string);

    let year: Value = regex::Regex::new(r"(\d{4})").ok()
        .and_then(|re| re.captures(url))
        .and_then(|m| m.get(1))
        .and_then(|m| m.as_str().parse::<i64>().ok())
        .map(Value::from)
        .unwrap_or(Value::Null);

    let release_date = get_map_str("rilis");
    let release_date = if !release_date.is_null() {
        release_date
    } else {
        movie.as_ref().and_then(|m| m.get("datePublished").cloned()).unwrap_or(json!(""))
    };

    let genre: Value = match movie.as_ref().and_then(|m| m.get("genre")) {
        Some(Value::Array(a)) => json!(a.clone()),
        Some(Value::String(s)) => json!([s]),
        _ => detail_map.get("genre").cloned().unwrap_or(json!([])),
    };

    let description = movie
        .as_ref()
        .and_then(|m| m.get("description").and_then(Value::as_str))
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            scraper::Selector::parse("meta[name=\"description\"]").ok()
                .and_then(|s| doc.select(&s).next().and_then(|el| el.value().attr("content")).map(str::to_string))
                .or_else(|| scraper::Selector::parse("meta[property=\"og:description\"]").ok().and_then(|s| doc.select(&s).next().and_then(|el| el.value().attr("content")).map(str::to_string)))
                .unwrap_or_default()
        });

    let image = movie
        .as_ref()
        .and_then(|m| m.get("image").and_then(Value::as_str))
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            scraper::Selector::parse("meta[property=\"og:image\"]").ok()
                .and_then(|s| doc.select(&s).next().and_then(|el| el.value().attr("content")).map(str::to_string))
                .unwrap_or_default()
        });

    let rating: Value = aggregate
        .get("ratingValue")
        .cloned()
        .unwrap_or_else(|| {
            let r = get_map_str("rating");
            r.as_str().map(|s| json!(s.replace("/10", ""))).unwrap_or(Value::Null)
        });

    Ok(json!({
        "title": title,
        "original_title": if !get_map_str("original").is_null() { get_map_str("original") } else { json!(title) },
        "url": url,
        "endpoint": url.replace(&format!("{}/sinopsis/", BASE_URL), "").trim_end_matches('/'),
        "year": year,
        "image": image,
        "datePublished": movie.as_ref().and_then(|m| m.get("datePublished").cloned()).unwrap_or(json!("")),
        "releaseDate": release_date,
        "duration": parse_duration(movie.as_ref().and_then(|m| m.get("duration").and_then(Value::as_str)).unwrap_or("")),
        "genre": genre,
        "country": country.or_else(|| get_map_str("negara").as_str().map(str::to_string)).map(Value::String).unwrap_or(Value::Null),
        "director": director,
        "actors": actors,
        "cast_count": if !cast_count.is_null() { cast_count } else { json!(actors.len()) },
        "rating": rating,
        "rating_best": aggregate.get("bestRating").cloned().unwrap_or(json!(10)),
        "rating_count": aggregate.get("ratingCount").cloned().or_else(|| audience_score.as_ref().and_then(|a| a.get("votes").cloned())).unwrap_or(Value::Null),
        "audience_score": audience_score,
        "trailer": trailer,
        "synopsis": if full_synopsis.is_empty() { movie.as_ref().and_then(|m| m.get("description").cloned()).unwrap_or(json!("")) } else { json!(full_synopsis) },
        "description": description,
    }))
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

    let action = get_param("action").unwrap_or_else(|| "home".to_string());
    let query_str = get_param("query").unwrap_or_default();

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    if action == "home" {
        return match home(&c).await {
            Ok(r) => Json(json!({"status": true, "result": r})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    if action == "search" {
        let q = query_str.trim();
        if q.is_empty() {
            return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk search");
        }
        return match search(&c, q).await {
            Ok(results) => Json(json!({"status": true, "result": {"query": q, "count": results.len(), "results": results}})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    if action == "detail" {
        let q = query_str.trim();
        if q.is_empty() {
            return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk detail (endpoint/URL)");
        }
        let target_url = if q.starts_with("http") {
            q.to_string()
        } else {
            format!("{}/sinopsis/{}", BASE_URL, q.trim_matches('/'))
        };
        return match detail(&c, &target_url).await {
            Ok(r) => Json(json!({"status": true, "result": r})).into_response(),
            Err(e) if e == "Film tidak ditemukan (404)" => err(StatusCode::NOT_FOUND, &e),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    err(StatusCode::BAD_REQUEST, &format!("Action tidak dikenali: '{}'", action))
}

// Tokusatsu Search — native conversion of api/search/tokusatsu.js
// Scraping tokusatsuindo.com: actions home, movie, movie-special, kamen-rider,
// super-sentai, ultraman, other, search, detail (stream via admin-ajax).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE: &str = "https://www.tokusatsuindo.com";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .default_headers(reqwest::header::HeaderMap::from_iter([
            ("Accept-Language".parse().unwrap(), "en-US,en;q=0.9,id;q=0.8".parse().unwrap()),
            ("Accept".parse().unwrap(), "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8".parse().unwrap()),
        ]))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_html(c: &reqwest::Client, url: &str) -> Result<String, String> {
    c.get(url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())
}

fn img_of(el: &scraper::ElementRef, sel_img: &scraper::Selector) -> String {
    el.select(sel_img)
        .next()
        .and_then(|img| img.value().attr("data-src").or_else(|| img.value().attr("src")))
        .unwrap_or("")
        .to_string()
}

async fn scrape_home(c: &reqwest::Client) -> Result<Value, String> {
    let html = fetch_html(c, &format!("{}/", BASE)).await?;
    let doc = scraper::Html::parse_document(&html);

    let mut slider = Vec::new();
    if let Ok(sel) = scraper::Selector::parse(".gmr-slider-content") {
        let sel_title = scraper::Selector::parse(".gmr-slide-titlelink").map_err(|e| e.to_string())?;
        let sel_img = scraper::Selector::parse(".other-content-thumbnail img").map_err(|e| e.to_string())?;
        for el in doc.select(&sel) {
            let title_el = el.select(&sel_title).next();
            let title = title_el.map(|t| t.text().collect::<String>().trim().to_string()).unwrap_or_default();
            let link = title_el.and_then(|t| t.value().attr("href")).unwrap_or("").to_string();
            let image = img_of(&el, &sel_img);
            if !title.is_empty() && !link.is_empty() {
                slider.push(json!({"title": title, "link": link, "image": image}));
            }
        }
    }

    let mut movie_special = Vec::new();
    if let Ok(sel_h3) = scraper::Selector::parse("h3") {
        for h3 in doc.select(&sel_h3) {
            if !h3.text().collect::<String>().to_lowercase().contains("movie &") {
                continue;
            }
            if let (Ok(sel_item), Ok(sel_a), Ok(sel_img)) = (
                scraper::Selector::parse(".gmr-item-modulepost"),
                scraper::Selector::parse("a"),
                scraper::Selector::parse("img"),
            ) {
                if let Some(row) = h3.parent().and_then(scraper::ElementRef::wrap) {
                    let mut sibling = row.next_sibling().and_then(scraper::ElementRef::wrap);
                    while let Some(s) = sibling {
                        if s.value().has_class("grid-container", scraper::CaseSensitivity::CaseSensitive) && s.value().has_class("gmr-module-posts", scraper::CaseSensitivity::CaseSensitive) {
                            for el in s.select(&sel_item) {
                                let link_el = el.select(&sel_a).next();
                                let link = link_el.and_then(|a| a.value().attr("href")).unwrap_or("").to_string();
                                if link.is_empty() {
                                    continue;
                                }
                                let title = link_el
                                    .and_then(|a| a.value().attr("title"))
                                    .map(|t| t.replace("Permalink to: ", ""))
                                    .filter(|t| !t.is_empty())
                                    .unwrap_or_else(|| el.select(&scraper::Selector::parse(".entry-title a").unwrap()).next().map(|t| t.text().collect::<String>().trim().to_string()).unwrap_or_default());
                                let image = img_of(&el, &sel_img);
                                movie_special.push(json!({"title": title, "link": link, "image": image}));
                            }
                            break;
                        }
                        sibling = s.next_sibling().and_then(scraper::ElementRef::wrap);
                    }
                }
            }
            break;
        }
    }

    let mut tokusatsu_update = Vec::new();
    if let (Ok(sel_art), Ok(sel_a), Ok(sel_img), Ok(sel_cat)) = (
        scraper::Selector::parse("article.item-infinite"),
        scraper::Selector::parse("h2.entry-title a"),
        scraper::Selector::parse(".content-thumbnail img"),
        scraper::Selector::parse(".gmr-movie-on a"),
    ) {
        for el in doc.select(&sel_art) {
            let title = el.select(&sel_a).next().map(|a| a.text().collect::<String>().trim().to_string()).unwrap_or_default();
            let link = el.select(&sel_a).next().and_then(|a| a.value().attr("href")).unwrap_or("").to_string();
            let image = img_of(&el, &sel_img);
            let categories: Vec<Value> = el.select(&sel_cat).map(|ca| json!(ca.text().collect::<String>().trim())).collect();
            if !title.is_empty() && !link.is_empty() {
                tokusatsu_update.push(json!({"title": title, "link": link, "image": image, "categories": categories}));
            }
        }
    }

    let mut most_view = Vec::new();
    if let (Ok(sel_li), Ok(sel_a), Ok(sel_img)) = (
        scraper::Selector::parse(".idmuvi-rp-widget li"),
        scraper::Selector::parse("a"),
        scraper::Selector::parse("img"),
    ) {
        for el in doc.select(&sel_li) {
            let link_el = el.select(&sel_a).next();
            let link = link_el.and_then(|a| a.value().attr("href")).unwrap_or("").to_string();
            if link.is_empty() {
                continue;
            }
            let title = link_el
                .and_then(|a| a.value().attr("title"))
                .map(|t| t.trim().replace("Permalink to: ", ""))
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| link_el.map(|a| a.text().collect::<String>().trim().to_string()).unwrap_or_default());
            let image = img_of(&el, &sel_img);
            most_view.push(json!({"title": title, "link": link, "image": image}));
        }
    }

    Ok(json!({"slider": slider, "movieSpecial": movie_special, "tokusatsuUpdate": tokusatsu_update, "mostView": most_view}))
}

fn parse_item_list(doc: &scraper::Html) -> (Vec<Value>, i64) {
    let mut items = Vec::new();
    if let (Ok(sel_art), Ok(sel_a), Ok(sel_img), Ok(sel_cat)) = (
        scraper::Selector::parse("article.item-infinite"),
        scraper::Selector::parse("h2.entry-title a"),
        scraper::Selector::parse(".content-thumbnail img"),
        scraper::Selector::parse(".gmr-movie-on a"),
    ) {
        for el in doc.select(&sel_art) {
            let title = el.select(&sel_a).next().map(|a| a.text().collect::<String>().trim().to_string()).unwrap_or_default();
            let link = el.select(&sel_a).next().and_then(|a| a.value().attr("href")).unwrap_or("").to_string();
            let image = img_of(&el, &sel_img);
            let categories: Vec<Value> = el.select(&sel_cat).map(|ca| json!(ca.text().collect::<String>().trim())).collect();
            if !title.is_empty() && !link.is_empty() {
                items.push(json!({"title": title, "link": link, "image": image, "categories": categories}));
            }
        }
    }
    let mut max_page = 1i64;
    if let Ok(sel_pg) = scraper::Selector::parse(".pagination .page-numbers") {
        for el in doc.select(&sel_pg) {
            if let Ok(n) = el.text().collect::<String>().trim().parse::<i64>() {
                if n > max_page {
                    max_page = n;
                }
            }
        }
    }
    (items, max_page)
}

async fn scrape_movies(c: &reqwest::Client, page: i64) -> Result<Value, String> {
    let url = if page > 1 { format!("{}/movie/page/{}/", BASE, page) } else { format!("{}/movie/", BASE) };
    let html = fetch_html(c, &url).await?;
    let doc = scraper::Html::parse_document(&html);
    let (movies, max_page) = parse_item_list(&doc);
    Ok(json!({"movies": movies, "currentPage": page, "maxPage": max_page}))
}

async fn scrape_movie_special(c: &reqwest::Client) -> Result<Value, String> {
    let html = fetch_html(c, &format!("{}/movie-special/", BASE)).await?;
    let doc = scraper::Html::parse_document(&html);
    let keys = ["kamenRider", "superSentai", "ultraman", "other"];
    let mut categories: Vec<(String, Vec<Value>)> = keys.iter().map(|k| (k.to_string(), Vec::new())).collect();

    if let (Ok(sel_wrap), Ok(sel_item), Ok(sel_title), Ok(sel_img)) = (
        scraper::Selector::parse(".pt-cv-wrapper"),
        scraper::Selector::parse(".pt-cv-content-item"),
        scraper::Selector::parse(".pt-cv-title a"),
        scraper::Selector::parse("img.pt-cv-thumbnail"),
    ) {
        for (i, el) in doc.select(&sel_wrap).enumerate() {
            if i >= keys.len() {
                break;
            }
            for item in el.select(&sel_item) {
                let title = item.select(&sel_title).next().map(|t| t.text().collect::<String>().trim().to_string()).unwrap_or_default();
                let link = item.select(&sel_title).next().and_then(|t| t.value().attr("href")).unwrap_or("").to_string();
                let image = img_of(&item, &sel_img);
                if !title.is_empty() && !link.is_empty() {
                    categories[i].1.push(json!({"title": title, "link": link, "image": image}));
                }
            }
        }
    }

    let mut obj = serde_json::Map::new();
    for (k, v) in categories {
        obj.insert(k, Value::Array(v));
    }
    Ok(Value::Object(obj))
}

async fn scrape_era_category(c: &reqwest::Client, slug: &str) -> Result<Value, String> {
    let html = fetch_html(c, &format!("{}/{}/", BASE, slug)).await?;
    let doc = scraper::Html::parse_document(&html);
    let mut eras: Vec<(String, Vec<Value>)> = vec![
        ("reiwa".into(), Vec::new()),
        ("heisei".into(), Vec::new()),
        ("showa".into(), Vec::new()),
    ];

    if let (Ok(sel_h1), Ok(sel_li), Ok(sel_a), Ok(sel_img)) = (
        scraper::Selector::parse("h1"),
        scraper::Selector::parse("ul li"),
        scraper::Selector::parse("a"),
        scraper::Selector::parse("img"),
    ) {
        for h1 in doc.select(&sel_h1) {
            let heading = h1.text().collect::<String>().trim().to_lowercase();
            let key = if heading.contains("reiwa") {
                Some(0)
            } else if heading.contains("heasei") || heading.contains("heisei") {
                Some(1)
            } else if heading.contains("showa") {
                Some(2)
            } else {
                None
            };
            let Some(ki) = key else { continue };

            // nextAll("ul").first()
            let mut sib = h1.next_sibling().and_then(scraper::ElementRef::wrap);
            while let Some(s) = sib {
                if s.value().name() == "ul" {
                    for li in s.select(&sel_li) {
                        let text_link = li.select(&sel_a).find(|a| !a.text().collect::<String>().trim().is_empty());
                        let Some(a) = text_link else { continue };
                        let image = li
                            .select(&sel_img)
                            .next()
                            .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
                            .map(str::to_string);
                        eras[ki].1.push(json!({
                            "title": a.text().collect::<String>().trim(),
                            "link": a.value().attr("href").unwrap_or(""),
                            "image": image,
                        }));
                    }
                    break;
                }
                sib = s.next_sibling().and_then(scraper::ElementRef::wrap);
            }
        }
    }

    let mut obj = serde_json::Map::new();
    for (k, v) in eras {
        obj.insert(k, Value::Array(v));
    }
    Ok(Value::Object(obj))
}

async fn scrape_other(c: &reqwest::Client) -> Result<Value, String> {
    let html = fetch_html(c, &format!("{}/other-tokusatsu-upload/", BASE)).await?;
    let doc = scraper::Html::parse_document(&html);
    let mut shows = Vec::new();
    if let (Ok(sel_ul), Ok(sel_li), Ok(sel_a), Ok(sel_img)) = (
        scraper::Selector::parse(".entry-content ul"),
        scraper::Selector::parse("li"),
        scraper::Selector::parse("a"),
        scraper::Selector::parse("img"),
    ) {
        if let Some(first_ul) = doc.select(&sel_ul).next() {
            for li in first_ul.select(&sel_li) {
                let text_link = li.select(&sel_a).find(|a| !a.text().collect::<String>().trim().is_empty());
                let Some(a) = text_link else { continue };
                let image = li
                    .select(&sel_img)
                    .next()
                    .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
                    .map(str::to_string);
                shows.push(json!({
                    "title": a.text().collect::<String>().trim(),
                    "link": a.value().attr("href").unwrap_or(""),
                    "image": image,
                }));
            }
        }
    }
    Ok(Value::Array(shows))
}

async fn scrape_search(c: &reqwest::Client, query: &str, page: i64) -> Result<Value, String> {
    let url = if page > 1 {
        format!("{}/page/{}/?s={}", BASE, page, urlencoding::encode(query))
    } else {
        format!("{}/?s={}", BASE, urlencoding::encode(query))
    };
    let html = fetch_html(c, &url).await?;
    let doc = scraper::Html::parse_document(&html);
    let (results, max_page) = parse_item_list(&doc);
    Ok(json!({"results": results, "currentPage": page, "maxPage": max_page}))
}

async fn fetch_stream_link(c: &reqwest::Client, post_id: &str, tab: &str, referer: &str) -> Option<String> {
    let body = format!("action=muvipro_player_content&tab={}&post_id={}", urlencoding::encode(tab), urlencoding::encode(post_id));
    let res = c
        .post(&format!("{}/wp-admin/admin-ajax.php", BASE))
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        .header("Referer", referer)
        .body(body)
        .send()
        .await
        .ok()?;
    let html = res.text().await.ok()?;
    let doc = scraper::Html::parse_document(&html);
    scraper::Selector::parse("iframe")
        .ok()
        .and_then(|s| doc.select(&s).next())
        .and_then(|f| f.value().attr("src"))
        .map(str::to_string)
}

async fn scrape_detail(c: &reqwest::Client, target_url: &str) -> Result<Value, String> {
    let html = fetch_html(c, target_url).await?;
    let (title, post_id, servers, prev_url, next_url, info, cover, synopsis, episodes) = {
        let doc = scraper::Html::parse_document(&html);

        let title = scraper::Selector::parse("h1.entry-title")
            .ok()
            .and_then(|s| doc.select(&s).next().map(|t| t.text().collect::<String>().trim().to_string()))
            .filter(|t| !t.is_empty())
            .or_else(|| scraper::Selector::parse("h1").ok().and_then(|s| doc.select(&s).next().map(|t| t.text().collect::<String>().trim().to_string())))
            .or_else(|| scraper::Selector::parse("title").ok().and_then(|s| doc.select(&s).next().map(|t| t.text().collect::<String>().trim().to_string())))
            .unwrap_or_default();

        let post_id = scraper::Selector::parse("#muvipro_player_content_id")
            .ok()
            .and_then(|s| doc.select(&s).next())
            .and_then(|p| p.value().attr("data-id"))
            .unwrap_or("")
            .to_string();

        let mut servers = Vec::new();
        if !post_id.is_empty() {
            if let Ok(sel_tabs) = scraper::Selector::parse("ul.muvipro-player-tabs > li > a") {
                for (i, el) in doc.select(&sel_tabs).enumerate() {
                    let name = el.text().collect::<String>().trim().to_string();
                    let tab = el
                        .value()
                        .attr("href")
                        .map(|h| h.trim_start_matches('#').to_string())
                        .filter(|h| !h.is_empty())
                        .unwrap_or_else(|| format!("p{}", i + 1));
                    servers.push(json!({"name": name, "tab": tab}));
                }
            }
        }

        let prev_url = scraper::Selector::parse(".wp-next-post-navi-pre a")
            .ok()
            .and_then(|s| doc.select(&s).next())
            .and_then(|a| a.value().attr("href"))
            .map(str::to_string);
        let next_url = scraper::Selector::parse(".wp-next-post-navi-next a")
            .ok()
            .and_then(|s| doc.select(&s).next())
            .and_then(|a| a.value().attr("href"))
            .map(str::to_string);

        let mut info = String::new();
        if let Ok(sel_p) = scraper::Selector::parse(".entry-content p") {
            for el in doc.select(&sel_p) {
                let txt = el.text().collect::<String>().trim().to_string();
                let has_img = scraper::Selector::parse("img").ok().map(|s| el.select(&s).next().is_some()).unwrap_or(false);
                if !txt.is_empty() && !has_img {
                    info.push_str(&txt);
                    info.push_str("\n\n");
                }
            }
        }

        let cover = scraper::Selector::parse(".content-thumbnail img, .entry-content img")
            .ok()
            .and_then(|s| doc.select(&s).next())
            .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
            .unwrap_or("")
            .to_string();

        let mut synopsis = String::new();
        if let Ok(sel_p) = scraper::Selector::parse(".entry-content p") {
            for el in doc.select(&sel_p) {
                let txt = el.text().collect::<String>().trim().to_string();
                let has_img = scraper::Selector::parse("img").ok().map(|s| el.select(&s).next().is_some()).unwrap_or(false);
                if txt.len() > 40 && !has_img && !txt.contains("var ") && !txt.contains("CDATA") {
                    synopsis.push_str(&txt);
                    synopsis.push_str("\n\n");
                }
            }
        }

        let mut episodes: Vec<Value> = Vec::new();
        if let Ok(sel) = scraper::Selector::parse(".entry-content ul.lcp_catlist li a") {
            for el in doc.select(&sel) {
                episodes.push(json!({"title": el.text().collect::<String>().trim(), "url": el.value().attr("href").unwrap_or("")}));
            }
        }
        if episodes.is_empty() {
            if let Ok(sel_a) = scraper::Selector::parse(".entry-content a") {
                for el in doc.select(&sel_a) {
                    let text = el.text().collect::<String>().trim().to_string();
                    let href = el.value().attr("href").unwrap_or("");
                    if href.is_empty() || href.ends_with(".jpg") || href.ends_with(".png") || href.contains("/category/") || href.contains("/tag/") {
                        continue;
                    }
                    let tl = text.to_lowercase();
                    if tl.contains("episode") || tl.contains("eps") || regex::Regex::new(r"\d+").unwrap().is_match(&text) {
                        episodes.push(json!({"title": text, "url": href}));
                    }
                }
            }
        }
        // dedupe by url
        let mut seen = std::collections::HashSet::new();
        episodes.retain(|e| seen.insert(e.get("url").and_then(Value::as_str).unwrap_or("").to_string()));

        (title, post_id, servers, prev_url, next_url, info, cover, synopsis, episodes)
    };

    if !post_id.is_empty() {
        let active_stream_url = if !servers.is_empty() {
            let tab = servers[0].get("tab").and_then(Value::as_str).unwrap_or("p1");
            fetch_stream_link(c, &post_id, tab, target_url).await
        } else {
            None
        };

        return Ok(json!({
            "type": "episode",
            "title": title,
            "postId": post_id,
            "servers": servers,
            "activeStreamUrl": active_stream_url,
            "prevUrl": prev_url,
            "nextUrl": next_url,
            "info": info.trim(),
        }));
    }

    Ok(json!({
        "type": "series",
        "title": title,
        "cover": cover,
        "synopsis": synopsis.trim(),
        "episodes": episodes,
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

    let action = match get_param("action") {
        Some(a) => a,
        None => {
            return Json(json!({"status": "error", "message": "Parameter action wajib (home/movie/movie-special/kamen-rider/super-sentai/ultraman/other/search/detail)"}))
                .into_response()
        }
    };
    let page: i64 = get_param("page").and_then(|p| p.parse().ok()).unwrap_or(1);

    let c = match client() {
        Ok(c) => c,
        Err(e) => return Json(json!({"status": "error", "message": "Gagal melakukan scraping", "details": e})).into_response(),
    };

    let res = match action.as_str() {
        "home" => scrape_home(&c).await,
        "movie" => scrape_movies(&c, page).await,
        "movie-special" => scrape_movie_special(&c).await,
        "kamen-rider" => scrape_era_category(&c, "kamen-rider-2").await,
        "super-sentai" => scrape_era_category(&c, "super-sentai2").await,
        "ultraman" => scrape_era_category(&c, "ultraman2").await,
        "other" => scrape_other(&c).await,
        "search" => {
            let Some(q) = get_param("query") else {
                return Json(json!({"status": "error", "message": "Parameter query wajib untuk action=search"})).into_response();
            };
            scrape_search(&c, &q, page).await
        }
        "detail" => {
            let Some(url) = get_param("url") else {
                return Json(json!({"status": "error", "message": "Parameter url wajib untuk action=detail"})).into_response();
            };
            scrape_detail(&c, &url).await
        }
        _ => return Json(json!({"status": "error", "message": format!("Action \"{}\" tidak dikenal", action)})).into_response(),
    };

    match res {
        Ok(result) => Json(json!({"status": "success", "action": action, "result": result})).into_response(),
        Err(e) => Json(json!({"status": "error", "message": "Gagal melakukan scraping", "details": e})).into_response(),
    }
}

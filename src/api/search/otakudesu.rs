// OtakuDesu — native conversion of api/search/otakudesu.js
// Scraping otakudesu.blog: home, ongoing, complete, search, anime_list,
// anime_detail, episode_detail (mirror decryption via admin-ajax), batch,
// schedule, genres, by_genre. Regex-based HTML parsing.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://otakudesu.blog";

static TAGS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<[^>]*>").unwrap());

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())
}

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

async fn get(c: &reqwest::Client, url: &str) -> Result<String, (StatusCode, String)> {
    c.get(url).send().await
        .and_then(|r| r.error_for_status())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .text().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn text(html: &str) -> String {
    html_decode(TAGS_RE.replace_all(html, "").trim())
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&").replace("&#039;", "'").replace("&#39;", "'")
        .replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn first_match(re: &Regex, html: &str) -> Option<String> {
    re.captures(html).map(|c| c.get(1).unwrap().as_str().to_string())
}

fn strip_anime_prefix(url: &str) -> String {
    url.replace(&format!("{}/anime/", BASE_URL), "").trim_end_matches('/').to_string()
}
fn strip_episode_prefix(url: &str) -> String {
    url.replace(&format!("{}/episode/", BASE_URL), "").trim_end_matches('/').to_string()
}

/// Parse item list `<li>` dari blok `.venz ul li` generik.
fn parse_venz_items(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    // blok: <li> ... <h2><a href="URL">TITLE</a></h2> <img src> .epz .epztipe .newseps
    let li_re = Regex::new(r#"(?s)<li>\s*<div[^>]*>.*?<h2[^>]*>\s*<a\s+href="([^"]+)"[^>]*>(.*?)</a>.*?<img\s+[^>]*src="([^"]*)".*?</li>"#).unwrap();
    for cap in li_re.captures_iter(html) {
        let url = cap[1].to_string();
        let title = text(&cap[2]);
        let thumb = cap[3].to_string();
        let li = cap.get(0).unwrap().as_str();
        let epz = Regex::new(r#"class="epz"[^>]*>([^<]*)<"#).unwrap()
            .captures(li).map(|c| c[1].trim().to_string()).unwrap_or_default();
        let epztipe = Regex::new(r#"class="epztipe"[^>]*>([^<]*)<"#).unwrap()
            .captures(li).map(|c| c[1].trim().to_string()).unwrap_or_default();
        let newseps = Regex::new(r#"class="newseps"[^>]*>([^<]*)<"#).unwrap()
            .captures(li).map(|c| c[1].trim().to_string()).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        out.push(json!({
            "title": title,
            "endpoint": strip_anime_prefix(&url),
            "url": url,
            "thumb": thumb,
            "episode": epz,
            "extra": epztipe, // "day" (ongoing) atau "score" (complete)
            "date": newseps,
        }));
    }
    out
}

async fn get_home(c: &reqwest::Client) -> Result<Value, (StatusCode, String)> {
    let html = get(c, BASE_URL).await?;
    // dua blok .venz: pertama ongoing, terakhir completed
    let block_re = Regex::new(r#"(?s)class="venz".*?</ul>\s*</div>"#).unwrap();
    let blocks: Vec<&str> = block_re.find_iter(&html).map(|m| m.as_str()).collect();
    let ongoing = blocks.first().map(|b| parse_venz_items(b)).unwrap_or_default();
    let completed = blocks.last().map(|b| parse_venz_items(b)).unwrap_or_default();
    Ok(json!({"ongoing": ongoing, "completed": completed}))
}

async fn get_ongoing(c: &reqwest::Client, page: u32) -> Result<Value, (StatusCode, String)> {
    let url = if page > 1 { format!("{}/ongoing-anime/page/{}/", BASE_URL, page) } else { format!("{}/ongoing-anime/", BASE_URL) };
    let html = get(c, &url).await?;
    Ok(json!({"page": page, "anime": parse_venz_items(&html)}))
}

async fn get_complete(c: &reqwest::Client, page: u32) -> Result<Value, (StatusCode, String)> {
    let url = if page > 1 { format!("{}/complete-anime/page/{}/", BASE_URL, page) } else { format!("{}/complete-anime/", BASE_URL) };
    let html = get(c, &url).await?;
    Ok(json!({"page": page, "anime": parse_venz_items(&html)}))
}

async fn get_anime_list(c: &reqwest::Client) -> Result<Vec<Value>, (StatusCode, String)> {
    let html = get(c, &format!("{}/anime-list/", BASE_URL)).await?;
    let mut list = Vec::new();
    let a_re = Regex::new(r#"(?s)<a\s+href="([^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
    // hanya bagian #absl
    let region = first_match(&Regex::new(r#"(?s)id="absl".*"#).unwrap(), &html).unwrap_or_else(|| html.to_string());
    for cap in a_re.captures_iter(&region) {
        let url = cap[1].to_string();
        let title = text(&cap[2]);
        if title.is_empty() || !url.contains("/anime/") {
            continue;
        }
        list.push(json!({"title": title, "endpoint": strip_anime_prefix(&url), "url": url}));
    }
    Ok(list)
}

async fn search_anime(c: &reqwest::Client, query: &str) -> Result<Vec<Value>, (StatusCode, String)> {
    let url = format!("{}/?s={}&post_type=anime", BASE_URL, urlencoding::encode(query));
    let html = get(c, &url).await?;
    let mut results = Vec::new();
    let li_re = Regex::new(r#"(?s)<li>\s*<img[^>]*src="([^"]*)".*?<h2[^>]*>\s*<a\s+href="([^"]+)"[^>]*>(.*?)</a>.*?</li>"#).unwrap();
    for cap in li_re.captures_iter(&html) {
        let thumb = cap[1].to_string();
        let url = cap[2].to_string();
        let title = text(&cap[3]);
        let li = cap.get(0).unwrap().as_str();
        let genres: Vec<String> = Regex::new(r#"class="set"[^>]*>.*?<a[^>]*>([^<]+)</a>"#).unwrap()
            .captures_iter(li)
            .map(|g| text(&g[1]))
            .collect();
        let status = Regex::new(r#"(?s)Status\s*:\s*([^<]+)"#).unwrap()
            .captures(li).map(|g| text(&g[1])).unwrap_or_default();
        let rating = Regex::new(r#"(?s)Rating\s*:\s*([^<]+)"#).unwrap()
            .captures(li).map(|g| text(&g[1])).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        results.push(json!({"title": title, "endpoint": strip_anime_prefix(&url), "url": url, "thumb": thumb, "genres": genres, "status": status, "rating": rating}));
    }
    Ok(results)
}

async fn get_anime_detail(c: &reqwest::Client, endpoint: &str) -> Result<Value, (StatusCode, String)> {
    let clean = endpoint.trim().trim_matches('/');
    let full_url = if clean.starts_with("http") { clean.to_string() } else { format!("{}/anime/{}/", BASE_URL, clean) };
    let html = get(c, &full_url).await?;
    if !full_url.contains("/anime/") {
        return Err((StatusCode::NOT_FOUND, format!("URL/Endpoint bukan halaman anime (dialihkan ke: {})", full_url)));
    }

    // infozingle <p> Judul : value
    let mut info: HashMap<String, String> = HashMap::new();
    let p_re = Regex::new(r#"(?s)<p>(.*?)</p>"#).unwrap();
    for cap in p_re.captures_iter(&html) {
        let t = text(&cap[1]);
        if let Some(idx) = t.find(':') {
            let k = t[..idx].trim().to_string();
            let v = t[idx + 1..].trim().to_string();
            info.entry(k).or_insert(v);
        }
    }
    let info_get = |k: &str| info.get(k).cloned().map(Value::String).unwrap_or(Value::Null);

    // episodes
    let mut episodes = Vec::new();
    let ep_re = Regex::new(r#"(?s)<a\s+href="(https://[^"]*/episode/[^"]+)"[^>]*>([^<]+)</a>\s*(?:<[^>]*>)?\s*<span[^>]*>([^<]*)</span>?"#).unwrap();
    for cap in ep_re.captures_iter(&html) {
        let url = cap[1].to_string();
        let title = text(&cap[2]);
        let date = text(&cap[3]);
        if title.is_empty() {
            continue;
        }
        episodes.push(json!({"title": title, "endpoint": strip_episode_prefix(&url), "url": url, "date": date}));
    }

    // batch link
    let mut batch_link = Value::Null;
    let batch_re = Regex::new(r#"<a\s+href="([^"]*/batch/[^"]*)"[^>]*>([^<]+)</a>"#).unwrap();
    if let Some(cap) = batch_re.captures(&html) {
        let href = cap[1].to_string();
        batch_link = json!({
            "title": text(&cap[2]),
            "url": href,
            "endpoint": href.replace(&format!("{}/batch/", BASE_URL), "").trim_end_matches('/').to_string(),
        });
    }

    let title = info_get("Judul").as_str().map(str::to_string).unwrap_or_else(|| {
        first_match(&Regex::new(r"(?s)<h1[^>]*>(.*?)</h1>").unwrap(), &html)
            .map(|t| text(&t)).unwrap_or_default()
    });

    let genres: Vec<String> = info_get("Genre").as_str()
        .map(|g| g.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    let synopsis = first_match(&Regex::new(r#"(?s)class="sinopc"[^>]*>(.*?)</div>"#).unwrap(), &html)
        .map(|s| text(&s)).unwrap_or_default();
    let thumb = first_match(&Regex::new(r#"class="attachment-post-thumbnail[^"]*"[^>]*src="([^"]*)""#).unwrap(), &html).unwrap_or_default();

    Ok(json!({
        "title": title,
        "japanese": info_get("Japanese"),
        "score": info_get("Skor"),
        "producer": info_get("Produser"),
        "type": info_get("Tipe"),
        "status": info_get("Status"),
        "total_episodes": info_get("Total Episode"),
        "duration": info_get("Durasi"),
        "release_date": info_get("Tanggal Rilis"),
        "studio": info_get("Studio"),
        "genres": genres,
        "synopsis": synopsis,
        "thumb": thumb,
        "batch": batch_link,
        "episodes": episodes,
    }))
}

/// Ambil nonce + stream action dari inline script episode.
fn extract_nonce_actions(html: &str) -> (String, String) {
    let mut nonce_action = "aa1208d27f29ca340c92c66d1926f13f".to_string();
    let mut stream_action = "2a3505c93b0035d3f455df82bf976b84".to_string();
    let script_re = Regex::new(r"(?s)<script[^>]*>(.*?)</script>").unwrap();
    for cap in script_re.captures_iter(html) {
        let s = &cap[1];
        if s.contains("__x__nonce") {
            if let Some(m) = Regex::new(r#"nonce:[^,]+,\s*action:\s*["']([a-f0-9]{32})["']"#).unwrap().captures(s) {
                stream_action = m[1].to_string();
            }
            if let Some(m) = Regex::new(r#"data:\s*\{\s*action:\s*["']([a-f0-9]{32})["']\s*\}"#).unwrap().captures(s) {
                nonce_action = m[1].to_string();
            }
            break;
        }
    }
    (nonce_action, stream_action)
}

async fn resolve_mirrors(c: &reqwest::Client, referer: &str, nonce: &str, stream_action: &str, quality: &str, items: &[(String, String)]) -> Vec<Value> {
    let mut out = Vec::new();
    for (server_name, content_raw) in items {
        if content_raw.is_empty() || nonce.is_empty() {
            out.push(json!({"server": server_name, "iframe": Value::Null}));
            continue;
        }
        let decoded: Value = match base64_decode(content_raw).and_then(|b| serde_json::from_slice(&b).ok()) {
            Some(d) => d,
            None => {
                out.push(json!({"server": server_name, "iframe": Value::Null}));
                continue;
            }
        };
        // form: decoded fields + nonce + action
        let mut form: Vec<(String, String)> = Vec::new();
        if let Some(obj) = decoded.as_object() {
            for (k, v) in obj {
                form.push((k.clone(), v.as_str().unwrap_or("").to_string()));
            }
        }
        form.push(("nonce".into(), nonce.to_string()));
        form.push(("action".into(), stream_action.to_string()));

        let res = c.post(format!("{}/wp-admin/admin-ajax.php", BASE_URL))
            .header("Referer", referer)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            .form(&form)
            .send().await;

        let mut iframe = Value::Null;
        if let Ok(r) = res {
            if let Ok(body) = r.json::<Value>().await {
                if let Some(data_b64) = body.get("data").and_then(Value::as_str) {
                    if let Some(raw) = base64_decode(data_b64) {
                        let raw = String::from_utf8_lossy(&raw).to_string();
                        if let Some(m) = Regex::new(r#"src=["']([^"']+)["']"#).unwrap().captures(&raw) {
                            iframe = Value::String(m[1].to_string());
                        }
                    }
                }
            }
        }
        out.push(json!({"server": server_name, "iframe": iframe}));
    }
    let _ = quality;
    out
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s.trim()).ok()
        .or_else(|| {
            use base64::engine::general_purpose;
            general_purpose::STANDARD.decode(s.trim().trim_end_matches('=').to_string() + &"=".repeat((4 - s.trim().len() % 4) % 4)).ok()
        })
}

fn parse_downloads(html: &str, container: &str) -> serde_json::Map<String, Value> {
    // blok <div class="download"> atau .batchlink; li per item
    let region = first_match(&Regex::new(&format!(r#"(?s)class="{}".*"#, container)).unwrap(), html).unwrap_or_default();
    let mut downloads = serde_json::Map::new();
    let li_re = Regex::new(r#"(?s)<li>(.*?)</li>"#).unwrap();
    for cap in li_re.captures_iter(&region) {
        let li = &cap[1];
        let strong = first_match(&Regex::new(r#"<strong[^>]*>(.*?)</strong>"#).unwrap(), li).map(|s| text(&s)).unwrap_or_default();
        let size = first_match(&Regex::new(r#"<i[^>]*>(.*?)</i>"#).unwrap(), li).map(|s| text(&s)).unwrap_or_default();
        let mut links = Vec::new();
        let a_re = Regex::new(r#"<a\s+href="([^"]*)"[^>]*>([^<]*)</a>"#).unwrap();
        for a in a_re.captures_iter(li) {
            links.push(json!({"server": text(&a[2]), "url": a[1].to_string()}));
        }
        if !strong.is_empty() {
            downloads.insert(strong, json!({"size": size, "links": links}));
        }
    }
    downloads
}

async fn get_episode_detail(c: &reqwest::Client, endpoint: &str, episode_number: Option<&str>) -> Result<Value, (StatusCode, String)> {
    let clean = endpoint.trim().trim_matches('/');
    let target_url = if clean.starts_with("http") { clean.to_string() } else { format!("{}/episode/{}/", BASE_URL, clean) };
    let mut final_url = target_url.clone();
    let mut html = get(c, &final_url).await?;

    // AUTO-RESOLVE: slug anime → pilih episode
    if final_url.contains("/anime/") {
        let mut episodes = Vec::new();
        let ep_re = Regex::new(r#"<a\s+href="(https://[^"]*/episode/[^"]+)"[^>]*>([^<]+)</a>"#).unwrap();
        for cap in ep_re.captures_iter(&html) {
            let url = cap[1].to_string();
            episodes.push(json!({"title": text(&cap[2]), "endpoint": strip_episode_prefix(&url), "url": url}));
        }
        if episodes.is_empty() {
            return Err((StatusCode::NOT_FOUND, format!("Anime '{}' tidak memiliki episode.", clean)));
        }
        let selected = if let Some(num) = episode_number {
            let pat = Regex::new(&format!(r"(?i)\b(?:eps|episode)\s*{}\b", regex::escape(num))).unwrap();
            episodes.iter().find(|e| e.get("title").and_then(Value::as_str).map(|t| pat.is_match(t)).unwrap_or(false))
                .unwrap_or(&episodes[0])
        } else {
            &episodes[0]
        };
        final_url = selected.get("url").and_then(Value::as_str).unwrap_or("").to_string();
        html = get(c, &final_url).await?;
    }

    let page_title = first_match(&Regex::new(r#"class="posttl"[^>]*>(.*?)</"#).unwrap(), &html)
        .map(|t| text(&t))
        .filter(|t| !t.is_empty())
        .or_else(|| first_match(&Regex::new(r"(?s)<h1[^>]*>(.*?)</h1>").unwrap(), &html).map(|t| text(&t)));
    let page_title = match page_title {
        Some(t) if !t.is_empty() => t,
        _ => return Err((StatusCode::NOT_FOUND, format!("Episode '{}' tidak ditemukan atau halaman tidak valid.", endpoint))),
    };

    // Navigasi
    let mut previous_episode = Value::Null;
    let mut next_episode = Value::Null;
    let mut anime_info = Value::Null;
    let nav_re = Regex::new(r#"(?s)<a\s+href="([^"]*)"[^>]*>(.*?)</a>"#).unwrap();
    for cap in nav_re.captures_iter(&html) {
        let href = cap[1].to_string();
        let title = text(&cap[2]);
        let t = title.to_lowercase();
        if t.contains("prev") || t.contains("sebelum") {
            previous_episode = json!({"title": title, "endpoint": strip_episode_prefix(&href), "url": href});
        } else if t.contains("next") || t.contains("lanjut") {
            next_episode = json!({"title": title, "endpoint": strip_episode_prefix(&href), "url": href});
        } else if t.contains("all") || t.contains("semua") || href.contains("/anime/") {
            anime_info = json!({"title": title, "endpoint": strip_anime_prefix(&href), "url": href});
        }
    }

    // default iframe
    let default_iframe = first_match(&Regex::new(r#"(?s)class="responsive-embed-stream"[^>]*>.*?<iframe[^>]*src="([^"]*)""#).unwrap(), &html)
        .filter(|s| !s.is_empty())
        .map(Value::String)
        .unwrap_or(Value::Null);

    // nonce + stream action
    let (nonce_action, stream_action) = extract_nonce_actions(&html);

    // ambil nonce via admin-ajax
    let mut nonce = String::new();
    let resp = c.post(format!("{}/wp-admin/admin-ajax.php", BASE_URL))
        .header("Referer", &final_url)
                    .header("X-Requested-With", "XMLHttpRequest")
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        .body(format!("action={}", nonce_action))
        .send().await;
    if let Ok(r) = resp {
        if let Ok(j) = r.json::<Value>().await {
            nonce = j.pointer("/data").and_then(Value::as_str).unwrap_or("").to_string();
        }
    }

    // mirrors: .mirrorstream <ul class="m480"> dll
    let mut mirrors = serde_json::Map::new();
    let ul_re = Regex::new(r#"(?s)<ul\s+class="m([^"]*)">(.*?)</ul>"#).unwrap();
    let mut mirror_futs: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for cap in ul_re.captures_iter(&html) {
        let quality = cap[1].trim().to_string();
        if quality.is_empty() {
            continue;
        }
        let ul = &cap[2];
        let mut items: Vec<(String, String)> = Vec::new();
        let a_re = Regex::new(r#"(?s)<a[^>]*data-content="([^"]*)"[^>]*>(.*?)</a>"#).unwrap();
        for a in a_re.captures_iter(ul) {
            let server_name = text(&a[2]);
            items.push((server_name, html_decode(&a[1])));
        }
        mirror_futs.push((quality, items));
    }
    for (quality, items) in mirror_futs {
        let resolved = resolve_mirrors(c, &final_url, &nonce, &stream_action, &quality, &items).await;
        mirrors.insert(quality, json!(resolved));
    }

    let downloads = parse_downloads(&html, "download");

    Ok(json!({
        "title": page_title,
        "default_iframe": default_iframe,
        "previous_episode": previous_episode,
        "next_episode": next_episode,
        "anime_info": anime_info,
        "mirrors": mirrors,
        "downloads": downloads,
    }))
}

async fn get_batch_detail(c: &reqwest::Client, endpoint: &str) -> Result<Value, (StatusCode, String)> {
    let clean = endpoint.trim().trim_matches('/');
    let url = if clean.starts_with("http") { clean.to_string() } else { format!("{}/batch/{}/", BASE_URL, clean) };
    let html = get(c, &url).await?;
    let title = first_match(&Regex::new(r"(?s)<h1[^>]*>(.*?)</h1>").unwrap(), &html)
        .map(|t| text(&t))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| first_match(&Regex::new(r#"class="batchlink"[^>]*>\s*<h4[^>]*>(.*?)</h4>"#).unwrap(), &html).map(|t| text(&t)).unwrap_or_default());
    let downloads = parse_downloads(&html, "batchlink");
    // batchlink li: strong = format
    let mut formatted = serde_json::Map::new();
    let li_re = Regex::new(r#"(?s)<li>(.*?)</li>"#).unwrap();
    let region = first_match(&Regex::new(r#"(?s)class="batchlink".*"#).unwrap(), &html).unwrap_or_default();
    for cap in li_re.captures_iter(&region) {
        let li = &cap[1];
        let format = first_match(&Regex::new(r#"<strong[^>]*>(.*?)</strong>"#).unwrap(), li).map(|s| text(&s)).unwrap_or_default();
        let mut links = Vec::new();
        let a_re = Regex::new(r#"<a\s+href="([^"]*)"[^>]*>([^<]*)</a>"#).unwrap();
        for a in a_re.captures_iter(li) {
            links.push(json!({"server": text(&a[2]), "url": a[1].to_string()}));
        }
        if !format.is_empty() {
            formatted.insert(format, json!({"links": links}));
        }
    }
    let _ = downloads;
    Ok(json!({"title": title, "downloads": formatted}))
}

async fn get_genre_list(c: &reqwest::Client) -> Result<Vec<Value>, (StatusCode, String)> {
    let html = get(c, &format!("{}/genre-list/", BASE_URL)).await?;
    let mut genres = Vec::new();
    let a_re = Regex::new(r#"(?s)<a\s+href="([^"]*/genres/[^"]*)"[^>]*>([^<]+)</a>"#).unwrap();
    for cap in a_re.captures_iter(&html) {
        let url = cap[1].to_string();
        let name = text(&cap[2]);
        let endpoint = url.replace(&format!("{}/genres/", BASE_URL), "").trim_end_matches('/').to_string();
        if !name.is_empty() {
            genres.push(json!({"name": name, "endpoint": endpoint, "url": url}));
        }
    }
    Ok(genres)
}

async fn get_anime_by_genre(c: &reqwest::Client, genre: &str, page: u32) -> Result<Value, (StatusCode, String)> {
    let clean = genre.trim().trim_start_matches("/genres/").trim_matches('/');
    let url = if page > 1 {
        format!("{}/genres/{}/page/{}/", BASE_URL, clean, page)
    } else {
        format!("{}/genres/{}/", BASE_URL, clean)
    };
    let html = get(c, &url).await?;
    let mut anime = Vec::new();
    let card_re = Regex::new(r#"(?s)<div\s+class="col-anime[^"]*">.*?</div>\s*</div>\s*</div>"#).unwrap();
    for m in card_re.find_iter(&html) {
        let block = m.as_str();
        let title_url = Regex::new(r#"class="col-anime-title"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>(.*?)</a>"#).unwrap()
            .captures(block);
        let Some(tu) = title_url else { continue };
        let url = tu[1].to_string();
        let title = text(&tu[2]);
        let studio = first_match(&Regex::new(r#"class="col-anime-studio"[^>]*>(.*?)</"#).unwrap(), block).map(|s| text(&s)).unwrap_or_default();
        let episodes = first_match(&Regex::new(r#"class="col-anime-eps"[^>]*>([^<]*)<"#).unwrap(), block).map(|s| s.trim().to_string()).unwrap_or_default();
        let score = first_match(&Regex::new(r#"class="col-anime-rating"[^>]*>([^<]*)<"#).unwrap(), block).map(|s| s.trim().to_string()).unwrap_or_default();
        let thumb = first_match(&Regex::new(r#"<img[^>]*src="([^"]*)""#).unwrap(), block).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        anime.push(json!({"title": title, "endpoint": strip_anime_prefix(&url), "url": url, "thumb": thumb, "studio": studio, "episodes": episodes, "score": score}));
    }
    Ok(json!({"genre": clean, "page": page, "anime": anime}))
}

async fn get_schedule(c: &reqwest::Client) -> Result<Vec<Value>, (StatusCode, String)> {
    let html = get(c, &format!("{}/jadwal-rilis/", BASE_URL)).await?;
    let mut schedule = Vec::new();
    let block_re = Regex::new(r#"(?s)class="kglist321".*?"#).unwrap();
    // split per kglist321 block start
    let starts: Vec<usize> = block_re.find_iter(&html).map(|m| m.start()).collect();
    for (i, s) in starts.iter().enumerate() {
        let end = starts.get(i + 1).copied().unwrap_or(html.len());
        let block = &html[*s..end];
        let day = first_match(&Regex::new(r#"(?s)<h2[^>]*>(.*?)</h2>"#).unwrap(), block).map(|t| text(&t)).unwrap_or_default();
        let mut anime = Vec::new();
        let a_re = Regex::new(r#"<a\s+href="(https://[^"]*/anime/[^"]*)"[^>]*>([^<]+)</a>"#).unwrap();
        for a in a_re.captures_iter(block) {
            let url = a[1].to_string();
            let title = text(&a[2]);
            if !title.is_empty() {
                anime.push(json!({"title": title, "endpoint": strip_anime_prefix(&url), "url": url}));
            }
        }
        if !day.is_empty() {
            schedule.push(json!({"day": day, "anime": anime}));
        }
    }
    Ok(schedule)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if !v.is_empty() {
                    return Some(v.clone());
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(s) = v.get(*k).and_then(Value::as_str) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        None
    };

    let action = get_param(&["action"]).unwrap_or_else(|| "home".to_string());
    let query_str = get_param(&["query", "q"]).unwrap_or_default();
    let page: u32 = get_param(&["page"]).and_then(|p| p.parse().ok()).unwrap_or(1);
    let episode_number = get_param(&["episode", "ep", "number"]);

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result: Result<Response, (StatusCode, String)> = async {
        Ok(match action.as_str() {
            "home" => {
                let r = get_home(&c).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            "ongoing" => {
                let r = get_ongoing(&c, page).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            "complete" => {
                let r = get_complete(&c, page).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            "search" => {
                if query_str.trim().is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' wajib untuk action=search".into()));
                }
                let list = search_anime(&c, query_str.trim()).await?;
                Json(json!({"status": true, "result": {"query": query_str.trim(), "count": list.len(), "list": list}})).into_response()
            }
            "anime_list" => {
                let list = get_anime_list(&c).await?;
                Json(json!({"status": true, "result": {"count": list.len(), "list": list}})).into_response()
            }
            "anime_detail" => {
                if query_str.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' (endpoint slug anime) wajib untuk action=anime_detail".into()));
                }
                let r = get_anime_detail(&c, &query_str).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            "episode_detail" => {
                if query_str.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' (endpoint slug episode) wajib untuk action=episode_detail".into()));
                }
                let r = get_episode_detail(&c, &query_str, episode_number.as_deref()).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            "batch_detail" => {
                if query_str.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' (endpoint slug batch) wajib untuk action=batch_detail".into()));
                }
                let r = get_batch_detail(&c, &query_str).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            "schedule" => {
                let list = get_schedule(&c).await?;
                Json(json!({"status": true, "result": {"count": list.len(), "schedule": list}})).into_response()
            }
            "genres" => {
                let list = get_genre_list(&c).await?;
                Json(json!({"status": true, "result": {"count": list.len(), "list": list}})).into_response()
            }
            "by_genre" => {
                if query_str.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' (genre) wajib untuk action=by_genre".into()));
                }
                let r = get_anime_by_genre(&c, &query_str, page).await?;
                Json(json!({"status": true, "result": r})).into_response()
            }
            _ => return Err((StatusCode::BAD_REQUEST, format!("Action tidak dikenali: '{}'", action))),
        })
    }
    .await;

    match result {
        Ok(r) => r,
        Err((status, msg)) => err(status, &msg),
    }
}

// BacaKomik — native conversion of api/search/bacakomik.js
// Scraping bacakomik.my: actions search, latest, popular, directory, genres,
// genre, detail (komik/chapter), chapter (reader images).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://bacakomik.my";
const ALLOWED_HOST: &str = "bacakomik.my";
const ACTIONS: [&str; 8] = ["search", "latest", "popular", "directory", "genres", "genre", "detail", "chapter"];

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36")
        .default_headers(reqwest::header::HeaderMap::from_iter([
            ("Accept".parse().unwrap(), "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8".parse().unwrap()),
            ("Accept-Language".parse().unwrap(), "id,en-US;q=0.7,en;q=0.3".parse().unwrap()),
        ]))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_html(c: &reqwest::Client, url: &str) -> Result<String, String> {
    let res = c.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Gagal memuat URL (Status {})", res.status().as_u16()));
    }
    res.text().await.map_err(|e| e.to_string())
}

fn normalize_url(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    if url.starts_with("//") {
        return format!("https:{}", url);
    }
    if url.starts_with('/') {
        return format!("{}{}", BASE_URL, url);
    }
    format!("{}/{}", BASE_URL, url)
}

fn ensure_allowed(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.replace("www.", "").to_lowercase()))
        .map(|h| h == ALLOWED_HOST || h.ends_with(&format!(".{}", ALLOWED_HOST)))
        .unwrap_or(false)
}

fn sel(s: &str) -> scraper::Selector {
    scraper::Selector::parse(s).unwrap_or_else(|_| scraper::Selector::parse("body").unwrap())
}

fn text_trim(el: scraper::ElementRef) -> String {
    el.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn img_src_fix(el: scraper::ElementRef) -> String {
    let mut src = el
        .value()
        .attr("data-lazy-src")
        .or_else(|| el.value().attr("src"))
        .unwrap_or("")
        .to_string();
    if src.is_empty() || src.starts_with("data:") {
        let onerror = el.value().attr("onerror").unwrap_or("");
        if let Some(c) = regex::Regex::new(r"(?i)this\.src='([^']+)'").unwrap().captures(onerror) {
            src = c[1].to_string();
        }
    }
    src
}

fn parse_manga_cards(doc: &scraper::Html) -> Vec<Value> {
    let mut results = Vec::new();
    for item in doc.select(&sel(".animposx")) {
        let link_el = item.select(&sel("a")).next();
        let href = normalize_url(link_el.and_then(|a| a.value().attr("href")).unwrap_or(""));
        let title = item
            .select(&sel(".tt h4"))
            .next()
            .map(text_trim)
            .filter(|t| !t.is_empty())
            .or_else(|| item.select(&sel(".tt")).next().map(text_trim))
            .or_else(|| link_el.and_then(|a| a.value().attr("title")).map(str::to_string))
            .unwrap_or_default();

        let thumbnail = normalize_url(&item.select(&sel("img")).next().map(img_src_fix).unwrap_or_default());

        let mut typ = String::new();
        if let Some(type_el) = item.select(&sel(".typeflag")).next() {
            let cls = type_el.value().attr("class").unwrap_or("");
            if let Some(c) = regex::Regex::new(r"(?i)typeflag\s+([A-Za-z]+)").unwrap().captures(cls) {
                typ = c[1].to_string();
            } else {
                typ = type_el.parent().and_then(|p| scraper::ElementRef::wrap(p)).map(text_trim).unwrap_or_default();
            }
        }
        if typ.is_empty() {
            typ = item.select(&sel(".type")).next().map(text_trim).unwrap_or_default();
            if typ.is_empty() {
                typ = "Manga".to_string();
            }
        }

        let is_color = item.select(&sel(".warnalabel, .fa-palette")).next().is_some()
            || item.text().collect::<String>().contains("Warna");
        let is_hot = item.select(&sel(".hot")).next().is_some();

        let score = item
            .select(&sel(".fa-star"))
            .next()
            .and_then(|s| s.parent())
            .and_then(scraper::ElementRef::wrap)
            .map(|p| regex::Regex::new(r"[^0-9.]").unwrap().replace_all(&p.text().collect::<String>(), "").trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| item.select(&sel(".rating i")).next().map(|e| text_trim(e)))
            .or_else(|| item.select(&sel(".score")).next().map(|e| text_trim(e)))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "N/A".to_string());

        let views = item
            .select(&sel(".fa-eye"))
            .next()
            .and_then(|s| s.parent())
            .and_then(scraper::ElementRef::wrap)
            .map(|p| text_trim(p))
            .unwrap_or_default();

        let mut card_chapters = Vec::new();
        for lsch in item.select(&sel(".lsch")) {
            let a = lsch.select(&sel("a")).next();
            let ch_title = a.map(|a| text_trim(a)).unwrap_or_default();
            let ch_url = normalize_url(a.and_then(|a| a.value().attr("href")).unwrap_or(""));
            let date = lsch.select(&sel(".datech")).next().map(|d| text_trim(d)).unwrap_or_default();
            if !ch_title.is_empty() && !ch_url.is_empty() {
                card_chapters.push(json!({"title": ch_title, "url": ch_url, "released": if date.is_empty() { "N/A".to_string() } else { date }}));
            }
        }

        if !title.is_empty() && !href.is_empty() {
            let mut obj = json!({
                "title": title,
                "url": href,
                "thumbnail": thumbnail,
                "type": typ,
                "color": if is_color { "Color" } else { "Black & White" },
                "isHot": is_hot,
                "score": score,
                "latestChapter": card_chapters.first().cloned().unwrap_or(Value::Null),
                "recentChapters": card_chapters,
            });
            if !views.is_empty() {
                obj.as_object_mut().unwrap().insert("views".into(), json!(views));
            }
            results.push(obj);
        }
    }
    results
}

async fn enrich(client: &reqwest::Client, mut list: Vec<Value>, limit: usize) -> Vec<Value> {
    for item in list.iter_mut().take(limit) {
        let Some(url) = item.get("url").and_then(Value::as_str).map(str::to_string) else { continue };
        let Ok(html) = fetch_html(client, &url).await else { continue };
        let doc = scraper::Html::parse_document(&html);

        let first_a = doc.select(&sel(".lchx a")).next();
        let last_a = doc.select(&sel(".lchx a")).last();
        let total_ch = doc.select(&sel("#chapter_list li")).count().max(doc.select(&sel(".lchx a")).count());

        let mut status = String::new();
        let mut author = String::new();
        for sp in doc.select(&sel(".infox .spe span")) {
            let t = text_trim(sp);
            let tl = t.to_lowercase();
            if tl.starts_with("status") {
                status = t.split(':').nth(1).map(|s| s.trim().to_string()).unwrap_or_default();
            }
            if tl.starts_with("author") {
                author = t.split(':').nth(1).map(|s| s.trim().to_string()).unwrap_or_default();
            }
        }
        let score_detail = doc
            .select(&sel("[itemprop=\"ratingValue\"]"))
            .next()
            .map(|e| text_trim(e))
            .unwrap_or_default();

        if let Some(o) = item.as_object_mut() {
            if let Some(a) = first_a {
                o.insert("latestChapter".into(), json!({
                    "title": text_trim(a),
                    "url": normalize_url(a.value().attr("href").unwrap_or("")),
                }));
            }
            if let Some(a) = last_a {
                o.insert("firstChapter".into(), json!({
                    "title": text_trim(a),
                    "url": normalize_url(a.value().attr("href").unwrap_or("")),
                }));
            }
            if total_ch > 0 {
                o.insert("totalChapters".into(), json!(total_ch));
            }
            if !status.is_empty() {
                o.insert("status".into(), json!(status));
            }
            if !author.is_empty() {
                o.insert("author".into(), json!(author));
            }
            if o.get("score").and_then(Value::as_str) == Some("N/A") && !score_detail.is_empty() {
                o.insert("score".into(), json!(score_detail));
            }
        }
    }
    list
}

async fn get_manga_detail(client: &reqwest::Client, input_url: &str) -> Result<Value, String> {
    if !ensure_allowed(input_url) {
        return Err("URL harus dari domain bacakomik.my".into());
    }
    let target_url = normalize_url(input_url);
    let mut html = fetch_html(client, &target_url).await?;
    let mut is_chapter_page = false;
    let mut chapter_images_list: Vec<String> = Vec::new();
    let mut parent_manga_url = target_url.clone();

    let is_ch = !target_url.contains("/komik/")
        && (target_url.contains("-chapter-") || target_url.contains("/ch-") || regex::Regex::new(r"(?i)-chapter-\d+").unwrap().is_match(&target_url));

    if is_ch {
        is_chapter_page = true;
        for img in scraper::Html::parse_document(&html).select(&sel("img")) {
            let mut src = img_src_fix(img);
            if !src.is_empty() && !src.starts_with("data:") && !src.contains("wp-content/uploads") {
                chapter_images_list.push(normalize_url(&src));
            }
            let _ = &mut src;
        }
        chapter_images_list.sort();
        chapter_images_list.dedup();

        let parent_link = scraper::Html::parse_document(&html)
            .select(&sel("a[href*=\"/komik/\"]"))
            .next()
            .and_then(|a| a.value().attr("href"))
            .map(str::to_string);
        if let Some(pl) = parent_link {
            parent_manga_url = normalize_url(&pl);
            html = fetch_html(client, &parent_manga_url).await?;
        }
    }

    let doc = scraper::Html::parse_document(&html);
    let raw_title = doc
        .select(&sel(".entry-title"))
        .next()
        .map(|e| e.text().collect::<String>())
        .or_else(|| doc.select(&sel("h1")).next().map(|e| e.text().collect::<String>()))
        .unwrap_or_default();
    let title = regex::Regex::new(r"(?i)^Komik\s+").unwrap().replace_all(&raw_title, "").split_whitespace().collect::<Vec<_>>().join(" ");

    let thumbnail = normalize_url(&doc.select(&sel(".thumb img")).next().map(img_src_fix).unwrap_or_default());
    let synopsis = doc
        .select(&sel(".desc, .sinopsis, .entry-content-single, .entry-content"))
        .next()
        .map(|e| e.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    let score = doc
        .select(&sel("[itemprop=\"ratingValue\"]"))
        .next()
        .map(|e| text_trim(e))
        .filter(|s| !s.is_empty())
        .or_else(|| doc.select(&sel(".rating strong")).next().map(|e| regex::Regex::new(r"[^0-9.]").unwrap().replace_all(&e.text().collect::<String>(), "").trim().to_string()).filter(|s| !s.is_empty()))
        .or_else(|| doc.select(&sel(".rating-prc")).next().map(|e| text_trim(e)))
        .unwrap_or_else(|| "N/A".to_string());

    let mut info = serde_json::Map::new();
    for sp in doc.select(&sel(".infox .spe span")) {
        let text = sp.text().collect::<String>().trim().to_string();
        if text.contains(':') {
            let mut parts = text.splitn(2, ':');
            let k = parts.next().unwrap_or("").trim().to_string();
            let v = parts.next().unwrap_or("").trim().to_string();
            info.insert(k, json!(v));
        }
    }
    let get_info = |k: &str, default: &str| info.get(k).cloned().unwrap_or(json!(default));

    let mut genres = Vec::new();
    for a in doc.select(&sel(".genre-info a, .genres-container a, a[href*=\"/genres/\"]")) {
        let g = text_trim(a);
        if !g.is_empty() && !genres.iter().any(|v: &Value| v.as_str() == Some(&g)) {
            genres.push(json!(g));
        }
    }

    let mut spoilers = Vec::new();
    for img in doc.select(&sel("img[alt*=\"Spoiler\"], img[title*=\"Spoiler\"], .spoiler img")) {
        let src = img_src_fix(img);
        if !src.is_empty() && !src.starts_with("data:") && !src.contains("wp-content/uploads") {
            spoilers.push(json!(normalize_url(&src)));
        }
    }
    spoilers.sort_by(|a, b| a.to_string().cmp(&b.to_string()));
    spoilers.dedup_by(|a, b| a == b);

    let mut similar = Vec::new();
    for el in doc.select(&sel(".mirip li, #mirip li, .similarmanga li")) {
        let sim_link = el.select(&sel("a")).next();
        let sim_title = el.select(&sel("h4")).next().map(text_trim).filter(|t| !t.is_empty())
            .or_else(|| sim_link.and_then(|a| a.value().attr("title")).map(str::to_string))
            .or_else(|| sim_link.map(|a| text_trim(a)))
            .unwrap_or_default();
        let sim_url = normalize_url(sim_link.and_then(|a| a.value().attr("href")).unwrap_or(""));
        let sim_thumb = normalize_url(&el.select(&sel("img")).next().map(img_src_fix).unwrap_or_default());
        if !sim_title.is_empty() && !sim_url.is_empty() {
            similar.push(json!({"title": sim_title, "url": sim_url, "thumbnail": sim_thumb}));
        }
    }

    let mut chapters = Vec::new();
    for el in doc.select(&sel("#chapter_list li, .chapter-list li, ul.clstyle li")) {
        let link = el.select(&sel(".lchx a, a")).next();
        let ch_url = normalize_url(link.and_then(|a| a.value().attr("href")).unwrap_or(""));
        let ch_title = link.map(|a| text_trim(a)).unwrap_or_default();
        let date = el.select(&sel(".dt, .chapterdate")).next().map(|d| text_trim(d)).unwrap_or_default();
        if !ch_url.is_empty() && !ch_title.is_empty() {
            chapters.push(json!({"title": ch_title, "url": ch_url, "released": if date.is_empty() { "N/A".to_string() } else { date }}));
        }
    }
    if chapters.is_empty() {
        for a in doc.select(&sel("a[href*=\"-chapter-\"], a[href*=\"/ch-\"]")) {
            let ch_url = normalize_url(a.value().attr("href").unwrap_or(""));
            let ch_title = text_trim(a);
            if !ch_url.is_empty() && !ch_title.is_empty() && !chapters.iter().any(|c| c.get("url").and_then(Value::as_str) == Some(&ch_url)) {
                chapters.push(json!({"title": ch_title, "url": ch_url, "released": "N/A"}));
            }
        }
    }

    let mut result = json!({
        "title": title,
        "url": parent_manga_url,
        "thumbnail": thumbnail,
        "score": score,
        "status": get_info("Status", "Unknown"),
        "type": get_info("Jenis Komik", "Manga"),
        "author": get_info("Author", "N/A"),
        "artist": get_info("Artis", "N/A"),
        "releasedYear": get_info("Rilis", "N/A"),
        "serialization": get_info("Serialisasi", "N/A"),
        "readersCount": get_info("Jumlah Pembaca", "N/A"),
        "alternativeTitle": get_info("Judul Alternatif", "N/A"),
        "synopsis": synopsis,
        "genres": genres,
        "spoilers": spoilers,
        "similarManga": similar,
        "totalChapters": chapters.len(),
        "firstChapter": chapters.last().cloned().unwrap_or(Value::Null),
        "latestChapter": chapters.first().cloned().unwrap_or(Value::Null),
        "chapters": chapters,
    });
    if target_url != parent_manga_url {
        result.as_object_mut().unwrap().insert("originalInputUrl".into(), json!(target_url));
    }
    if is_chapter_page && !chapter_images_list.is_empty() {
        result.as_object_mut().unwrap().insert("chapterImages".into(), json!({
            "chapterUrl": target_url,
            "totalImages": chapter_images_list.len(),
            "images": chapter_images_list,
        }));
    }

    Ok(json!({
        "status": "success",
        "action": "detail",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": result,
    }))
}

async fn get_chapter_images(client: &reqwest::Client, chapter_url: &str) -> Result<Value, String> {
    if !ensure_allowed(chapter_url) {
        return Err("URL harus dari domain bacakomik.my".into());
    }
    let target_url = normalize_url(chapter_url);
    let html = fetch_html(client, &target_url).await?;
    let doc = scraper::Html::parse_document(&html);

    let raw_title = doc
        .select(&sel(".entry-title, h1"))
        .next()
        .map(|e| e.text().collect::<String>())
        .unwrap_or_default();
    let title = regex::Regex::new(r"(?i)^Komik\s+").unwrap().replace_all(&raw_title, "").split_whitespace().collect::<Vec<_>>().join(" ");

    let manga_link = normalize_url(&doc.select(&sel(".allc a, a[href*=\"/komik/\"]")).next().and_then(|a| a.value().attr("href")).unwrap_or(""));

    let reader_sel = sel("#anjay_ini_id_kh img, #chimg-besarge img, #readerarea img, img");
    let mut images: Vec<String> = Vec::new();
    for img in doc.select(&sel("img")) {
        let mut src = img.value().attr("data-lazy-src").unwrap_or("").to_string();
        if src.is_empty() || src.starts_with("data:") {
            let onerror = img.value().attr("onerror").unwrap_or("");
            if let Some(c) = regex::Regex::new(r"(?i)this\.src='([^']+)'").unwrap().captures(onerror) {
                src = c[1].to_string();
            }
        }
        if src.is_empty() || src.starts_with("data:") {
            src = img.value().attr("src").unwrap_or("").to_string();
        }
        let in_reader = {
            let mut inside = false;
            let mut anc = img.parent();
            while let Some(a) = anc {
                let id = a.value().as_element().and_then(|e| e.attr("id")).unwrap_or("");
                if ["anjay_ini_id_kh", "chimg-besarge", "readerarea"].contains(&id) {
                    inside = true;
                    break;
                }
                anc = a.parent();
            }
            inside
        };
        if !src.is_empty()
            && !src.starts_with("data:")
            && !src.contains("wp-content/uploads")
            && (src.contains("/data/") || in_reader)
        {
            images.push(normalize_url(&src));
        }
    }
    let _ = reader_sel;
    images.sort();
    images.dedup();
    let unique_images = images;

    let mut prev_url = String::new();
    let mut next_url = String::new();
    for a in doc.select(&sel(".nextprev a, a[rel=\"prev\"], a[rel=\"next\"]")) {
        let txt = text_trim(a);
        let href = a.value().attr("href").unwrap_or("").to_string();
        let rel = a.value().attr("rel").unwrap_or("");
        if txt.contains("Sebelum") || rel == "prev" {
            if prev_url.is_empty() {
                prev_url = href.clone();
            }
        }
        if txt.contains("Selanjutnya") || rel == "next" {
            if next_url.is_empty() {
                next_url = href;
            }
        }
    }

    Ok(json!({
        "status": "success",
        "action": "chapter_images",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": {
            "title": title,
            "url": target_url,
            "mangaUrl": if manga_link.is_empty() { Value::Null } else { json!(manga_link) },
            "totalImages": unique_images.len(),
            "images": unique_images,
            "navigation": {
                "hasPrev": !prev_url.is_empty(),
                "prev": if prev_url.is_empty() { Value::Null } else { json!(normalize_url(&prev_url)) },
                "hasNext": !next_url.is_empty(),
                "next": if next_url.is_empty() { Value::Null } else { json!(normalize_url(&next_url)) },
            },
        },
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

    let cmd = get_param("action").unwrap_or_else(|| "search".to_string()).to_lowercase();
    let q = get_param("query").unwrap_or_default();
    let url_param = get_param("url").unwrap_or_default();
    let page_num: i64 = get_param("page").and_then(|p| p.parse().ok()).unwrap_or(1).max(1);

    if !ACTIONS.contains(&cmd.as_str()) {
        return err(
            StatusCode::BAD_REQUEST,
            &format!("Action tidak dikenal: {} (tersedia: {})", cmd, ACTIONS.join(", ")),
        );
    }

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result = async {
        match cmd.as_str() {
            "search" => {
                if q.trim().is_empty() {
                    return Err(("400".to_string(), "Parameter 'query' wajib diisi untuk action=search".to_string()));
                }
                let html = fetch_html(&c, &format!("{}/page/{}/?s={}", BASE_URL, page_num, urlencoding::encode(&q.trim().to_lowercase()))).await.map_err(|e| ("500".to_string(), e))?;
                let list = parse_manga_cards(&scraper::Html::parse_document(&html));
                let list = enrich(&c, list, 10).await;
                Ok(json!({"action": "search", "data": {"query": q, "page": page_num, "totalResults": list.len(), "results": list}}))
            }
            "latest" => {
                let html = fetch_html(&c, &format!("{}/komik-terbaru/page/{}/", BASE_URL, page_num)).await.map_err(|e| ("500".to_string(), e))?;
                let list = parse_manga_cards(&scraper::Html::parse_document(&html));
                let list = enrich(&c, list, 10).await;
                Ok(json!({"action": "latest", "data": {"page": page_num, "totalResults": list.len(), "results": list}}))
            }
            "popular" => {
                let html = fetch_html(&c, &format!("{}/komik-populer/", BASE_URL)).await.map_err(|e| ("500".to_string(), e))?;
                let list = parse_manga_cards(&scraper::Html::parse_document(&html));
                let total = list.len();
                let list = enrich(&c, list, total).await;
                Ok(json!({"action": "popular", "data": {"totalResults": list.len(), "results": list}}))
            }
            "directory" => {
                let html = fetch_html(&c, &format!("{}/daftar-komik/page/{}/", BASE_URL, page_num)).await.map_err(|e| ("500".to_string(), e))?;
                let list = parse_manga_cards(&scraper::Html::parse_document(&html));
                let list = enrich(&c, list, 10).await;
                Ok(json!({"action": "directory", "data": {"page": page_num, "totalResults": list.len(), "results": list}}))
            }
            "genres" => {
                let html = fetch_html(&c, &format!("{}/daftar-genre/", BASE_URL)).await.map_err(|e| ("500".to_string(), e))?;
                let doc = scraper::Html::parse_document(&html);
                let mut genres: Vec<Value> = Vec::new();
                for a in doc.select(&sel("a[href*=\"/genres/\"]")) {
                    let name = text_trim(a);
                    let href = normalize_url(a.value().attr("href").unwrap_or(""));
                    let slug = regex::Regex::new(r"/genres/([^/]+)").unwrap().captures(&href).and_then(|cm| cm.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
                    if !name.is_empty() && !href.is_empty() && !genres.iter().any(|g| g.get("name").and_then(Value::as_str).map(|n| n.eq_ignore_ascii_case(&name)).unwrap_or(false)) {
                        genres.push(json!({"name": name, "slug": slug, "url": href}));
                    }
                }
                Ok(json!({"action": "genres", "data": {"totalGenres": genres.len(), "genres": genres}}))
            }
            "genre" => {
                if q.trim().is_empty() {
                    return Err(("400".to_string(), "Parameter 'query' wajib diisi (slug genre) untuk action=genre".to_string()));
                }
                let html = fetch_html(&c, &format!("{}/genres/{}/page/{}/", BASE_URL, urlencoding::encode(&q.trim().to_lowercase()), page_num)).await.map_err(|e| ("500".to_string(), e))?;
                let list = parse_manga_cards(&scraper::Html::parse_document(&html));
                let list = enrich(&c, list, 10).await;
                Ok(json!({"action": "genre_manga", "data": {"genre": q.trim(), "page": page_num, "totalResults": list.len(), "results": list}}))
            }
            "detail" => {
                if url_param.trim().is_empty() {
                    return Err(("400".to_string(), "Parameter 'url' wajib diisi untuk action=detail".to_string()));
                }
                let out = get_manga_detail(&c, url_param.trim()).await.map_err(|e| ("500".to_string(), e))?;
                Ok(out)
            }
            _ => {
                if url_param.trim().is_empty() {
                    return Err(("400".to_string(), "Parameter 'url' wajib diisi untuk action=chapter".to_string()));
                }
                let out = get_chapter_images(&c, url_param.trim()).await.map_err(|e| ("500".to_string(), e))?;
                Ok(out)
            }
        }
    }
    .await;

    match result {
        Ok(mut obj) => {
            if let Some(o) = obj.as_object_mut() {
                o.entry("status").or_insert(json!(true));
                o.insert("status".into(), json!(true));
                o.entry("timestamp").or_insert_with(|| json!(chrono::Utc::now().to_rfc3339()));
            }
            Json(obj).into_response()
        }
        Err((code, msg)) => {
            let status = if code == "400" { StatusCode::BAD_REQUEST } else { StatusCode::INTERNAL_SERVER_ERROR };
            err(status, &msg)
        }
    }
}

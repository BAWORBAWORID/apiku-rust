// Goal.com — native conversion of api/search/goal.js
// Scraping __NEXT_DATA__ goal.com: actions latest, transfers, search, article.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://www.goal.com";
const ACTIONS: [&str; 4] = ["latest", "transfers", "search", "article"];

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn clean_text(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    text.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#x27;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn deduplicate_news(news: Vec<Value>) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for item in news {
        let key = item
            .get("url")
            .or_else(|| item.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if !key.is_empty() && seen.insert(key) {
            result.push(item);
        }
    }
    result
}

fn absolutize(url: Option<&str>) -> Value {
    match url {
        Some(u) if !u.is_empty() => json!(if u.starts_with('/') { format!("{}{}", BASE_URL, u) } else { u.to_string() }),
        _ => Value::Null,
    }
}

async fn fetch_next_data(client: &reqwest::Client, path: &str) -> Result<Value, String> {
    let url = if path.starts_with("http") { path.to_string() } else { format!("{}{}", BASE_URL, path) };
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().as_u16() != 200 {
        return Err(format!("Gagal terhubung ke Goal.com (HTTP {})", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    let re = regex::Regex::new(r#"<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>"#).unwrap();
    let m = re.captures(&html).ok_or("Gagal mengekstrak data internal Goal.com")?;
    serde_json::from_str(m[1].trim()).map_err(|e| e.to_string())
}

fn collect_cards<'a>(content: &'a Value) -> Vec<&'a Vec<Value>> {
    let mut groups = Vec::new();
    fn push<'a>(v: Option<&'a Value>, groups: &mut Vec<&'a Vec<Value>>) {
        if let Some(arr) = v.and_then(Value::as_array) {
            if !arr.is_empty() {
                groups.push(arr);
            }
        }
    }
    push(content.pointer("/newsArchive/news/cards"), &mut groups);
    push(content.pointer("/news/cards"), &mut groups);
    push(content.get("cards"), &mut groups);
    if let Some(elems) = content.get("elements").and_then(Value::as_array) {
        for elem in elems {
            push(elem.pointer("/content/cards"), &mut groups);
        }
    }
    if !groups.is_empty() {
        return groups;
    }
    // deep walk
    let mut deep: Vec<&Value> = Vec::new();
    fn walk<'a>(node: &'a Value, deep: &mut Vec<&'a Value>) {
        match node {
            Value::Array(arr) => arr.iter().for_each(|v| walk(v, deep)),
            Value::Object(_) => {
                if node.get("title").is_some() && (node.get("url").is_some() || node.get("teaser").is_some()) {
                    deep.push(node);
                    return;
                }
                if let Value::Object(map) = node {
                    map.values().for_each(|v| walk(v, deep));
                }
            }
            _ => {}
        }
    }
    walk(content, &mut deep);
    // convert &Value to &Vec<Value> is not possible; wrap by leaking-free approach:
    // deep items are collected as Values below instead.
    // Fallback: return empty and let caller handle via deep_collect.
    Vec::new()
}

fn deep_collect_cards(content: &Value) -> Vec<Value> {
    let mut deep = Vec::new();
    fn walk(node: &Value, deep: &mut Vec<Value>) {
        match node {
            Value::Array(arr) => arr.iter().for_each(|v| walk(v, deep)),
            Value::Object(_) => {
                if node.get("title").is_some() && (node.get("url").is_some() || node.get("teaser").is_some()) {
                    deep.push(node.clone());
                    return;
                }
                if let Value::Object(map) = node {
                    map.values().for_each(|v| walk(v, deep));
                }
            }
            _ => {}
        }
    }
    walk(content, &mut deep);
    deep
}

fn map_card(c: &Value, lang: &str) -> Value {
    let img = c
        .pointer("/image/url")
        .or_else(|| c.pointer("/squareImage/url"))
        .and_then(Value::as_str)
        .map(|s| s.replace("&amp;", "&"));
    let tag = c.pointer("/tags/primaryTag/name").and_then(Value::as_str);
    json!({
        "title": clean_text(c.get("title").and_then(Value::as_str).unwrap_or("")),
        "url": absolutize(c.get("url").and_then(Value::as_str)),
        "teaser": clean_text(c.get("teaser").and_then(Value::as_str).unwrap_or("")),
        "tag": tag.map(clean_text),
        "publishTime": c.get("publishTime").cloned().unwrap_or(Value::Null),
        "commentCount": c.get("commentCount").cloned().unwrap_or(Value::Null),
        "image": img,
        "lang": lang,
    })
}

async fn get_home(client: &reqwest::Client, lang: &str) -> Result<Value, String> {
    let json = fetch_next_data(client, &format!("/{}", lang)).await?;
    let empty = json!({});
    let content = json.pointer("/props/pageProps/content").unwrap_or(&empty);

    let mut most_read = Vec::new();
    if let Some(cards) = content.pointer("/mostRead/cards").and_then(Value::as_array) {
        for c in cards {
            let headline = c.get("headline").and_then(Value::as_str);
            let slug = c.pointer("/link/slug").and_then(Value::as_str);
            let id = c.pointer("/link/id").and_then(Value::as_str);
            if let (Some(h), Some(s), Some(i)) = (headline, slug, id) {
                most_read.push(json!({
                    "title": clean_text(h),
                    "url": format!("{}/{}/berita/{}/{}", BASE_URL, lang, s, i),
                    "views": c.get("viewsCount").cloned().unwrap_or(json!(0)),
                }));
            }
        }
    }

    let mut news_feed = Vec::new();
    let direct = collect_cards(content);
    if direct.is_empty() {
        for c in deep_collect_cards(content) {
            if c.get("title").is_some() {
                news_feed.push(map_card(&c, lang));
            }
        }
    } else {
        for cards in direct {
            for c in cards {
                if c.get("title").is_some() {
                    news_feed.push(map_card(c, lang));
                }
            }
        }
    }

    let feed = deduplicate_news(news_feed);
    Ok(json!({
        "status": true,
        "language": lang,
        "mostRead": deduplicate_news(most_read),
        "totalNews": feed.len(),
        "newsFeed": feed,
    }))
}

async fn get_transfers(client: &reqwest::Client, lang: &str) -> Result<Value, String> {
    let json = fetch_next_data(client, &format!("/{}/kategori/transfers/1/k94w8e1yy9ch14mllpf4srnks", lang)).await?;
    let empty = json!({});
    let content = json.pointer("/props/pageProps/content").unwrap_or(&empty);

    let mut transfers = Vec::new();
    let direct = collect_cards(content);
    if direct.is_empty() {
        for c in deep_collect_cards(content) {
            if c.get("title").is_some() {
                transfers.push(map_card(&c, lang));
            }
        }
    } else {
        for cards in direct {
            for c in cards {
                if c.get("title").is_some() {
                    transfers.push(map_card(c, lang));
                }
            }
        }
    }

    let unique = deduplicate_news(transfers);
    Ok(json!({"status": true, "lang": lang, "total": unique.len(), "transfers": unique}))
}

fn score_match(item: &Value, q: &str) -> i32 {
    let title = item.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let teaser = item.get("teaser").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let tag = item.get("tag").and_then(Value::as_str).unwrap_or("").to_lowercase();

    if title.contains(q) {
        return if title == q || title.starts_with(q) || title.contains(&format!(" {} ", q)) { 30 } else { 20 };
    }
    if tag.contains(q) {
        return 5;
    }
    if teaser.contains(q) {
        return 1;
    }
    0
}

async fn search_news(client: &reqwest::Client, query: &str, lang: &str) -> Result<Value, String> {
    if query.trim().is_empty() {
        return Err("Kata kunci pencarian tidak boleh kosong!".into());
    }
    let q = query.to_lowercase().trim().to_string();

    let mut sections = Vec::new();
    let home = get_home(client, lang).await?;
    if let Some(feed) = home.get("newsFeed").and_then(Value::as_array) {
        sections.extend(feed.clone());
    }
    if let Some(mr) = home.get("mostRead").and_then(Value::as_array) {
        sections.extend(mr.clone());
    }
    if let Ok(transfers) = get_transfers(client, lang).await {
        if let Some(t) = transfers.get("transfers").and_then(Value::as_array) {
            sections.extend(t.clone());
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut scored: Vec<(i32, Value)> = Vec::new();
    for item in sections {
        let key = item.get("url").or_else(|| item.get("title")).and_then(Value::as_str).unwrap_or("").to_string();
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        let score = score_match(&item, &q);
        if score <= 0 {
            continue;
        }
        let mut obj = item;
        if let Some(o) = obj.as_object_mut() {
            o.insert("score".into(), json!(score));
        }
        scored.push((score, obj));
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    let results: Vec<Value> = scored.into_iter().map(|(_, v)| v).collect();

    Ok(json!({
        "status": true,
        "query": query,
        "scope": "goal.com news archive (homepage + transfers + most read)",
        "note": "Goal.com tidak menyediakan endpoint search publik; hasil di-rank dari arsip berita.",
        "totalResults": results.len(),
        "results": results,
    }))
}

async fn get_article(client: &reqwest::Client, article_url: &str) -> Result<Value, String> {
    if article_url.is_empty() || !article_url.contains("goal.com") {
        return Err("URL artikel Goal.com tidak valid!".into());
    }
    let res = client.get(article_url).send().await.map_err(|e| e.to_string())?;
    if res.status().as_u16() != 200 {
        return Err(format!("Gagal membuka artikel (HTTP {})", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;

    let mut title = String::new();
    let mut author = String::new();
    let mut publish_date = String::new();
    let mut hero_image = String::new();
    let mut description = String::new();

    let re_h1 = regex::Regex::new(r"(?s)<h1[^>]*>(.*?)</h1>").unwrap();
    if let Some(m) = re_h1.captures(&html) {
        let re_tag = regex::Regex::new(r"<[^>]+>").unwrap();
        title = re_tag.replace_all(&m[1], "").trim().to_string();
    }

    let re_ld = regex::Regex::new(r#"(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>"#).unwrap();
    for m in re_ld.captures_iter(&html) {
        if let Ok(ld) = serde_json::from_str::<Value>(m[1].trim()) {
            let typ = ld.get("@type").and_then(Value::as_str).unwrap_or("");
            if typ != "NewsArticle" && typ != "Article" {
                continue;
            }
            if title.is_empty() {
                title = ld.get("headline").and_then(Value::as_str).unwrap_or("").to_string();
            }
            publish_date = ld.get("datePublished").and_then(Value::as_str).unwrap_or("").to_string();
            match ld.get("image") {
                Some(Value::String(s)) => hero_image = s.clone(),
                Some(Value::Array(a)) => hero_image = a.first().and_then(Value::as_str).unwrap_or("").to_string(),
                _ => {}
            }
            description = ld.get("description").and_then(Value::as_str).unwrap_or("").to_string();
            match ld.get("author") {
                Some(Value::Array(a)) if !a.is_empty() => author = a[0].get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                Some(a) => author = a.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                _ => {}
            }
        }
    }

    if hero_image.is_empty() {
        let re = regex::Regex::new(r#"<meta\s+property="og:image"\s+content="([^"]+)""#).unwrap();
        hero_image = re.captures(&html).and_then(|m| m.get(1)).map(|g| g.as_str().to_string()).unwrap_or_default();
    }
    if description.is_empty() {
        let re = regex::Regex::new(r#"<meta\s+property="og:description"\s+content="([^"]+)""#).unwrap();
        description = re.captures(&html).and_then(|m| m.get(1)).map(|g| g.as_str().to_string()).unwrap_or_default();
    }

    let body_html = regex::Regex::new(r"(?s)<article[^>]*>(.*?)</article>")
        .unwrap()
        .captures(&html)
        .and_then(|m| m.get(1).map(|g| g.as_str().to_string()))
        .or_else(|| {
            regex::Regex::new(r"(?s)<main[^>]*>(.*?)</main>")
                .unwrap()
                .captures(&html)
                .and_then(|m| m.get(1).map(|g| g.as_str().to_string()))
        })
        .unwrap_or_else(|| html.clone());

    let re_p = regex::Regex::new(r"(?s)<p[^>]*>(.*?)</p>").unwrap();
    let re_tag = regex::Regex::new(r"<[^>]+>").unwrap();
    let mut paragraphs = Vec::new();
    for m in re_p.captures_iter(&body_html) {
        let p_text = re_tag.replace_all(&m[1], "").split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string();
        if p_text.len() > 30
            && !p_text.contains("verifikasi usia")
            && !p_text.contains("iklan perjudian")
            && !p_text.contains("Tambahkan GOAL")
        {
            paragraphs.push(json!(clean_text(&p_text)));
        }
    }

    Ok(json!({
        "status": true,
        "title": clean_text(&title),
        "url": article_url,
        "author": if author.is_empty() { "Goal.com".to_string() } else { clean_text(&author) },
        "publishDate": publish_date,
        "heroImage": if hero_image.is_empty() { Value::Null } else { json!(hero_image.replace("&amp;", "&")) },
        "description": clean_text(&description),
        "totalParagraphs": paragraphs.len(),
        "content": paragraphs,
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

    let act = get_param("action").unwrap_or_else(|| "latest".to_string()).trim().to_lowercase();
    let language = get_param("lang").unwrap_or_else(|| "id".to_string());
    let language = if language.trim().is_empty() { "id".to_string() } else { language.trim().to_string() };

    if !ACTIONS.contains(&act.as_str()) {
        return err(StatusCode::BAD_REQUEST, &format!("Action tidak valid. Pilihan: {}", ACTIONS.join(", ")));
    }

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let result = if act == "search" {
        let q = get_param("query").unwrap_or_default();
        if q.trim().is_empty() {
            return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk action=search");
        }
        search_news(&client, q.trim(), &language).await
    } else if act == "article" {
        let url = get_param("url").unwrap_or_default();
        if url.trim().is_empty() {
            return err(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi untuk action=article");
        }
        get_article(&client, url.trim()).await
    } else if act == "transfers" {
        get_transfers(&client, &language).await
    } else {
        get_home(&client, &language).await
    };

    match result {
        Ok(r) => Json(json!({"status": true, "action": act, "result": r})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

// IPA Pelajaran Search — native conversion of api/search/ipa-pelajaran.js
// Scraping artikel dari ipa.pelajaran.co.id (search berpagination + detail per slug).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://ipa.pelajaran.co.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

async fn fetch_html(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(url)
                    .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    res.text().await.map_err(|e| e.to_string())
}

fn detail_result(slug: &str, html: &str) -> Value {
    let document = scraper::Html::parse_document(html);
    let text_of = |sel: &scraper::Selector| -> String {
        document
            .select(sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default()
    };
    let title = text_of(&scraper::Selector::parse(".entry-title").unwrap());
    let content = text_of(&scraper::Selector::parse(".entry-content").unwrap());
    let author = text_of(&scraper::Selector::parse(".entry-author .fn").unwrap());
    let thumbnail = document
        .select(&scraper::Selector::parse(".content-thumbnail img").unwrap())
        .next()
        .and_then(|el| el.value().attr("src"))
        .unwrap_or("")
        .to_string();
    let date = document
        .select(&scraper::Selector::parse(".posted-on time").unwrap())
        .next()
        .and_then(|el| el.value().attr("datetime"))
        .unwrap_or("")
        .to_string();

    let mut content = content;
    if content.chars().count() > 1000 {
        content = content.chars().take(1000).collect::<String>() + "...";
    }

    json!({
        "title": title,
        "slug": slug,
        "url": format!("{}/{}/", BASE_URL, slug),
        "thumbnail": thumbnail,
        "content": content,
        "author": author,
        "date": date,
    })
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

    let slug = get_param("slug");
    let search_query = get_param("query");
    let page: u32 = get_param("page").and_then(|p| p.parse().ok()).unwrap_or(1);

    if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let url = format!("{}/{}/", BASE_URL, slug);
        match fetch_html(&url).await {
            Ok(html) => return Json(json!({"status": true, "result": detail_result(slug, &html)})).into_response(),
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari materi IPA: {e}")),
        }
    }

    let q = match search_query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => q,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' atau 'slug' wajib diisi"),
    };

    let url = format!("{}/page/{}/?s={}", BASE_URL, page, urlencoding::encode(q));
    let html = match fetch_html(&url).await {
        Ok(h) => h,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari materi IPA: {e}")),
    };

    let document = scraper::Html::parse_document(&html);
    let mut results: Vec<Value> = Vec::new();

    let sel_article = scraper::Selector::parse("article.post").unwrap();
    for article in document.select(&sel_article) {
        let text_sel = |sel: &scraper::Selector| -> String {
            article
                .select(sel)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default()
        };
        let title = text_sel(&scraper::Selector::parse(".entry-title a").unwrap());
        if title.is_empty() {
            continue;
        }
        let link = article
            .select(&scraper::Selector::parse(".entry-title a").unwrap())
            .next()
            .and_then(|el| el.value().attr("href"))
            .unwrap_or("")
            .to_string();
        let slug_out: String = link.split('/').filter(|s| !s.is_empty()).last().unwrap_or("").to_string();
        let thumbnail = article
            .select(&scraper::Selector::parse(".content-thumbnail img").unwrap())
            .next()
            .and_then(|el| el.value().attr("src"))
            .unwrap_or("")
            .to_string();
        let excerpt = {
            let mut e = text_sel(&scraper::Selector::parse(".entry-content p").unwrap());
            if e.ends_with("[selengkapnya]") {
                e.truncate(e.len() - "[selengkapnya]".len());
                e = e.trim().to_string();
            }
            e
        };
        let author = text_sel(&scraper::Selector::parse(".entry-author .fn").unwrap());
        let date = article
            .select(&scraper::Selector::parse(".posted-on time").unwrap())
            .next()
            .and_then(|el| el.value().attr("datetime"))
            .unwrap_or("")
            .to_string();

        results.push(json!({
            "title": title,
            "slug": slug_out,
            "url": link,
            "thumbnail": thumbnail,
            "excerpt": excerpt,
            "author": author,
            "date": date,
        }));
    }

    if results.is_empty() {
        return err(StatusCode::NOT_FOUND, &format!("Materi \"{}\" tidak ditemukan", q));
    }

    Json(json!({
        "status": true,
        "result": {
            "query": q,
            "current_page": page,
            "total_pages": page,
            "total_results": results.len(),
            "has_next_page": false,
            "has_prev_page": page > 1,
            "results": results,
        }
    })).into_response()
}

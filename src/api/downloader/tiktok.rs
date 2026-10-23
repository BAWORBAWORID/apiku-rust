use axum::{
    extract::{Query, State},
    response::Json,
};
use regex::Regex;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::LazyLock;
use crate::state::AppState;
use axum::response::{IntoResponse, Response};

#[derive(Debug, Default, Deserialize)]
pub struct TiktokParams {
    pub url: Option<String>,
}

static CSRF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"name="csrf_token"\s+value="([^"]+)""#).unwrap()
});

const BASE_URL: &str = "https://savett.cc/en1/download";
const USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/139.0.0.0 Mobile Safari/537.36";

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<TiktokParams>,
    body: Option<Json<TiktokParams>>,
) -> Response {
    let start_time = std::time::Instant::now();
    let body_params = body.map(|b| b.0).unwrap_or_default();
    let target_url = body_params.url.or(query.url).unwrap_or_default().trim().to_string();


    if target_url.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'url' wajib diisi dengan link TikTok yang valid."
        })).into_response();
    }

    // Step 1: Ambil Session & CSRF Token
    let session_res = match state.client.get(BASE_URL)
        .header("User-Agent", USER_AGENT)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Referer", "https://savett.cc/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": format!("Gagal menghubungi provider TikTok: {}", e),
            })).into_response();
        }
    };

    let cookies = session_res.headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(""))
        .collect::<Vec<&str>>()
        .join("; ");

    let html_body = session_res.text().await.unwrap_or_default();
    let csrf_token = match CSRF_RE.captures(&html_body) {
        Some(cap) => cap[1].to_string(),
        None => {
            return Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": "Gagal mengambil sesi token dari penyedia download.",
            })).into_response();
        }
    };

    // Step 2: Kirim Permintaan Unduh
    let form_body = format!(
        "csrf_token={}&url={}",
        urlencoding::encode(&csrf_token),
        urlencoding::encode(&target_url)
    );

    let download_res = match state.client.post(BASE_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .header("User-Agent", USER_AGENT)
                    .header("Origin", "https://savett.cc")
        .header("Referer", BASE_URL)
        .header("Cookie", &cookies)
        .body(form_body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": format!("Gagal memproses link TikTok: {}", e),
            })).into_response();
        }
    };

    let res_html = download_res.text().await.unwrap_or_default();
    let doc = Html::parse_document(&res_html);

    // Parse data hasil scrape menggunakan CSS Selector
    let title_sel = Selector::parse("div.video-data > div.info > h3, div.info h3").unwrap();
    let author_sel = Selector::parse("div.video-data > div.info > p, div.info p").unwrap();
    let thumb_sel = Selector::parse("div.video-data img, div.info img").unwrap();
    let dl_sel = Selector::parse("a.button.format[href]").unwrap();

    let title = doc.select(&title_sel).next().map(|el| el.text().collect::<Vec<_>>().join(" ")).unwrap_or_default();
    let author = doc.select(&author_sel).next().map(|el| el.text().collect::<Vec<_>>().join(" ")).unwrap_or_default();
    let thumbnail = doc.select(&thumb_sel).next().and_then(|el| el.value().attr("src")).unwrap_or("");

    let mut download_urls = Vec::new();
    for el in doc.select(&dl_sel) {
        if let Some(href) = el.value().attr("href") {
            let label = el.text().collect::<Vec<_>>().join(" ").trim().to_string();
            download_urls.push(json!({
                "label": label,
                "url": href
            }));
        }
    }

    if download_urls.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Video TikTok tidak ditemukan atau berstatus privat.",
        })).into_response();
    }

    Json(json!({
        "status": true,
        "time": format!("{}ms", start_time.elapsed().as_millis()),
        "result": {
            "title": title.trim(),
            "author": author.trim(),
            "thumbnail": thumbnail,
            "downloads": download_urls
        },
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })).into_response()
}

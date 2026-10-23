use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use rand::{seq::SliceRandom, Rng};
use scraper::{Html, Selector};
use serde_json::json;
use crate::state::AppState;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub async fn handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let client = &state.client;

    let page: u32 = {
        let mut rng = rand::thread_rng();
        rng.gen_range(1..=250)
    };

    let list_url = if page == 1 {
        "https://seegore.com/gore/".to_string()
    } else {
        format!("https://seegore.com/gore/page/{}/", page)
    };

    let list_res = match client.get(&list_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(json!({
                "status": false,
                "message": format!("Gagal menghubungi Seegore: {}", e),
                "attribution": "@zyvorapi"
            }));
        }
    };

    let list_html = match list_res.text().await {
        Ok(h) => h,
        Err(_) => {
            return Json(json!({
                "status": false,
                "message": "Gagal membaca respons dari Seegore",
                "attribution": "@zyvorapi"
            }));
        }
    };

    let (title, detail_link, thumb, view, vote) = {
        let list_doc = Html::parse_document(&list_html);
        let article_sel = Selector::parse("article").unwrap();
        let title_sel = Selector::parse("h2").unwrap();
        let link_sel = Selector::parse("a").unwrap();
        let img_sel = Selector::parse("img").unwrap();
        let view_sel = Selector::parse("[class*='view']").unwrap();
        let vote_sel = Selector::parse("[class*='vote']").unwrap();

        let mut articles = Vec::new();
        for el in list_doc.select(&article_sel) {
            let title = el.select(&title_sel).next().map(|t| t.text().collect::<Vec<_>>().join("").trim().to_string()).unwrap_or_default();
            let link = el.select(&link_sel).next().and_then(|a| a.value().attr("href")).unwrap_or("").to_string();
            let thumb = el.select(&img_sel).next().and_then(|img| {
                img.value().attr("src").or_else(|| img.value().attr("data-src"))
            }).map(|s| s.to_string());
            let view = el.select(&view_sel).next().map(|v| v.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_default();
            let vote = el.select(&vote_sel).next().map(|v| v.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or_default();

            if !title.is_empty() && !link.is_empty() {
                articles.push((title, link, thumb, view, vote));
            }
        }

        if articles.is_empty() {
            return Json(json!({
                "status": false,
                "message": "Tidak ada konten ditemukan pada halaman tersebut",
                "attribution": "@zyvorapi"
            }));
        }

        let mut rng = rand::thread_rng();
        let picked = articles.choose(&mut rng).unwrap().clone();
        (picked.0, picked.1, picked.2, picked.3, picked.4)
    };

    // Fetch detail page
    match client.get(&detail_link)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
    {
        Ok(detail_res) => {
            if let Ok(detail_html) = detail_res.text().await {
                let (final_title, tag, upload, author, views, video1, video2) = {
                    let detail_doc = Html::parse_document(&detail_html);
                    let title_sel = Selector::parse("h1.entry-title, h1").unwrap();
                    let upload_sel = Selector::parse("time").unwrap();
                    let author_sel = Selector::parse(".author a, .entry-author a").unwrap();
                    let count_sel = Selector::parse("[class*='view']").unwrap();
                    let tag_sel = Selector::parse("a[href*='/tag/'], a[href*='/category/']").unwrap();
                    let video_source_sel = Selector::parse("video source").unwrap();
                    let video_a_sel = Selector::parse("video a").unwrap();
                    let video_tag_sel = Selector::parse("video").unwrap();

                    let detail_title = detail_doc.select(&title_sel).next().map(|t| t.text().collect::<Vec<_>>().join("").trim().to_string());
                    let final_title = detail_title.unwrap_or(title);
                    let upload = detail_doc.select(&upload_sel).next().map(|u| u.text().collect::<Vec<_>>().join("").trim().to_string()).unwrap_or_default();
                    let author = detail_doc.select(&author_sel).next().map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string()).unwrap_or_else(|| "SeeGore".to_string());
                    let raw_views = detail_doc.select(&count_sel).next().map(|c| c.text().collect::<Vec<_>>().join(" ").trim().to_string()).unwrap_or(view);
                    let views = raw_views.split_whitespace().collect::<Vec<_>>().join(" ");

                    let mut tags = Vec::new();
                    for t in detail_doc.select(&tag_sel) {
                        let text = t.text().collect::<Vec<_>>().join("").trim().to_string();
                        if !text.is_empty() && text != "Home" && text != "Previous" && text != "Next" {
                            tags.push(text);
                            if tags.len() >= 5 { break; }
                        }
                    }
                    let tag = tags.join(", ");

                    // Ambil source video dengan urutan akurat
                    let mut sources = Vec::new();
                    for s in detail_doc.select(&video_source_sel) {
                        if let Some(src) = s.value().attr("src") {
                            sources.push(src.to_string());
                        }
                    }
                    if sources.is_empty() {
                        if let Some(v) = detail_doc.select(&video_tag_sel).next() {
                            if let Some(src) = v.value().attr("src") {
                                sources.push(src.to_string());
                            }
                        }
                    }

                    let video1 = sources.first().cloned();
                    let video2 = sources.get(1).cloned().or_else(|| {
                        detail_doc.select(&video_a_sel).next().and_then(|a| a.value().attr("href")).map(|s| s.to_string())
                    });
                    (final_title, tag, upload, author, views, video1, video2)
                };

                Json(json!({
                    "status": true,
                    "result": {
                        "title": final_title,
                        "source": detail_link,
                        "thumb": thumb,
                        "tag": tag,
                        "upload": upload,
                        "author": author,
                        "vote": vote,
                        "view": views,
                        "video1": video1,
                        "video2": video2
                    },
                    "attribution": "@zyvorapi"
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca detail konten Seegore",
                    "attribution": "@zyvorapi"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Gagal mengambil detail dari Seegore: {}", e),
            "attribution": "@zyvorapi"
        })),
    }
}

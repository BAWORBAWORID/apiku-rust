use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct DdgParams {
    pub query: Option<String>,
    pub q: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<DdgParams>,
    body: Option<Json<DdgParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let query_opt = query.query
        .or(query.q)
        .or_else(|| body.as_ref().and_then(|b| b.query.clone().or_else(|| b.q.clone())));

    let q = match query_opt {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'query' wajib diisi"
            }));
        }
    };

    let target = format!("https://html.duckduckgo.com/html/?q={}", urlencoding::encode(&q));

    match client.get(&target).header("User-Agent", UA).send().await {
        Ok(resp) => {
            if let Ok(html) = resp.text().await {
                let doc = Html::parse_document(&html);
                let result_sel = Selector::parse(".result").unwrap();
                let title_sel = Selector::parse(".result__title a").unwrap();
                let snippet_sel = Selector::parse(".result__snippet").unwrap();

                let mut results = Vec::new();
                for el in doc.select(&result_sel) {
                    let title_el = el.select(&title_sel).next();
                    let snippet_el = el.select(&snippet_sel).next();

                    if let Some(t) = title_el {
                        let title = t.text().collect::<Vec<_>>().join(" ").trim().to_string();
                        let mut link = t.value().attr("href").unwrap_or("").to_string();

                        if let Some(idx) = link.find("uddg=") {
                            let raw_url = &link[idx + 5..];
                            let end_idx = raw_url.find('&').unwrap_or(raw_url.len());
                            if let Ok(decoded) = urlencoding::decode(&raw_url[..end_idx]) {
                                link = decoded.into_owned();
                            }
                        }

                        let snippet = snippet_el
                            .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
                            .unwrap_or_default();

                        if !title.is_empty() && link.starts_with("http") {
                            results.push(json!({
                                "title": title,
                                "url": link,
                                "snippet": snippet
                            }));
                        }
                    }
                }

                Json(json!({
                    "status": true,
                    "result": {
                        "query": q,
                        "total": results.len(),
                        "items": results
                    },
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca response DuckDuckGo"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Request error: {}", e)
        })),
    }
}

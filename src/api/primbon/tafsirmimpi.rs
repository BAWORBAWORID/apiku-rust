use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use regex::Regex;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MimpiParams {
    pub mimpi: Option<String>,
    pub q: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<MimpiParams>,
    body: Option<Json<MimpiParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let mimpi_opt = query.mimpi
        .or(query.q)
        .or_else(|| body.as_ref().and_then(|b| b.mimpi.clone().or_else(|| b.q.clone())));

    let mimpi = match mimpi_opt {
        Some(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'mimpi' wajib diisi"
            }));
        }
    };

    let target = format!(
        "https://www.primbon.com/tafsir_mimpi.php?mimpi={}&submit=+Submit+",
        urlencoding::encode(&mimpi)
    );

    match client.get(&target)
                    .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(html) = resp.text().await {
                let doc = Html::parse_document(&html);
                let body_sel = Selector::parse("#body").unwrap();
                let full_text = doc.select(&body_sel)
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join(" "))
                    .unwrap_or(html);

                let re_pattern = format!(r"(?i)Mimpi.*?(?:{}).*?(?:=.*?(?=(?:Mimpi|$)))", regex::escape(&mimpi));
                let mut results = Vec::new();

                if let Ok(re) = Regex::new(&re_pattern) {
                    for mat in re.find_iter(&full_text) {
                        let text_match = mat.as_str().trim();
                        let parts: Vec<&str> = text_match.split('=').collect();
                        if parts.len() == 2 {
                            let m_clean = parts[0].trim().trim_start_matches("Mimpi").trim();
                            let tafsir = parts[1].trim();
                            results.push(json!({
                                "mimpi": m_clean,
                                "tafsir": tafsir
                            }));
                        }
                    }
                }

                if !results.is_empty() {
                    return Json(json!({
                        "status": true,
                        "result": {
                            "query": mimpi,
                            "total": results.len(),
                            "hasil": results
                        },
                    }));
                }

                Json(json!({
                    "status": false,
                    "message": format!("Tidak ada tafsir ditemukan untuk kata '{}'", mimpi)
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca response primbon"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error request primbon: {}", e)
        })),
    }
}

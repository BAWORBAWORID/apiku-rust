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
pub struct NamaParams {
    pub nama: Option<String>,
    pub name: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<NamaParams>,
    body: Option<Json<NamaParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let nama_opt = query.nama
        .or(query.name)
        .or_else(|| body.as_ref().and_then(|b| b.nama.clone().or_else(|| b.name.clone())));

    let nama = match nama_opt {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'nama' wajib diisi"
            }));
        }
    };

    let target = format!(
        "https://primbon.com/arti_nama.php?nama1={}&proses=+Submit!+",
        urlencoding::encode(&nama)
    );

    match client.get(&target)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
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

                let re = Regex::new(r"(?s)memiliki arti:\s*(.*?)(?:Nama:|$)").unwrap();
                if let Some(caps) = re.captures(&full_text) {
                    if let Some(arti) = caps.get(1) {
                        let arti_str = arti.as_str().trim();
                        if !arti_str.is_empty() {
                            return Json(json!({
                                "status": true,
                                "result": {
                                    "nama": nama,
                                    "arti": arti_str,
                                    "catatan": "Gunakan juga aplikasi numerologi Kecocokan Nama, untuk melihat sejauh mana keselarasan nama anda dengan diri anda."
                                },
                            }));
                        }
                    }
                }

                Json(json!({
                    "status": false,
                    "message": format!("Tidak ditemukan arti nama \"{}\". Cari dengan kata kunci yang lain.", nama)
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca response Primbon"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error request Primbon: {}", e)
        })),
    }
}

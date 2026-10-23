use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use regex::Regex;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::state::AppState;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct CocokPasanganParams {
    pub nama1: Option<String>,
    pub nama2: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<CocokPasanganParams>,
    body: Option<Json<CocokPasanganParams>>,
) -> impl IntoResponse {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let n1 = query.nama1.or_else(|| body.as_ref().and_then(|b| b.nama1.clone())).unwrap_or_default().trim().to_string();
    let n2 = query.nama2.or_else(|| body.as_ref().and_then(|b| b.nama2.clone())).unwrap_or_default().trim().to_string();

    if n1.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'nama1' wajib diisi"
        }));
    }
    if n2.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'nama2' wajib diisi"
        }));
    }

    let url = format!(
        "https://primbon.com/kecocokan_nama_pasangan.php?nama1={}&nama2={}&proses=+Submit%21+",
        urlencoding::encode(&n1),
        urlencoding::encode(&n2)
    );

    let client = &state.client;
    match client.get(&url).header("User-Agent", USER_AGENT).send().await {
        Ok(res) => {
            if let Ok(html) = res.text().await {
                let fetch_text = {
                    let doc = Html::parse_document(&html);
                    let body_sel = Selector::parse("#body").unwrap();
                    doc.select(&body_sel)
                        .next()
                        .map(|el| el.text().collect::<Vec<_>>().join(" "))
                        .unwrap_or(html)
                };

                let re_pos = Regex::new(r"(?s)Sisi Positif Anda:\s*(.*?)\s*Sisi Negatif Anda:").unwrap();
                let re_neg = Regex::new(r"(?s)Sisi Negatif Anda:\s*(.*?)(?:< Hitung Kembali|$)").unwrap();

                let pos_match = re_pos.captures(&fetch_text).and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string());
                let neg_match = re_neg.captures(&fetch_text).and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string());

                if let (Some(sisi_positif), Some(sisi_negatif)) = (pos_match, neg_match) {
                    return Json(json!({
                        "status": true,
                        "input": {
                            "nama_anda": n1,
                            "nama_pasangan": n2
                        },
                        "sisi_positif": sisi_positif,
                        "sisi_negatif": sisi_negatif,
                        "gambar": "https://primbon.com/ramalan_kecocokan_cinta2.png",
                        "catatan": "Untuk melihat kecocokan jodoh dengan pasangan, dapat dikombinasikan dengan primbon Ramalan Jodoh (Jawa), Ramalan Jodoh (Bali), numerologi Kecocokan Cinta, Ramalan Perjalanan Hidup Suami Istri, dan makna dari Tanggal Jadian/Pernikahan.",
                        "timestamp": now_ms
                    }));
                }

                Json(json!({
                    "status": false,
                    "message": format!("Tidak ditemukan kecocokan untuk \"{}\" dan \"{}\". Mungkin input yang Anda masukkan salah.", n1, n2),
                    "timestamp": now_ms
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca respons dari Primbon",
                    "timestamp": now_ms
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error koneksi ke Primbon: {}", e),
            "timestamp": now_ms
        })),
    }
}

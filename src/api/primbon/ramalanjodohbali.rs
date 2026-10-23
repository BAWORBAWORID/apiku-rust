use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::state::AppState;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct RamalanJodohBaliParams {
    pub nama1: Option<String>,
    pub tgl1: Option<String>,
    pub bln1: Option<String>,
    pub thn1: Option<String>,
    pub nama2: Option<String>,
    pub tgl2: Option<String>,
    pub bln2: Option<String>,
    pub thn2: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<RamalanJodohBaliParams>,
    body: Option<Json<RamalanJodohBaliParams>>,
) -> impl IntoResponse {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let b = body.as_ref().map(|x| &x.0);

    let n1 = query.nama1.or_else(|| b.and_then(|x| x.nama1.clone())).unwrap_or_default().trim().to_string();
    let t1 = query.tgl1.or_else(|| b.and_then(|x| x.tgl1.clone())).unwrap_or_default().trim().to_string();
    let b1 = query.bln1.or_else(|| b.and_then(|x| x.bln1.clone())).unwrap_or_default().trim().to_string();
    let y1 = query.thn1.or_else(|| b.and_then(|x| x.thn1.clone())).unwrap_or_default().trim().to_string();

    let n2 = query.nama2.or_else(|| b.and_then(|x| x.nama2.clone())).unwrap_or_default().trim().to_string();
    let t2 = query.tgl2.or_else(|| b.and_then(|x| x.tgl2.clone())).unwrap_or_default().trim().to_string();
    let b2 = query.bln2.or_else(|| b.and_then(|x| x.bln2.clone())).unwrap_or_default().trim().to_string();
    let y2 = query.thn2.or_else(|| b.and_then(|x| x.thn2.clone())).unwrap_or_default().trim().to_string();

    if n1.is_empty() || t1.is_empty() || b1.is_empty() || y1.is_empty()
        || n2.is_empty() || t2.is_empty() || b2.is_empty() || y2.is_empty()
    {
        return Json(json!({
            "status": false,
            "message": "Parameter nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2 wajib diisi"
        }));
    }

    let form_body = format!(
        "nama1={}&tgl1={}&bln1={}&thn1={}&nama2={}&tgl2={}&bln2={}&thn2={}&submit=+Submit%21+",
        urlencoding::encode(&n1), t1, b1, y1,
        urlencoding::encode(&n2), t2, b2, y2
    );

    let client = &state.client;
    match client.post("https://www.primbon.com/ramalan_jodoh_bali.php")
                    .header("content-type", "application/x-www-form-urlencoded")
        .header("User-Agent", USER_AGENT)
        .body(form_body)
        .send()
        .await
    {
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

                let clean_text = fetch_text
                    .replace("(adsbygoogle = window.adsbygoogle || []).push({});", "")
                    .replace("< Hitung Kembali", "")
                    .trim()
                    .to_string();

                if let Some(pos) = clean_text.find("HASIL RAMALAN") {
                    let result_str = clean_text[pos..].trim().to_string();
                    return Json(json!({
                        "status": true,
                        "input": {
                            "pertama": {
                                "nama": n1,
                                "tanggal_lahir": format!("{}-{}-{}", t1, b1, y1)
                            },
                            "kedua": {
                                "nama": n2,
                                "tanggal_lahir": format!("{}-{}-{}", t2, b2, y2)
                            }
                        },
                        "nama_anda": {
                            "nama": n1,
                            "tanggal_lahir": format!("{}-{}-{}", t1, b1, y1)
                        },
                        "nama_pasangan": {
                            "nama": n2,
                            "tanggal_lahir": format!("{}-{}-{}", t2, b2, y2)
                        },
                        "result": result_str,
                        "catatan": "Untuk melihat kecocokan jodoh dengan pasangan, dapat dikombinasikan dengan Ramalan Jodoh (Jawa), numerologi Kecocokan Cinta, tingkat keserasian Nama Pasangan, Ramalan Perjalanan Hidup Suami Istri, dan makna dari Tanggal Jadian/Pernikahan.",
                        "timestamp": now_ms
                    }));
                }

                Json(json!({
                    "status": false,
                    "message": format!("Tidak ditemukan ramalan untuk \"{}\" dan \"{}\". Mungkin input yang Anda masukkan salah.", n1, n2),
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

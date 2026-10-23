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
pub struct SifatUsahaParams {
    pub tgl: Option<String>,
    pub bln: Option<String>,
    pub thn: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<SifatUsahaParams>,
    body: Option<Json<SifatUsahaParams>>,
) -> impl IntoResponse {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let tgl = query.tgl.or_else(|| body.as_ref().and_then(|b| b.tgl.clone())).unwrap_or_default().trim().to_string();
    let bln = query.bln.or_else(|| body.as_ref().and_then(|b| b.bln.clone())).unwrap_or_default().trim().to_string();
    let thn = query.thn.or_else(|| body.as_ref().and_then(|b| b.thn.clone())).unwrap_or_default().trim().to_string();

    if tgl.is_empty() || bln.is_empty() || thn.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'tgl', 'bln', dan 'thn' wajib diisi"
        }));
    }

    let parsed_tgl = match tgl.parse::<u32>() {
        Ok(n) if (1..=31).contains(&n) => n,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Tanggal (tgl) harus antara 1-31"
            }));
        }
    };

    let parsed_bln = match bln.parse::<u32>() {
        Ok(n) if (1..=12).contains(&n) => n,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Bulan (bln) harus antara 1-12"
            }));
        }
    };

    let parsed_thn = match thn.parse::<u32>() {
        Ok(n) if (1900..=2100).contains(&n) => n,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Tahun (thn) harus antara 1900-2100"
            }));
        }
    };

    let form_body = format!("tgl={}&bln={}&thn={}&submit=+Submit%21+", parsed_tgl, parsed_bln, parsed_thn);

    let client = &state.client;
    match client.post("https://primbon.com/sifat_usaha_bisnis.php")
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

                let clean_text = fetch_text.replace("(adsbygoogle = window.adsbygoogle || []).push({});", "").trim().to_string();

                if let Some(pos_hl) = clean_text.find("Hari Lahir Anda: ") {
                    let after_hl = &clean_text[pos_hl + "Hari Lahir Anda: ".len()..];
                    let thn_str = parsed_thn.to_string();
                    if let Some(pos_thn) = after_hl.find(&thn_str) {
                        let hari_lahir = after_hl[..pos_thn].trim().to_string();
                        let after_thn = &after_hl[pos_thn + thn_str.len()..];
                        let usaha = after_thn.split("< Hitung Kembali").next().unwrap_or(after_thn).trim().to_string();

                        return Json(json!({
                            "status": true,
                            "input": {
                                "tanggal": parsed_tgl,
                                "bulan": parsed_bln,
                                "tahun": parsed_thn
                            },
                            "hari_lahir": hari_lahir,
                            "usaha": usaha,
                            "catatan": "Setiap manusia memiliki sifat atau karakter yang berbeda-beda dalam menjalankan bisnis atau usaha. Dengan memahami sifat bisnis kita, rekan kita, atau bahkan kompetitor kita, akan membantu kita memperbaiki diri atau untuk menjalin hubungan kerjasama yang lebih baik.",
                            "timestamp": now_ms
                        }));
                    }
                }

                Json(json!({
                    "status": false,
                    "message": format!("Tidak ditemukan data untuk tanggal {}-{}-{}. Mungkin input yang Anda masukkan salah.", parsed_tgl, parsed_bln, parsed_thn),
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

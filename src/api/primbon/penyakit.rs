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
pub struct PenyakitParams {
    pub tgl: Option<String>,
    pub bln: Option<String>,
    pub thn: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<PenyakitParams>,
    body: Option<Json<PenyakitParams>>,
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

    let form_body = format!("tanggal={}&bulan={}&tahun={}&hitung=+Submit%21+", parsed_tgl, parsed_bln, parsed_thn);

    let client = &state.client;
    match client.post("https://primbon.com/cek_potensi_penyakit.php")
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
                    .replace("<< Kembali", "")
                    .trim()
                    .to_string();

                if !clean_text.contains("CEK POTENSI PENYAKIT (METODE PITAGORAS)") {
                    return Json(json!({
                        "status": false,
                        "message": "Data tidak ditemukan atau format tanggal tidak valid",
                        "timestamp": now_ms
                    }));
                }

                let parts: Vec<&str> = clean_text.split("CEK POTENSI PENYAKIT (METODE PITAGORAS)").collect();
                let rest = parts.get(1).unwrap_or(&"");

                let analisa = rest.split("Sektor yg dianalisa:").next().unwrap_or("").trim();
                let sektor_part = rest.split("Sektor yg dianalisa:").nth(1).unwrap_or("");
                let sektor = sektor_part.split("Anda tidak memiliki elemen").next().unwrap_or("").trim();
                let elemen_part = sektor_part.split("Anda tidak memiliki elemen").nth(1).unwrap_or("");
                let elemen_clean = elemen_part.split('*').next().unwrap_or("").trim();
                let elemen = format!("Anda tidak memiliki elemen {}", elemen_clean);

                Json(json!({
                    "status": true,
                    "input": {
                        "tanggal": parsed_tgl,
                        "bulan": parsed_bln,
                        "tahun": parsed_thn
                    },
                    "analisa": analisa,
                    "sektor": sektor,
                    "elemen": elemen,
                    "catatan": "Potensi penyakit harus dipandang secara positif. Sakit pada daftar tidak berarti anda akan mengalami semuanya. Anda mungkin hanya akan mengalami 1 atau 2 macam penyakit. Pencegahan adalah yang terbaik, makanan yang sehat, olahraga teratur, istirahat yang cukup, hidup bahagia, adalah resep paling manjur untuk menghindari segala penyakit.",
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

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

const USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct RamalJodohParams {
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
    Query(query): Query<RamalJodohParams>,
    body: Option<Json<RamalJodohParams>>,
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
        "nama1={}&tgl1={}&bln1={}&thn1={}&nama2={}&tgl2={}&bln2={}&thn2={}&submit=+RAMALAN+JODOH+%3E%3E+",
        urlencoding::encode(&n1), t1, b1, y1,
        urlencoding::encode(&n2), t2, b2, y2
    );

    let client = &state.client;
    match client.post("https://www.primbon.com/ramalan_jodoh.php")
                    .header("content-type", "application/x-www-form-urlencoded")
        .header("user-agent", USER_AGENT)
        .body(form_body)
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(html) = res.text().await {
                let parsed = {
                    let doc = Html::parse_document(&html);
                    let body_sel = Selector::parse("#body").unwrap();
                    let raw_text = doc.select(&body_sel)
                        .next()
                        .map(|el| el.text().collect::<Vec<_>>().join(" "))
                        .unwrap_or_default();

                    let i_sel = Selector::parse("#body i").unwrap();
                    let peringatan = doc.select(&i_sel)
                        .find(|el| el.text().collect::<Vec<_>>().join("").contains("Jangan mudah memutuskan"))
                        .map(|el| {
                            let t = el.text().collect::<Vec<_>>().join(" ");
                            t.split("Konsultasi").next().unwrap_or(&t).trim().to_string()
                        })
                        .unwrap_or_else(|| "Tidak ada peringatan khusus.".to_string());

                    (raw_text, peringatan)
                };

                let (raw_text, peringatan) = parsed;

                let mut clean_text = raw_text
                    .replace("(adsbygoogle = window.adsbygoogle || []).push({});", "")
                    .replace("RAMALAN JODOH", "")
                    .replace("Konsultasi Hari Baik Akad Nikah >>>", "");

                if let Some(start) = clean_text.find("1. Berdasarkan neptu") {
                    if let Some(end) = clean_text.find("*Jangan mudah memutuskan") {
                        if end > start {
                            clean_text = clean_text[start..end].trim().to_string();
                        }
                    }
                }

                let split_re = Regex::new(r"\d+\.\s+").unwrap();
                let predictions: Vec<String> = split_re.split(&clean_text)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                Json(json!({
                    "status": true,
                    "orang_pertama": {
                        "nama": n1,
                        "tanggal_lahir": format!("{}-{}-{}", t1, b1, y1)
                    },
                    "orang_kedua": {
                        "nama": n2,
                        "tanggal_lahir": format!("{}-{}-{}", t2, b2, y2)
                    },
                    "deskripsi": "Dibawah ini adalah hasil ramalan primbon perjodohan bagi kedua pasangan yang dihitung berdasarkan 6 petung perjodohan dari kitab primbon Betaljemur Adammakna yang disusun oleh Kangjeng Pangeran Harya Tjakraningrat. Hasil ramalan bisa saja saling bertentangan pada setiap petung. Hasil ramalan yang positif (baik) dapat mengurangi pengaruh ramalan yang negatif (buruk), begitu pula sebaliknya.",
                    "hasil_ramalan": predictions,
                    "peringatan": peringatan,
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

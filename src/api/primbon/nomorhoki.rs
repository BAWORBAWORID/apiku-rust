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
pub struct NomorHokiParams {
    #[serde(rename = "phoneNumber")]
    pub phone_number: Option<String>,
    pub nomer: Option<String>,
    pub nomor: Option<String>,
}

fn extract_first_number(text: &str) -> f64 {
    let re = Regex::new(r"\d+(\.\d+)?").unwrap();
    if let Some(m) = re.find(text) {
        m.as_str().parse::<f64>().unwrap_or(0.0)
    } else {
        0.0
    }
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<NomorHokiParams>,
    body: Option<Json<NomorHokiParams>>,
) -> impl IntoResponse {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let phone_opt = query.phone_number
        .or(query.nomer)
        .or(query.nomor)
        .or_else(|| {
            body.as_ref().and_then(|b| {
                b.phone_number.clone()
                    .or_else(|| b.nomer.clone())
                    .or_else(|| b.nomor.clone())
            })
        });

    let phone = match phone_opt {
        Some(p) if !p.trim().is_empty() => p.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'phoneNumber' wajib diisi"
            }));
        }
    };

    if !phone.chars().all(|c| c.is_ascii_digit()) {
        return Json(json!({
            "status": false,
            "message": "Format nomor telepon tidak valid. Gunakan angka saja"
        }));
    }

    if phone.len() < 8 || phone.len() > 15 {
        return Json(json!({
            "status": false,
            "message": "Nomor telepon harus antara 8-15 digit"
        }));
    }

    let form_body = format!("nomer={}&submit=+Submit%21+", phone);

    let client = &state.client;
    match client.post("https://www.primbon.com/no_hoki_bagua_shuzi.php")
                    .header("authority", "www.primbon.com")
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
                    let b_sel = Selector::parse("b").unwrap();
                    let td_sel = Selector::parse("td").unwrap();

                    let mut nomor_hp = String::new();
                    let mut bagua_text = String::new();
                    let mut percent_texts = Vec::new();

                    for el in doc.select(&b_sel) {
                        let t = el.text().collect::<Vec<_>>().join("");
                        if t.contains("No. HP") {
                            nomor_hp = t.replace("No. HP :", "").replace("No. HP : ", "").trim().to_string();
                        }
                        if t.contains("% Angka Bagua Shuzi") {
                            bagua_text = t.clone();
                        }
                        if t.contains('%') {
                            percent_texts.push(t);
                        }
                    }

                    let mut kekayaan = 0.0;
                    let mut kesehatan = 0.0;
                    let mut cinta = 0.0;
                    let mut kestabilan = 0.0;
                    let mut perselisihan = 0.0;
                    let mut kehilangan = 0.0;
                    let mut malapetaka = 0.0;
                    let mut kehancuran = 0.0;

                    for el in doc.select(&td_sel) {
                        let t = el.text().collect::<Vec<_>>().join("");
                        if t.contains("Kekayaan =") { kekayaan = extract_first_number(&t); }
                        else if t.contains("Kesehatan =") { kesehatan = extract_first_number(&t); }
                        else if t.contains("Cinta/Relasi =") { cinta = extract_first_number(&t); }
                        else if t.contains("Kestabilan =") { kestabilan = extract_first_number(&t); }
                        else if t.contains("Perselisihan =") { perselisihan = extract_first_number(&t); }
                        else if t.contains("Kehilangan =") { kehilangan = extract_first_number(&t); }
                        else if t.contains("Malapetaka =") { malapetaka = extract_first_number(&t); }
                        else if t.contains("Kehancuran =") { kehancuran = extract_first_number(&t); }
                    }

                    (nomor_hp, bagua_text, percent_texts, kekayaan, kesehatan, cinta, kestabilan, perselisihan, kehilangan, malapetaka, kehancuran)
                };

                let (nomor_hp, bagua_text, percent_texts, kekayaan, kesehatan, cinta, kestabilan, perselisihan, kehilangan, malapetaka, kehancuran) = parsed;

                if nomor_hp.is_empty() || bagua_text.is_empty() {
                    return Json(json!({
                        "status": false,
                        "message": "Gagal mengekstrak informasi dari response Primbon",
                        "timestamp": now_ms
                    }));
                }

                let bagua_value = extract_first_number(&bagua_text);
                let pos_total = percent_texts.first().map(|s| extract_first_number(s)).unwrap_or(0.0);
                let neg_total = percent_texts.last().map(|s| extract_first_number(s)).unwrap_or(0.0);

                let is_hoki = pos_total > 60.0 && bagua_value >= 60.0;

                Json(json!({
                    "status": true,
                    "input": phone,
                    "data": {
                        "status": true,
                        "nomor": nomor_hp,
                        "angka_bagua_shuzi": {
                            "value": bagua_value,
                            "description": "Persentase Angka Bagua Shuzi menunjukkan tingkat kecocokan nomor dengan elemen karakter. Nilai minimal yang baik adalah 60%."
                        },
                        "energi_positif": {
                            "total": pos_total,
                            "details": {
                                "kekayaan": kekayaan,
                                "kesehatan": kesehatan,
                                "cinta": cinta,
                                "kestabilan": kestabilan
                            },
                            "description": "Energi positif mempengaruhi aspek kekayaan, kesehatan, cinta/relasi, dan kestabilan dalam hidup. Semakin tinggi nilainya, semakin baik."
                        },
                        "energi_negatif": {
                            "total": neg_total,
                            "details": {
                                "perselisihan": perselisihan,
                                "kehilangan": kehilangan,
                                "malapetaka": malapetaka,
                                "kehancuran": kehancuran
                            },
                            "description": "Energi negatif menunjukkan potensi hambatan dalam aspek perselisihan, kehilangan, malapetaka, dan kehancuran. Semakin rendah nilainya, semakin baik."
                        },
                        "analisis": {
                            "status": is_hoki,
                            "description": "Nomor dianggap hoki jika persentase Energi Positif di atas 60% dan persentase Angka Bagua Shuzi minimal 60%"
                        }
                    },
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

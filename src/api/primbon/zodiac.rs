use axum::{
    extract::{Query, State},
    response::Json,
};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
pub struct ZodiacParams {
    pub zodiak: Option<String>,
    pub nama: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<ZodiacParams>,
    body: Option<Json<ZodiacParams>>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let body_params = body.map(|b| b.0).unwrap_or_default();
    let zodiak_raw = body_params.zodiak
        .or(body_params.nama)
        .or(query.zodiak)
        .or(query.nama)
        .unwrap_or_default()
        .trim()
        .to_lowercase();


    if zodiak_raw.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'zodiak' wajib diisi (contoh: aries, taurus, gemini, cancer, leo, virgo, libra, scorpio, sagittarius, capricorn, aquarius, pisces)"
        }));
    }

    let url = format!("https://primbon.com/zodiak/{}.htm", zodiak_raw);

    match state.client.get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(html_text) = res.text().await {
                let doc = Html::parse_document(&html_text);
                let body_sel = Selector::parse("#body").unwrap();

                let body_text = doc.select(&body_sel).next().map(|el| {
                    el.text().collect::<Vec<_>>().join(" ")
                }).unwrap_or_default();

                let clean = body_text
                    .replace("(adsbygoogle = window.adsbygoogle || []).push({});", "")
                    .replace("<< Kembali", "")
                    .replace("<<<< Kembali", "");

                // Split sections
                let split_nomor: Vec<&str> = clean.split("Nomor Keberuntungan:").collect();
                let zodiak_title = split_nomor.first().unwrap_or(&"").trim();

                let rest1 = split_nomor.get(1).unwrap_or(&"");
                let split_aroma: Vec<&str> = rest1.split("Aroma Keberuntungan:").collect();
                let nomor_keberuntungan = split_aroma.first().unwrap_or(&"").trim();

                let rest2 = split_aroma.get(1).unwrap_or(&"");
                let split_planet: Vec<&str> = rest2.split("Planet Yang Mengitari:").collect();
                let aroma_keberuntungan = split_planet.first().unwrap_or(&"").trim();

                let rest3 = split_planet.get(1).unwrap_or(&"");
                let split_bunga: Vec<&str> = rest3.split("Bunga Keberuntungan:").collect();
                let planet = split_bunga.first().unwrap_or(&"").trim();

                let rest4 = split_bunga.get(1).unwrap_or(&"");
                let split_warna: Vec<&str> = rest4.split("Warna Keberuntungan:").collect();
                let bunga = split_warna.first().unwrap_or(&"").trim();

                let rest5 = split_warna.get(1).unwrap_or(&"");
                let split_batu: Vec<&str> = rest5.split("Batu Keberuntungan:").collect();
                let warna = split_batu.first().unwrap_or(&"").trim();

                let rest6 = split_batu.get(1).unwrap_or(&"");
                let split_elemen: Vec<&str> = rest6.split("Elemen Keberuntungan:").collect();
                let batu = split_elemen.first().unwrap_or(&"").trim();

                let rest7 = split_elemen.get(1).unwrap_or(&"");
                let split_pasangan: Vec<&str> = rest7.split("Pasangan Serasi:").collect();
                let elemen = split_pasangan.first().unwrap_or(&"").trim();
                let pasangan = split_pasangan.get(1).unwrap_or(&"").trim();

                Json(json!({
                    "status": true,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "result": {
                        "zodiak": zodiak_title,
                        "nomor_keberuntungan": nomor_keberuntungan,
                        "aroma_keberuntungan": aroma_keberuntungan,
                        "planet_yang_mengitari": planet,
                        "bunga_keberuntungan": bunga,
                        "warna_keberuntungan": warna,
                        "batu_keberuntungan": batu,
                        "elemen_keberuntungan": elemen,
                        "pasangan_serasi": pasangan
                    },
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                }))
            } else {
                Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": "Gagal mengurai respons dari server Primbon.",
                }))
            }
        }
        Err(e) => {
            Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": format!("Gagal menghubungi server Primbon: {}", e),
            }))
        }
    }
}

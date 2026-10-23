use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use crate::state::AppState;

const BASE: &str = "https://publicholidays.co.id/id/";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct HolidayParams {
    pub tahun: Option<String>,
}

pub async fn fetch_holidays(state: &AppState) -> Result<HashMap<String, Vec<serde_json::Value>>, String> {
    let client = &state.client;
    let resp = client.get(BASE)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("HTTP request error: {}", e))?;

    let html_text = resp.text().await.map_err(|e| format!("Text read error: {}", e))?;
    let document = Html::parse_document(&html_text);

    let h2_sel = Selector::parse("h2").unwrap();
    let table_sel = Selector::parse("table.publicholidays").unwrap();
    let tr_sel = Selector::parse("tbody tr").unwrap();
    let td_sel = Selector::parse("td").unwrap();

    let mut data: HashMap<String, Vec<serde_json::Value>> = HashMap::new();

    // Map month names
    let bulan_map: HashMap<&str, &str> = [
        ("Januari", "01"), ("Februari", "02"), ("Maret", "03"), ("April", "04"),
        ("Mei", "05"), ("Juni", "06"), ("Juli", "07"), ("Agustus", "08"),
        ("September", "09"), ("Oktober", "10"), ("November", "11"), ("Desember", "12"),
    ].into_iter().collect();

    for h2_elem in document.select(&h2_sel) {
        let text = h2_elem.text().collect::<Vec<_>>().join(" ");
        if let Some(pos) = text.find("Libur Nasional ") {
            let year = text[pos + 15..].trim().chars().take(4).collect::<String>();
            if year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()) {
                // Find next table
                // For simplicity, search document tables
                for table in document.select(&table_sel) {
                    let mut list = Vec::new();
                    for tr in table.select(&tr_sel) {
                        let tds: Vec<_> = tr.select(&td_sel).collect();
                        if tds.len() >= 3 {
                            let tanggal = tds[0].text().collect::<Vec<_>>().join(" ").trim().to_string();
                            let hari = tds[1].text().collect::<Vec<_>>().join(" ").trim().to_string();
                            let nama = tds[2].text().collect::<Vec<_>>().join(" ").trim().to_string();

                            let parts: Vec<&str> = tanggal.split_whitespace().collect();
                            if parts.len() >= 2 {
                                let tgl = parts[0];
                                let bln = parts[1];
                                let bln_num = bulan_map.get(bln).copied().unwrap_or("01");
                                let formatted_date = format!("{}-{}-{:0>2}", year, bln_num, tgl);
                                let is_cuti = nama.to_lowercase().contains("cuti bersama");

                                list.push(json!({
                                    "tanggal": formatted_date,
                                    "hari": hari,
                                    "nama": nama,
                                    "cuti_bersama": is_cuti
                                }));
                            }
                        }
                    }
                    if !list.is_empty() && !data.contains_key(&year) {
                        data.insert(year.clone(), list);
                        break;
                    }
                }
            }
        }
    }

    if data.is_empty() {
        return Err("Gagal parse data libur nasional".to_string());
    }

    Ok(data)
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HolidayParams>,
    body: Option<Json<HolidayParams>>,
) -> impl IntoResponse {
    let tahun_req = query.tahun
        .or_else(|| body.as_ref().and_then(|b| b.tahun.clone()));

    match fetch_holidays(&state).await {
        Ok(data) => {
            if let Some(y) = tahun_req {
                if let Some(list) = data.get(&y) {
                    return Json(json!({
                        "status": true,
                        "tahun": y,
                        "total": list.len(),
                        "result": list,
                    }));
                } else {
                    return Json(json!({
                        "status": false,
                        "message": format!("Data libur tahun {} tidak ditemukan", y)
                    }));
                }
            }

            Json(json!({
                "status": true,
                "result": data,
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": e
        })),
    }
}

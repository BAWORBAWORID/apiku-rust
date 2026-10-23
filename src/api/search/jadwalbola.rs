// JadwalBola — native conversion of api/search/jadwalbola.js
// Scraping tabel jadwal sepakbola dari jadwaltv.net/jadwal-sepakbola.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn handler(
    Query(_query): Query<HashMap<String, String>>,
    _body: Option<Json<Value>>,
) -> Response {
    let url = "https://www.jadwaltv.net/jadwal-sepakbola".to_string();

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(json!({
            "status": false,
            "message": format!("Gagal mendapatkan jadwal sepakbola: {e}"),
            "timestamp": chrono::Utc::now().timestamp_millis(),
        })).into_response(),
    };

    let html = match client
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return Json(json!({
                "status": false,
                "message": format!("Gagal mendapatkan jadwal sepakbola: {e}"),
                "timestamp": chrono::Utc::now().timestamp_millis(),
            })).into_response(),
        },
        Err(e) => return Json(json!({
            "status": false,
            "message": format!("Gagal mendapatkan jadwal sepakbola: {e}"),
            "timestamp": chrono::Utc::now().timestamp_millis(),
        })).into_response(),
    };

    let document = scraper::Html::parse_document(&html);
    let mut schedules: Vec<Value> = Vec::new();

    if let (Ok(sel_row), Ok(sel_td)) = (
        scraper::Selector::parse("table.table-bordered tbody tr"),
        scraper::Selector::parse("td"),
    ) {
        for row in document.select(&sel_row) {
            let cells: Vec<String> = row
                .select(&sel_td)
                .map(|td| td.text().collect::<String>().trim().to_string())
                .collect();
            if cells.len() == 4 {
                let (date, time, m, competition) = (&cells[0], &cells[1], &cells[2], &cells[3]);
                let skip_class = row.value().classes().any(|c| c == "jkllv");
                if !date.is_empty()
                    && !time.is_empty()
                    && !m.is_empty()
                    && !competition.is_empty()
                    && date.to_lowercase() != "tanggal"
                    && time.to_lowercase() != "jam"
                    && !m.contains("JadwalTV.Net")
                    && !skip_class
                {
                    schedules.push(json!({
                        "date": date,
                        "time": time,
                        "match": m,
                        "competition": competition,
                    }));
                }
            }
        }
    }

    Json(json!({
        "status": true,
        "result": {
            "title": "Jadwal Sepakbola Hari Ini",
            "url": url,
            "schedules": schedules,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

// Jadwal Sepakbola (StarLabs) — native conversion of api/search/jadwal-sepakbola.js
// Scraping tabel jadwal dari jadwaltv.net/jadwal-sepakbola.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE: &str = "https://www.jadwaltv.net";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let date = query
        .get("date")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("date").and_then(Value::as_str).map(str::to_string)));

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan jadwal sepakbola: {e}")),
    };

    let html = match client.get(format!("{}/jadwal-sepakbola", BASE)).send().await {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan jadwal sepakbola: {e}")),
        },
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan jadwal sepakbola: {e}")),
    };

    let document = scraper::Html::parse_document(&html);
    let mut jadwal: Vec<Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    if let (Ok(sel_table), Ok(sel_row), Ok(sel_col)) = (
        scraper::Selector::parse("table"),
        scraper::Selector::parse("tr"),
        scraper::Selector::parse("td"),
    ) {
        for table in document.select(&sel_table) {
            for row in table.select(&sel_row) {
                let cols: Vec<String> = row
                    .select(&sel_col)
                    .map(|c| c.text().collect::<String>().trim().to_string())
                    .collect();
                if cols.len() != 4 {
                    continue;
                }
                let (tanggal, jam, pertandingan, kompetisi) =
                    (cols[0].clone(), cols[1].clone(), cols[2].clone(), cols[3].clone());
                if tanggal.is_empty() || jam.is_empty() || pertandingan.is_empty() || kompetisi.is_empty() {
                    continue;
                }
                if tanggal.contains("Tanggal") {
                    continue;
                }
                let key = format!("{}|{}|{}", tanggal, jam, pertandingan);
                if seen.insert(key) {
                    jadwal.push(json!({
                        "tanggal": tanggal,
                        "jam": jam,
                        "pertandingan": pertandingan,
                        "kompetisi": kompetisi,
                    }));
                }
            }
        }
    }

    if jadwal.is_empty() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Tidak dapat menemukan tabel jadwal. Mungkin struktur website berubah.");
    }

    if let Some(d) = date {
        let target = d.trim().to_lowercase();
        let filtered: Vec<Value> = jadwal
            .iter()
            .filter(|item| {
                item.get("tanggal")
                    .and_then(Value::as_str)
                    .map(|t| t.to_lowercase().contains(&target))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        return Json(json!({
            "status": true,
            "result": {"tanggal": d.trim(), "total": filtered.len(), "jadwal": filtered}
        }))
        .into_response();
    }

    let mut grouped = serde_json::Map::new();
    for item in &jadwal {
        let t = item
            .get("tanggal")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let entry = grouped
            .entry(t)
            .or_insert_with(|| Value::Array(vec![]));
        if let Some(arr) = entry.as_array_mut() {
            arr.push(json!({
                "jam": item.get("jam").cloned().unwrap_or(Value::Null),
                "pertandingan": item.get("pertandingan").cloned().unwrap_or(Value::Null),
                "kompetisi": item.get("kompetisi").cloned().unwrap_or(Value::Null),
            }));
        }
    }

    Json(json!({
        "status": true,
        "result": {"total": jadwal.len(), "jadwal": jadwal, "grouped_by_date": Value::Object(grouped)}
    })).into_response()
}

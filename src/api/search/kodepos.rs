// Kodepos Search — native conversion of api/search/kodepos.js
// POST form ke kodepos.posindonesia.co.id/CariKodepos, ambil baris pertama
// dari tabel #list-data, kolom td ke-2..6.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let kodepos = query
        .get("kodepos")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("kodepos").and_then(Value::as_str).map(str::to_string)));

    let kodepos = match kodepos {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => return err(StatusCode::BAD_REQUEST, "Parameter 'kodepos' wajib diisi"),
    };

    if kodepos.len() != 5 || !kodepos.chars().all(|c| c.is_ascii_digit()) {
        return err(StatusCode::BAD_REQUEST, "Kode pos harus terdiri dari 5 digit angka");
    }

    let client = match reqwest::Client::builder()
        
        .danger_accept_invalid_certs(true)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari kodepos: {e}")),
    };

    let res = client
        .post("https://kodepos.posindonesia.co.id/CariKodepos")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("kodepos={}", urlencoding::encode(&kodepos)))
        .send()
        .await;

    let html = match res {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal membaca respons: {e}")),
        },
        Ok(r) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP {}", r.status().as_u16())),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal menghubungi Pos Indonesia: {e}")),
    };

    let document = scraper::Html::parse_document(&html);
    let mut cols: Vec<String> = Vec::new();
    if let Ok(sel_tr) = scraper::Selector::parse("#list-data tbody tr") {
        if let Some(row) = document.select(&sel_tr).next() {
            if let Ok(sel_td) = scraper::Selector::parse("td") {
                for td in row.select(&sel_td) {
                    cols.push(td.text().collect::<String>().trim().to_string());
                }
            }
        }
    }

    if cols.len() < 6 {
        return err(StatusCode::NOT_FOUND, "Kodepos tidak ditemukan di database Pos Indonesia");
    }

    Json(json!({
        "status": true,
        "result": {
            "kodepos": cols[1],
            "desa_kelurahan": cols[2],
            "kecamatan": cols[3],
            "kota_kabupaten": cols[4],
            "provinsi": cols[5],
        }
    })).into_response()

}

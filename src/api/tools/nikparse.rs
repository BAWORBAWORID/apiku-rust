// NikParse — native conversion of api/tools/nikparse.js
// Data wilayah di-embed dari assets/nikparse/wilayah.json (sama dengan Node).
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Datelike;
use serde_json::{json, Value};
use std::collections::HashMap;

const WILAYAH_JSON: &str = include_str!("assets/nikparse/wilayah.json");

const HARI: [&str; 7] = [
    "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu",
];

const ZODIAK: [(&str, (u32, u32), (u32, u32)); 12] = [
    ("Capricorn", (12, 22), (1, 19)),
    ("Aquarius", (1, 20), (2, 18)),
    ("Pisces", (2, 19), (3, 20)),
    ("Aries", (3, 21), (4, 19)),
    ("Taurus", (4, 20), (5, 20)),
    ("Gemini", (5, 21), (6, 20)),
    ("Cancer", (6, 21), (7, 22)),
    ("Leo", (7, 23), (8, 22)),
    ("Virgo", (8, 23), (9, 22)),
    ("Libra", (9, 23), (10, 22)),
    ("Scorpio", (10, 23), (11, 21)),
    ("Sagittarius", (11, 22), (12, 21)),
];

fn get_zodiak(day: u32, month: u32) -> &'static str {
    for (name, start, end) in ZODIAK.iter() {
        let (sm, sd) = *start;
        let (em, ed) = *end;
        if sm == em {
            if month == sm && day >= sd && day <= ed {
                return name;
            }
        } else if (month == sm && day >= sd) || (month == em && day <= ed) {
            return name;
        }
    }
    "Unknown"
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let nik = match query.get("nik").cloned() {
        Some(n) => n,
        None => {
            return Json(json!({"status": false, "message": "NIK harus 16 digit angka"}))
                .into_response()
        }
    };

    if nik.len() != 16 || !nik.chars().all(|c| c.is_ascii_digit()) {
        return Json(json!({"status": false, "message": "NIK harus 16 digit angka"}))
            .into_response();
    }

    let wilayah: Value = match serde_json::from_str(WILAYAH_JSON) {
        Ok(v) => v,
        Err(_) => {
            return Json(json!({"status": false, "message": "Gagal memuat data wilayah"}))
                .into_response()
        }
    };

    let province_id = &nik[0..2];
    let regency_id = &nik[0..4];
    let district_id = &nik[0..6];

    let provinsi = wilayah
        .get("provinsi")
        .and_then(|p| p.get(province_id))
        .and_then(|v| v.as_str());
    let kabkot = wilayah
        .get("kabkot")
        .and_then(|p| p.get(regency_id))
        .and_then(|v| v.as_str());
    let kecamatan_raw = wilayah
        .get("kecamatan")
        .and_then(|p| p.get(district_id))
        .and_then(|v| v.as_str());

    let (provinsi_name, kabkot_name, kecamatan_raw) = match (provinsi, kabkot, kecamatan_raw) {
        (Some(p), Some(k), Some(d)) => (p, k, d),
        _ => {
            let msg = if provinsi.is_none() {
                "Kode provinsi tidak valid"
            } else if kabkot.is_none() {
                "Kode kabupaten/kota tidak valid"
            } else {
                "Kode kecamatan tidak valid"
            };
            return Json(json!({"status": false, "message": msg})).into_response();
        }
    };

    let day_raw: u32 = nik[6..8].parse().unwrap_or(0);
    let month: u32 = nik[8..10].parse().unwrap_or(0);
    let year_code: u32 = nik[10..12].parse().unwrap_or(0);

    if month == 0 || month > 12 || day_raw == 0 || day_raw > 71 {
        return Json(json!({"status": false, "message": "Tanggal lahir tidak valid"}))
            .into_response();
    }

    let gender = if day_raw > 40 {
        "PEREMPUAN"
    } else {
        "LAKI-LAKI"
    };
    let day_adjusted = if day_raw > 40 { day_raw - 40 } else { day_raw };

    if day_adjusted == 0 || day_adjusted > 31 {
        return Json(json!({"status": false, "message": "Tanggal lahir tidak valid"}))
            .into_response();
    }

    let now = chrono::Utc::now();
    let current_year = now.year() as i64;
    let current_year_short = (current_year % 100) as u32;
    let year: i64 = if year_code <= current_year_short {
        2000 + year_code as i64
    } else {
        1900 + year_code as i64
    };

    let birth = match chrono::NaiveDate::from_ymd_opt(year as i32, month, day_adjusted) {
        Some(d) => d,
        None => {
            return Json(json!({"status": false, "message": "Tanggal lahir tidak valid"}))
                .into_response()
        }
    };
    let today = now.date_naive();
    let mut age_years = today.year() - birth.year();
    let mut age_months = today.month() as i32 - birth.month() as i32;
    let mut age_days = today.day() as i32 - birth.day() as i32;

    if age_days < 0 {
        age_months -= 1;
        let prev_month_end = if today.month() == 1 {
            chrono::NaiveDate::from_ymd_opt(today.year() - 1, 12, 31).unwrap()
        } else {
            chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap()
                - chrono::Duration::days(1)
        };
        age_days += prev_month_end.day() as i32;
    }
    if age_months < 0 {
        age_years -= 1;
        age_months += 12;
    }

    let hari = HARI[birth.weekday().num_days_from_sunday() as usize];
    let zodiak = get_zodiak(day_adjusted, month);
    let kodepos: u32 = kecamatan_raw
        .rsplit(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|s| s.get(s.len().saturating_sub(5)..))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let kecamatan_name = kecamatan_raw.split(" -- ").next().unwrap_or(kecamatan_raw);

    Json(json!({
        "status": true,
        "result": {
            "nik": nik,
            "valid": true,
            "kelamin": gender,
            "lahir": format!("{:02}/{:02}/{}", day_adjusted, month, year),
            "hari": hari,
            "zodiak": zodiak,
            "usia": format!("{} Tahun {} Bulan {} Hari", age_years, age_months, age_days),
            "usia_tahun": age_years,
            "provinsi": { "kode": province_id, "nama": provinsi_name },
            "kotakab": {
                "kode": regency_id,
                "nama": kabkot_name,
                "jenis": if kabkot_name.starts_with("KOTA") { "Kota" } else { "Kabupaten" },
            },
            "kecamatan": { "kode": district_id, "nama": kecamatan_name },
            "kodepos": kodepos,
            "nomor_urut": &nik[12..16],
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()

}

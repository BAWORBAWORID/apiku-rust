use axum::{extract::State, response::IntoResponse, Json};
use chrono::{Datelike, FixedOffset, Utc};
use serde_json::json;
use crate::state::AppState;
use super::hari_libur::fetch_holidays;

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    // WIB is UTC+7
    let wib_offset = FixedOffset::east_opt(7 * 3600).unwrap();
    let now_wib = Utc::now().with_timezone(&wib_offset);

    let today_str = now_wib.format("%Y-%m-%d").to_string();
    let weekday_name = match now_wib.weekday() {
        chrono::Weekday::Mon => "Senin",
        chrono::Weekday::Tue => "Selasa",
        chrono::Weekday::Wed => "Rabu",
        chrono::Weekday::Thu => "Kamis",
        chrono::Weekday::Fri => "Jumat",
        chrono::Weekday::Sat => "Sabtu",
        chrono::Weekday::Sun => "Minggu",
    };

    let holidays_res = fetch_holidays(&state).await;

    let mut is_holiday = false;
    let mut holiday_name: Option<String> = None;
    let mut is_cuti_bersama = false;
    let mut next_holiday: Option<serde_json::Value> = None;

    if let Ok(data) = holidays_res {
        for (_year, list) in data {
            for h in list {
                if let Some(tgl) = h.get("tanggal").and_then(|v| v.as_str()) {
                    if tgl == today_str {
                        is_holiday = true;
                        holiday_name = h.get("nama").and_then(|v| v.as_str()).map(|s| s.to_string());
                        is_cuti_bersama = h.get("cuti_bersama").and_then(|v| v.as_bool()).unwrap_or(false);
                    } else if tgl > today_str.as_str() {
                        if next_holiday.is_none() {
                            next_holiday = Some(h.clone());
                        }
                    }
                }
            }
        }
    }

    let mut result = json!({
        "tanggal": today_str,
        "hari": weekday_name,
        "libur_nasional": is_holiday,
        "libur_berikutnya": next_holiday
    });

    if is_holiday {
        result["nama"] = json!(holiday_name);
        result["cuti_bersama"] = json!(is_cuti_bersama);
    }

    Json(json!({
        "status": true,
        "result": result,
    })).into_response()
}

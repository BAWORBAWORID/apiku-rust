// JadwalTV — native conversion of api/search/jadwaltv.js
// Scraping tabel jadwal channel TV dari jadwaltv.net.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const CHANNELS: &[(&str, &str)] = &[
    ("tvri", "tvri"), ("antv", "antv"), ("transtv", "transtv"), ("gtv", "gtv"),
    ("indosiar", "indosiar"), ("inewstv", "inewstv"), ("kompastv", "kompastv"),
    ("moji", "moji"), ("rtv", "rtv"), ("rctv", "rtv"), ("rcti", "rcti"),
    ("sctv", "sctv"), ("tvone", "tvone"), ("trans7", "trans7"),
    ("metrotv", "metrotv"), ("mnctv", "mnctv"),
];

fn available_channels() -> Vec<&'static str> {
    CHANNELS.iter().filter(|(k, _)| *k != "rctv").map(|(k, _)| *k).collect()
}

fn err(status: StatusCode, mut obj: Value) -> Response {
    if let Some(o) = obj.as_object_mut() {
        o.insert("status".into(), json!(false));
    }
    (status, Json(obj)).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let channel = query
        .get("channel")
        .cloned()
        .or_else(|| body.as_ref().and_then(|Json(v)| v.get("channel").and_then(Value::as_str).map(str::to_string)));

    let channel = match channel {
        Some(c) if !c.trim().is_empty() => c.trim().to_lowercase(),
        _ => return err(StatusCode::BAD_REQUEST, json!({
            "message": "Parameter 'channel' wajib diisi",
            "available_channels": available_channels(),
        })),
    };

    let target = match CHANNELS.iter().find(|(k, _)| *k == channel) {
        Some((_, t)) => *t,
        None => return err(StatusCode::BAD_REQUEST, json!({
            "message": format!("Channel '{}' tidak ditemukan", channel),
            "available_channels": available_channels(),
        })),
    };

    let url = format!("https://www.jadwaltv.net/channel/{}", target);

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, json!({"message": format!("Gagal mendapatkan jadwal TV: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()})),
    };

    let html = match client
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, json!({"message": format!("Gagal mendapatkan jadwal TV: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()})),
        },
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, json!({"message": format!("Gagal mendapatkan jadwal TV: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()})),
    };

    let document = scraper::Html::parse_document(&html);
    let mut result: Vec<Value> = Vec::new();

    if let (Ok(sel_row), Ok(sel_td)) = (
        scraper::Selector::parse("table.table-bordered tbody tr"),
        scraper::Selector::parse("td"),
    ) {
        for row in document.select(&sel_row) {
            let cells: Vec<String> = row
                .select(&sel_td)
                .map(|td| td.text().collect::<String>().trim().to_string())
                .collect();
            if cells.len() == 2 {
                let (time, event) = (&cells[0], &cells[1]);
                let skip_class = row.value().classes().any(|c| c == "jkllv");
                if !time.is_empty()
                    && !event.is_empty()
                    && time.to_lowercase() != "jam"
                    && event.to_lowercase() != "acara"
                    && !event.contains("JadwalTV.Net")
                    && !skip_class
                {
                    result.push(json!({"time": time, "event": event}));
                }
            }
        }
    }

    if result.is_empty() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, json!({
            "message": format!("Gagal mendapatkan jadwal acara untuk channel {}.", target),
            "timestamp": chrono::Utc::now().timestamp_millis(),
        }));
    }

    Json(json!({
        "status": true,
        "result": {
            "channel": target,
            "title": format!("Jadwal {} Hari Ini", target.to_uppercase()),
            "url": url,
            "schedule": result,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

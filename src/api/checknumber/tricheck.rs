// Tri Check — native conversion of api/checknumber/tricheck.js
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn merged(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Value {
    let mut m = json!({});
    if let Some(Json(b)) = body {
        if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } }
    }
    for (k, v) in query { m[k] = json!(v); }
    m
}

fn str_param(m: &Value, key: &str) -> Option<String> {
    match m.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .build().unwrap_or_default()
}

fn status_emoji(status: &str) -> &'static str {
    let s = status.to_lowercase();
    if s.contains("aktif") || s.contains("sudah") || s.contains("registrasi") { "✅" }
    else if s.contains("non") || s.contains("belum") { "❌" }
    else if s.contains("blok") { "🔒" }
    else { "❓" }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(number) = str_param(&m, "number") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'number' wajib diisi"}))).into_response();
    };
    let mut msisdn: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if msisdn.starts_with("08") { msisdn = format!("62{}", &msisdn[1..]); }
    if !msisdn.starts_with("6289") || msisdn.len() < 6 || !matches!(msisdn.as_bytes().get(4), Some(b'5'..=b'9')) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Nomor bukan prefix SIM TRI (0895–0899)"}))).into_response();
    }
    let res = client().post("https://tri.co.id/api/v1/information/sim-status")
                    .header("Content-Type", "application/json")
        .header("sec-ch-ua-platform", "\"Android\"")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36")
                    .header("Accept", "application/json, text/plain, */*")
        .header("sec-ch-ua", "\"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"145\", \"Chromium\";v=\"145\"")
                    .header("sec-ch-ua-mobile", "?1")
                    .header("Origin", "https://tri.co.id")
                    .header("Sec-Fetch-Site", "same-origin")
                    .header("Sec-Fetch-Mode", "cors")
                    .header("Sec-Fetch-Dest", "empty")
                    .header("Referer", "https://tri.co.id/")
                    .header("Accept-Language", "id,en-US;q=0.9,en;q=0.8,ar;q=0.7")
        .json(&json!({ "action": "MSISDN_STATUS_WEB", "input1": "", "input2": "", "language": "ID", "msisdn": msisdn }))
        .send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string()}))).into_response(),
    };
    let result: Value = res.json().await.unwrap_or(Value::Null);
    if result.get("status").and_then(|v| v.as_bool()) != Some(true) {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Nomor tidak valid atau bukan SIM TRI"}))).into_response();
    }
    let data = result.get("data").cloned().unwrap_or(json!({}));
    if data.get("responseCode").and_then(|v| v.as_str()) != Some("00000") {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Nomor tidak valid atau bukan SIM TRI"}))).into_response();
    }
    let g = |k: &str| data.get(k).cloned().unwrap_or(Value::Null);
    let card_status = g("cardStatus").as_str().unwrap_or("").to_string();
    let act_status = g("activationStatus").as_str().unwrap_or("").to_string();
    let remaining_days: Value = match g("actEndDate").as_str() {
        Some(d) => match chrono::DateTime::parse_from_rfc3339(&chrono_date_to_iso(d)) {
            Ok(end) => json!((end.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_days().max(0)),
            Err(_) => json!("-"),
        },
        None => json!("-"),
    };
    Json(json!({
        "status": true,
        "result": {
            "informasi_umum": { "nomor": g("msisdn"), "iccid": g("iccid") },
            "status_layanan": {
                "kartu": { "status": g("cardStatus"), "emoji": status_emoji(&card_status) },
                "registrasi": { "status": g("activationStatus"), "emoji": status_emoji(&act_status) }
            },
            "masa_berlaku": {
                "aktivasi": g("activationDate").as_str().map(|s| json!(if s.is_empty() { "-".to_string() } else { s.to_string() })).unwrap_or(json!("-")),
                "berakhir": g("actEndDate").as_str().map(|s| json!(if s.is_empty() { "-".to_string() } else { s.to_string() })).unwrap_or(json!("-")),
                "sisa_waktu_hari": remaining_days
            },
            "produk_distribusi": {
                "produk": g("prodDesc").as_str().map(|s| json!(if s.is_empty() { "-".to_string() } else { s.to_string() })).unwrap_or(json!("-")),
                "wilayah": g("retDistrict").as_str().map(|s| json!(if s.is_empty() { "-".to_string() } else { s.to_string() })).unwrap_or(json!("-"))
            }
        }
    })).into_response()
}

/// Tri returns e.g. "2026-11-06" or ISO-ish; try common formats.
fn chrono_date_to_iso(s: &str) -> String {
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f%:z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"] {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return dt.and_utc().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        }
        if let Ok(d) = chrono::NaiveDate::parse_from_str(s, fmt) {
            return d.and_hms_opt(0, 0, 0).unwrap().and_utc().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        }
    }
    s.to_string()
}

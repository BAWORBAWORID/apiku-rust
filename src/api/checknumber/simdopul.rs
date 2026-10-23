// SIDOMPUL CHECKER — native conversion of api/checknumber/simdopul.js
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

const XL_PREFIXES: &[&str] = &["817", "818", "819", "859", "877", "878", "887", "888", "889", "898", "899"];
const AXIS_PREFIXES: &[&str] = &["831", "832", "833", "838", "839"];

fn provider_from(number: &str) -> Option<&'static str> {
    let mut c: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if c.starts_with("62") { c = c[2..].to_string(); }
    else if c.starts_with('0') { c = c[1..].to_string(); }
    let prefix = &c[..c.len().min(3)];
    if XL_PREFIXES.contains(&prefix) { Some("XL") }
    else if AXIS_PREFIXES.contains(&prefix) { Some("AXIS") }
    else { None }
}

fn format_number(number: &str) -> String {
    let mut c: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if c.starts_with('0') { c = format!("62{}", &c[1..]); }
    else if !c.starts_with("62") { c = format!("62{}", c); }
    c
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(nomor) = str_param(&m, "nomor") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'nomor' wajib diisi", "result": null}))).into_response();
    };
    let formatted = format_number(&nomor);
    let provider = provider_from(&nomor);
    let Some(provider) = provider else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Maaf, saat ini hanya mendukung nomor XL dan AXIS saja",
            "result": { "nomor": formatted, "nomor_asli": nomor, "provider": null, "provider_didukung": ["XL", "AXIS"] },
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response();
    };
    let res = client().get("https://bendith.my.id/end.php")
        .query(&[("check", "package"), ("number", formatted.as_str()), ("version", "2")])
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36")
                    .header("Referer", "https://bendith.my.id/")
        .send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false, "message": "Gagal terhubung ke server Sidompul",
                "result": { "nomor": formatted, "provider": provider, "error": e.to_string() },
                "timestamp": chrono::Utc::now().timestamp_millis()
            }))).into_response();
        }
    };
    let status_code = res.status();
    let data: Value = match res.json().await {
        Ok(d) => d,
        Err(_) => json!({ "success": false, "message": format!("Server merespon dengan status {}", status_code) }),
    };
    if data.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": data.get("message").and_then(|v| v.as_str()).unwrap_or("Gagal mendapatkan data dari server"),
            "result": { "nomor": formatted, "provider": provider, "detail_error": data },
            "timestamp": chrono::Utc::now().timestamp_millis()
        }))).into_response();
    }
    let info = |p: &str, def: Value| data.pointer(&format!("/data/subs_info{}", p)).cloned().unwrap_or(def);
    let dstr = |p: &str| info(p, json!("Tidak diketahui"));
    Json(json!({
        "status": true,
        "message": format!("Berhasil mendapatkan data untuk nomor {}", provider),
        "result": {
            "nomor": formatted,
            "nomor_asli": nomor,
            "provider": provider,
            "info_pelanggan": {
                "msisdn": info("/msisdn", Value::Null),
                "operator": info("/operator", Value::Null),
                "verifikasi_id": dstr("/id_verified"),
                "jenis_jaringan": dstr("/net_type"),
                "masa_aktif": dstr("/tenure"),
                "tanggal_kedaluwarsa": dstr("/exp_date"),
                "masa_tenggang": dstr("/grace_until"),
                "volte": {
                    "perangkat": info("/volte/device", json!(false)),
                    "area": info("/volte/area", json!(false)),
                    "kartu": info("/volte/simcard", json!(false))
                }
            },
            "info_paket": {
                "pesan": data.pointer("/data/package_info/error_message").cloned().unwrap_or(json!("Tidak ada informasi paket")),
                "paket_aktif": data.pointer("/data/package_info/packages").cloned().unwrap_or(json!([]))
            }
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()
}

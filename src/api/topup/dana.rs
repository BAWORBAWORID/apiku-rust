// DANA TOP UP QRIS — native conversion of api/topup/dana.js
// Order creation is fully native via Tokogame. Node also rendered the QR PNG
// via the qrcode package; the native build has no QR image engine, so qr_url
// uses the upstream checkoutUrl.qrUrl when available and reports qr_url=null
// otherwise (qris_content is always included).
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

use super::tokogame;

const PRODUCT_ID: &str = "67ca818d93cbad5184377578";

const PACKAGES: &[( &str, i64, &str )] = &[
    ("1000", 1000, "DANA 1.000"), ("10000", 10000, "DANA 10.000"), ("20000", 20000, "DANA 20.000"),
    ("25000", 25000, "DANA 25.000"), ("30000", 30000, "DANA 30.000"), ("35000", 35000, "DANA 35.000"),
    ("40000", 40000, "DANA 40.000"), ("45000", 45000, "DANA 45.000"), ("50000", 50000, "DANA 50.000"),
    ("55000", 55000, "DANA 55.000"), ("60000", 60000, "DANA 60.000"), ("65000", 65000, "DANA 65.000"),
    ("70000", 70000, "DANA 70.000"), ("75000", 75000, "DANA 75.000"), ("80000", 80000, "DANA 80.000"),
    ("85000", 85000, "DANA 85.000"), ("90000", 90000, "DANA 90.000"), ("95000", 95000, "DANA 95.000"),
    ("100000", 100000, "DANA 100.000"), ("125000", 125000, "DANA 125.000"), ("150000", 150000, "DANA 150.000"),
    ("200000", 200000, "DANA 200.000"), ("250000", 250000, "DANA 250.000"), ("300000", 300000, "DANA 300.000"),
    ("350000", 350000, "DANA 350.000"), ("400000", 400000, "DANA 400.000"), ("500000", 500000, "DANA 500.000"),
    ("600000", 600000, "DANA 600.000"), ("700000", 700000, "DANA 700.000"), ("800000", 800000, "DANA 800.000"),
    ("900000", 900000, "DANA 900.000"), ("1000000", 1000000, "DANA 1.000.000"),
    ("2000000", 2000000, "DANA 2.000.000"), ("3000000", 3000000, "DANA 3.000.000"),
];

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(nomor) = str_param(&m, "nomor") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter \"nomor\" wajib diisi"}))).into_response();
    };
    let cleaned: String = nomor.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned.len() < 10 || cleaned.len() > 15 {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Nomor harus 10-15 digit"}))).into_response();
    }
    let nominal = str_param(&m, "nominal").unwrap_or_else(|| "50000".to_string());
    let Some((_, pkg_nominal, pkg_label)) = PACKAGES.iter().find(|(c, n, _)| *c == nominal || n.to_string() == nominal) else {
        let opts = PACKAGES.iter().map(|(_, n, _)| n.to_string()).collect::<Vec<_>>().join(", ");
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": format!("Nominal \"{}\" tidak tersedia. Pilihan: {}", nominal, opts)}))).into_response();
    };
    let pkg_code = nominal.clone(); // nomor cleaned var name reuse OK
    let questionnaire = json!([{
        "questionnaire": {
            "code": "userid",
            "inputType": "NUMBER",
            "regexValidation": {
                "regex": "^08\\d{8,12}$",
                "errorMessages": [ { "language": "ID", "title": "Format Nomor HP Salah", "body": "Format nomor HP salah. Mohon masukkan nomor yang dimulai dengan 08..." } ]
            },
            "translations": [ { "language": "ID", "question": "Masukkan No. HP", "description": "Nomor HP", "choices": [] } ]
        },
        "answer": cleaned
    }]);
    let (status, data) = match tokogame::create_order(PRODUCT_ID, &pkg_code, questionnaire).await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e}))).into_response(),
    };
    if !status.is_success() || data.get("code").and_then(|v| v.as_str()) != Some("SUCCESS") {
        return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": data.get("message").and_then(|v| v.as_str()).unwrap_or("Gagal membuat order"),
            "detail": data
        }))).into_response();
    }
    let d = data.get("data").cloned().unwrap_or(json!({}));
    let order_id = d.get("id").cloned().unwrap_or(Value::Null);
    let order_code = d.get("code").cloned().unwrap_or(Value::Null);
    let harga = d.get("totalPriceInCents").and_then(|v| v.as_f64()).map(|c| c / 100.0).unwrap_or(0.0);
    let checkout = d.get("checkoutUrl").cloned().unwrap_or(json!({}));
    let qris_content = checkout.get("qr").and_then(|v| v.as_str()).map(|s| s.to_string());
    let qris_image_url = checkout.get("qrUrl").and_then(|v| v.as_str()).map(|s| s.to_string());
    Json(json!({
        "status": true,
        "result": {
            "orderId": order_id,
            "orderCode": order_code,
            "nomor": cleaned,
            "nominal": pkg_nominal,
            "label": pkg_label,
            "harga": harga,
            "qr_url": qris_image_url,
            "qris_content": qris_content
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()
}

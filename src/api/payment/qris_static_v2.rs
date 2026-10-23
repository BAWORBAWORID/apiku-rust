// QRIS Static v2 — native conversion of api/payment/qris-static-v2.js
// Payload builder is native (TLV + CRC16). Node rendered a QR image (with
// optional logo compositing via sharp/canvas) and returned raw image bytes;
// the native build has no QR image engine, so it responds honestly with JSON.
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
        Some(Value::Bool(b)) => Some(b.to_string()),
        _ => None,
    }
}

fn crc16_ccitt(s: &str) -> String {
    let mut crc: u32 = 0xffff;
    for c in s.chars() {
        crc ^= (c as u32) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
            crc &= 0xffff;
        }
    }
    format!("{:04X}", crc)
}

fn parse_tlv(data: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b: Vec<char> = data.chars().collect();
    let mut i = 0;
    while i + 4 <= b.len() {
        let id: String = b[i..i + 2].iter().collect();
        let len_str: String = b[i + 2..i + 4].iter().collect();
        let len: usize = len_str.parse().unwrap_or(0);
        if i + 4 + len > b.len() { break; }
        let value: String = b[i + 4..i + 4 + len].iter().collect();
        out.push((id, value));
        i += 4 + len;
    }
    out
}

fn build_tlv(tlvs: &[(String, String)]) -> String {
    tlvs.iter().map(|(id, v)| format!("{}{:02}{}", id, v.chars().count(), v)).collect()
}

fn with_crc(qr: &str) -> String {
    let base = if qr.len() > 8 && qr.rfind("6304").map(|p| qr.len() - p == 8).unwrap_or(false) {
        &qr[..qr.len() - 8]
    } else { qr };
    format!("{}6304{}", base, crc16_ccitt(&format!("{}6304", base)))
}

fn set_amount(qr: &str, amount: i64) -> String {
    let mut tlvs = parse_tlv(qr);
    let value = amount.to_string();
    match tlvs.iter().position(|(id, _)| id == "54") {
        Some(idx) => tlvs[idx].1 = value,
        None => {
            let pos = tlvs.len().saturating_sub(1);
            tlvs.insert(pos, ("54".to_string(), value));
        }
    }
    with_crc(&build_tlv(&tlvs))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(qr) = str_param(&m, "qr") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'qr' wajib diisi"}))).into_response();
    };
    let amount_raw = str_param(&m, "amount");
    let amount = amount_raw.as_ref().and_then(|a| a.replace(|c: char| !c.is_ascii_digit(), "").parse::<i64>().ok());
    let Some(amount) = amount else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'amount' harus angka"}))).into_response();
    };
    let qr_string = set_amount(&qr, amount);
    Json(json!({
        "status": false,
        "message": "Render QR image (with logo) butuh QR image engine, belum didukung native. Gunakan qr_string berikut:",
        "result": { "qr_string": qr_string, "amount": amount }
    })).into_response()
}

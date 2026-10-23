// FREE FIRE TOP UP — native conversion of api/topup/ff.js
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
use super::tokogame;

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

const PRODUCT_ID: &str = "644359b1f61740160ca158ca";

const PACKAGES: &[(&str, &str, &str)] = &[
    ("FF_5--73", "5 Diamonds", "Diamonds"),
    ("FF_10--73", "10 Diamonds", "Diamonds"),
    ("FF12-S29", "12 Diamonds", "Diamonds"),
    ("FF_15--73", "15 Diamonds", "Diamonds"),
    ("FF_20--73", "20 Diamonds", "Diamonds"),
    ("FF_25--73", "25 Diamonds", "Diamonds"),
    ("FF_30--73", "30 Diamonds", "Diamonds"),
    ("FFLUPL6-S24", "Level Up Pass - Level 6", "Cards & Passes"),
    ("FF_40--2", "40 Diamonds", "Diamonds"),
    ("FF_50--2", "50 Diamonds", "Diamonds"),
    ("FF55-S29", "55 Diamonds", "Diamonds"),
    ("FF_60--2", "60 Diamonds", "Diamonds"),
    ("FFLUPL10-S24", "Level Up Pass - Level 10", "Cards & Passes"),
    ("FFLUPL15-S24", "Level Up Pass - Level 15", "Cards & Passes"),
    ("FFLUPL20-S24", "Level Up Pass - Level 20", "Cards & Passes"),
    ("FFLUPL25-S24", "Level Up Pass - Level 25", "Cards & Passes"),
    ("FF70-S29", "70 Diamonds", "Diamonds"),
    ("FF_75--2", "75 Diamonds", "Diamonds"),
    ("FF70", "70 Diamods", "Diamonds"),
    ("FF_80--2", "80 Diamonds", "Diamonds"),
    ("FF_90--2", "90 Diamonds", "Diamonds"),
    ("FF100-S29", "100 Diamonds", "Diamonds"),
    ("FFLUPL30-S24", "Level Up Pass - Level 30", "Cards & Passes"),
    ("FF120-S29", "120 Diamonds", "Diamonds"),
    ("FF130-S29", "130 Diamonds", "Diamonds"),
    ("FF140-S29", "140 Diamonds", "Diamonds"),
    ("FF_145--2", "145 Diamonds", "Diamonds"),
    ("FF_150--2", "150 Diamonds", "Diamonds"),
    ("FF_160--2", "160 Diamonds", "Diamonds"),
    ("FF_180--2", "180 Diamonds", "Diamonds"),
    ("FF190", "190 Diamonds", "Diamonds"),
    ("FF200-S29", "200 Diamonds", "Diamonds"),
    ("FF210", "210 Diamonds", "Diamonds"),
    ("FF_MM--18", "Mingguan Membership", "Memberships"),
    ("FF_250--2", "250 Diamonds", "Diamonds"),
    ("FF_260--2", "260 Diamonds", "Diamonds"),
    ("FF280-S29", "280 Diamonds", "Diamonds"),
    ("FF_300--2", "300 DIamonds", "Diamonds"),
    ("FF_BP--73", "BP Card", "Cards & Passes"),
    ("FF355-S29", "355 Diamonds", "Diamonds"),
    ("FF_360--2", "360 Diamonds", "Diamonds"),
    ("FF_375--2", "375 Diamonds", "Diamonds"),
    ("FF_400--2", "400 Diamonds", "Diamonds"),
    ("FF_405--2", "405 Diamonds", "Diamonds"),
    ("FF420-S29", "420 Diamonds", "Diamonds"),
    ("FF_425--2", "425 Diamonds", "Diamonds"),
    ("FF_MM_2--73", "Mingguan Membership x2", "Memberships"),
    ("FF_475--2", "475 DIamonds", "Diamonds"),
    ("FF_495--2", "495 DIamonds", "Diamonds"),
    ("FF_500--2", "500 Diamonds", "Diamonds"),
    ("FF_512--2", "512 Diamonds", "Diamonds"),
    ("FF_515--2", "515 Diamonds", "Diamonds"),
    ("FF_520--2", "520 Diamonds", "Diamonds"),
    ("FF_545--2", "545 Diamonds", "Diamonds"),
    ("FF565-S29", "565 Diamonds", "Diamonds"),
    ("FF_600--2", "600 Diamonds", "Diamonds"),
    ("FF635-S29", "635 Diamonds", "Diamonds"),
    ("FF_645--2", "645 Diamonds", "Diamonds"),
    ("FF_MB--18", "Bulanan Membership", "Memberships"),
    ("FF_655--2", "655 Diamonds", "Diamonds"),
    ("FF720-S29", "720 Diamonds", "Diamonds"),
    ("FFMx3", "Mingguan Membership x3", "Memberships"),
    ("FF_725--73", "725 Diamonds", "Diamonds"),
    ("FF_740--73", "740 Diamonds", "Diamonds"),
    ("FF_770--73", "770 DIamonds", "Diamonds"),
    ("FF_790--73", "790 DIamonds", "Diamonds"),
    ("FF800-S29", "800 Diamonds", "Diamonds"),
    ("FF860-S29", "860 Diamonds", "Diamonds"),
    ("FF930-S29", "930 Diamonds", "Diamonds"),
    ("FFMx4", "Mingguan Membership x4", "Memberships"),
    ("FF1000-S29", "1000 Diamonds", "Diamonds"),
    ("FF1050-S29", "1050 Diamonds", "Diamonds"),
    ("FF1075-S29", "1075 Diamonds", "Diamonds"),
    ("FF1080-S29", "1080 Diamonds", "Diamonds"),
    ("FFMx5", "Mingguan Membership x5", "Memberships"),
    ("FF_1200--73", "1200 Diamonds", "Diamonds"),
    ("FF_1215--73", "1215 Diamonds", "Diamonds"),
    ("FF_1300--73", "1300 Diamonds", "Diamonds"),
    ("FF_MB_2--91", "Bulanan Membership x2", "Memberships"),
    ("FF_1450--73", "1450 Diamonds", "Diamonds"),
    ("FF_1490--73", "1490 Diamonds", "Diamonds"),
    ("FF_1510--73", "1510 DIamonds", "Diamonds"),
    ("FF1580", "1580 Diamonds", "Diamonds"),
    ("FF_1800--73", "1800 Diamonds", "Diamonds"),
    ("FF_1875--73", "1875 Diamonds", "Diamonds"),
    ("FF_1975--73", "1975 Diamonds", "Diamonds"),
    ("FF_2000--73", "2000 Diamonds", "Diamonds"),
    ("FF_2100--73", "2100 Diamonds", "Diamonds"),
    ("FF_2140--73", "2140 Diamonds", "Diamonds"),
    ("FF_2180--73", "2180 Diamonds", "Diamonds"),
    ("FFBx3", "Bulanan Membership x3", "Memberships"),
    ("FF2200", "2200 Diamonds", "Diamonds"),
    ("FF2210", "2210 Diamonds", "Diamonds"),
    ("FF_2225--2", "2225 Diamonds", "Diamonds"),
    ("FF_2280--73", "2280 Diamonds", "Diamonds"),
    ("FF2355", "2355 Diamonds", "Diamonds"),
    ("FF_2400--2", "2400 Diamonds", "Diamonds"),
    ("FF_2575--73", "2575 Diamonds", "Diamonds"),
    ("FF_2750--73", "2750 Diamonds", "Diamonds"),
    ("FFBx4", "Bulanan Membership x4", "Memberships"),
    ("FF_3000--73", "3000 Diamonds", "Diamonds"),
    ("FF_3310--73", "3310 Diamonds", "Diamonds"),
    ("FF_3620--73", "3620 Diamonds", "Diamonds"),
    ("FF3640", "3640 Diamonds", "Diamonds"),
    ("FFBx5", "Bulanan Membership x5", "Memberships"),
    ("FF_3675--73", "3675 Diamonds", "Diamonds"),
    ("FF_3800--73", "3800 Diamonds", "Diamonds"),
    ("FF_4000--73", "4000 Diamonds", "Diamonds"),
    ("FF_4050--73", "4050 Diamonds", "Diamonds"),
    ("FF_4340--73", "4340 Diamonds", "Diamonds"),
    ("FF_4450--73", "4450 Diamonds", "Diamonds"),
    ("FF_4720--73", "4720 Diamonds", "Diamonds"),
    ("FF_4850--73", "4850 Diamonds", "Diamonds"),
    ("FF5500", "5500 Diamonds", "Diamonds"),
    ("FF_5600--73", "5600 Diamonds", "Diamonds"),
    ("FF_6000--73", "6000 Diamonds", "Diamonds"),
    ("FF_6480--73", "6480 Diamonds", "Diamonds"),
    ("FF_6550--73", "6550 Diamonds", "Diamonds"),
    ("FF_6900--73", "6900 Diamonds", "Diamonds"),
    ("FF_7290--73", "7290 Diamonds", "Diamonds"),
    ("FF_7650--73", "7650 Diamonds", "Diamonds"),
    ("FF_8010--73", "8010 Diamonds", "Diamonds"),
    ("FF_8730--2", "8730 Diamonds", "Diamonds"),
    ("FF_9290--73", "9290 Diamonds", "Diamonds"),
    ("FF_9800--73", "9800 Diamonds", "Diamonds"),
    ("FF_14580--73", "14580 Diamonds", "Diamonds"),
    ("FF_36500--73", "36500 DIamonds", "Diamonds"),
    ("FF_37050--73", "37050 Diamonds", "Diamonds"),
    ("FF_73100--73", "73100 Diamonds", "Diamonds")
];

fn questionnaire(answer: &str) -> Value {
    json!([{
        "questionnaire": {
            "code": "userid",
            "inputType": "STRING",
            "regexValidation": {
                "regex": "^[0-9]{1,20}$",
                "errorMessages": [
                    { "language": "ID", "title": "Format ID Salah", "body": "ID hanya boleh mengandung angka. Silakan periksa kembali dan coba lagi 😊" },
                    { "language": "EN", "title": "Invalid ID Format", "body": "ID must contain numbers only. Please check and try again 😊" }
                ]
            },
            "translations": [ { "language": "ID", "question": "Masukkan User ID", "description": "User ID", "choices": [] } ]
        },
        "answer": answer
    }])
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(user_id) = str_param(&m, "user_id") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter \"user_id\" wajib diisi"}))).into_response();
    };
    let cleaned_id: String = user_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned_id.is_empty() || cleaned_id.len() > 20 {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "User ID tidak valid — maksimal 20 digit angka"}))).into_response();
    }
    let Some(paket) = str_param(&m, "paket").or_else(|| Some("20 Diamonds".to_string())) else { unreachable!() };
    let Some((pkg_code, pkg_label, pkg_group)) = PACKAGES.iter().find(|(_, l, _)| l.eq_ignore_ascii_case(&paket)) else {
        let opts = PACKAGES.iter().map(|(_, l, _)| *l).collect::<Vec<_>>().join(", ");
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": format!("Paket \"{}\" tidak tersedia. Pilihan: {}", paket, opts)}))).into_response();
    };
    let (status, data) = match tokogame::create_order(PRODUCT_ID, pkg_code, questionnaire(&cleaned_id)).await {
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
    let harga = d.get("totalPriceInCents").and_then(|v| v.as_f64()).map(|c| c / 100.0).unwrap_or(0.0);
    let checkout = d.get("checkoutUrl").cloned().unwrap_or(json!({}));
    let qris_content = checkout.get("qr").and_then(|v| v.as_str()).map(|s| s.to_string());
    let qris_image_url = checkout.get("qrUrl").and_then(|v| v.as_str()).map(|s| s.to_string());
    Json(json!({
        "status": true,
        "result": {
            "orderId": d.get("id"),
            "orderCode": d.get("code"),
            "user_id": cleaned_id,
            "paket": pkg_label,
            "label": pkg_label,
            "group": pkg_group,
            "harga": harga,
            "qr_url": qris_image_url,
            "qris_content": qris_content
        },
        "timestamp": chrono::Utc::now().timestamp_millis()
    })).into_response()
}

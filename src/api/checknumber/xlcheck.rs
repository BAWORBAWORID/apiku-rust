// XL Check — native conversion of api/checknumber/xlcheck.js
// The Node version fetched https://xl-ku.my.id/xlkujs/check-package and eval'd
// the obfuscated script to build the API-key header. Deobfuscation shows the
// generator is fully STATIC (no time/session input): the header name/value are
// built from constant chains —
//   name:  atob("0sY=")^170 | "1-" rev | "a" | atob("az4+")^15 | atob("ZZNl")-46 | "7" rev | atob("Nw==")
//        = "xl-1ad117e777"
//   value: concat of 6 decoded constants (base64/identity), 179 chars.
// Both were verified live against /check/all-info (success:true). The JS bundle
// is byte-identical across fetches (same md5), so the decoded pair is pinned
// here natively; if upstream ever rotates the bundle the constants below must
// be re-derived from /xlkujs/check-package.
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

const XL_JS_URL: &str = "https://xl-ku.my.id/xlkujs/check-package";
const XL_HEADER_NAME: &str = "xl-1ad117e777";
const XL_HEADER_VALUE: &str = "tKxHR0e9pjmAJxQRgo-dl0KL4UixiwXYtXFoIN57FKm_COGD9Iou-XOr0uG-gWsKFn1pUaZvadnqtUNkJPnGeJUXgb9PitoDvj9nPVhh4QtU8xE3R8CxSW7E3Q1WSxfCg1Up4tYzLOqwgivoH-JcdLPRgcxm-ruKn-5BlH55INgps6eiWHWg";

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(number) = str_param(&m, "number") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'number' wajib diisi"}))).into_response();
    };
    let clean: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    let formatted = if clean.starts_with("628") { format!("0{}", &clean[2..]) } else { clean };

    let res = client().get(format!("https://xl-ku.my.id/check/all-info/{}", formatted))
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    .header("Accept", "application/json")
                    .header("Referer", "https://xl-ku.my.id/")
        .header(XL_HEADER_NAME, XL_HEADER_VALUE)
        .send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": e.to_string()}))).into_response(),
    };
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if data.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = data.get("message").and_then(|v| v.as_str()).unwrap_or("Gagal cek paket XL").to_string();
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": msg}))).into_response();
    }
    let info = data.pointer("/data/subs_info").cloned().unwrap_or(json!({}));
    let packages = data.pointer("/data/package_info/packages").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let g = |k: &str| info.get(k).cloned().unwrap_or(Value::Null);
    let paket: Vec<Value> = packages.iter().map(|pkg| {
        let quotas = pkg.get("quotas").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let kept: Vec<Value> = quotas.iter().filter(|q| {
            let rem = q.get("remaining").and_then(|v| v.as_str()).unwrap_or("");
            rem.parse::<f64>().map(|f| f > 0.0).unwrap_or(false) || rem.contains("Menit")
        }).map(|q| json!({
            "nama": q.get("name"),
            "total": q.get("total"),
            "sisa": q.get("remaining"),
            "persen": format!("{}%", q.get("percent").map(|p| p.to_string()).unwrap_or_default())
        })).collect();
        json!({ "nama": pkg.get("name"), "berakhir": pkg.get("expiry"), "kuota": kept })
    }).collect();
    Json(json!({
        "status": true,
        "result": {
            "nomor": g("msisdn"),
            "operator": g("operator"),
            "jaringan": g("net_type"),
            "verif_id": g("id_verified"),
            "masa_aktif": g("tenure"),
            "masa_berakhir": g("exp_date"),
            "tenggang_hingga": g("grace_until"),
            "volte": g("volte"),
            "paket": paket
        }
    })).into_response()
}

// Keep the JS URL referenced so the derivation source is discoverable.
#[allow(dead_code)]
fn _source() -> &'static str { XL_JS_URL }

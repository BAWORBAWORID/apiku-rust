// Check Ban WhatsApp — native conversion of api/checknumber/checkban.js
// 3 provider upstreams queried in parallel (tokio::join).
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

const UPSTREAM_1: &str = "https://kyuux-r.indevs.in/api/check-whatsapp";
const UPSTREAM_2: &str = "https://api.neosoft.best/api/tools/checker-ban-wa";
const UPSTREAM_3: &str = "https://xzc-corporation.biz.id/lrp";

fn normalize(input: &str) -> String {
    let mut s: String = input.trim().chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
    if s.starts_with('+') { s = s[1..].to_string(); }
    if !s.starts_with('+') && !s.starts_with("62") && !s.starts_with("0") && s.len() >= 8 {
        // keep as-is — Node does no further transform
    }
    s
}

async fn provider_kyuux(nomor: &str) -> Value {
    let res = client().get(format!("{}?phone={}", UPSTREAM_1, nomor)).send().await;
    let Ok(res) = res else { return json!({ "success": false, "message": "Upstream kyuux tidak merespon" }); };
    let j: Value = res.json().await.unwrap_or(Value::Null);
    if j.get("success").and_then(|v| v.as_bool()) != Some(true) || j.get("data").map(|d| d.is_null()).unwrap_or(true) {
        return json!({ "success": false, "message": j.get("message").and_then(|v| v.as_str()).unwrap_or("Upstream kyuux mengembalikan status false") });
    }
    let d = j.get("data").cloned().unwrap_or(json!({}));
    json!({
        "success": true,
        "provider": {
            "name": "kyuux-r.indevs.in",
            "number": d.get("number").cloned().unwrap_or(Value::Null),
            "status": d.get("status").and_then(|v| v.as_str()).unwrap_or("Unknown"),
            "banned": d.get("banned").and_then(|v| v.as_bool()).unwrap_or(false),
            "info": {
                "device": d.pointer("/info/device").and_then(|v| v.as_str()).unwrap_or("Unknown"),
                "email": d.pointer("/info/email").and_then(|v| v.as_str()).unwrap_or("Unknown")
            }
        }
    })
}

async fn provider_neosoft(nomor: &str) -> Value {
    let res = client().get(format!("{}?number={}", UPSTREAM_2, nomor)).send().await;
    let Ok(res) = res else { return json!({ "success": false, "message": "Upstream neosoft tidak merespon" }); };
    let j: Value = res.json().await.unwrap_or(Value::Null);
    if j.get("status").and_then(|v| v.as_bool()) != Some(true) {
        return json!({ "success": false, "message": j.get("message").and_then(|v| v.as_str()).unwrap_or("Upstream neosoft mengembalikan status false") });
    }
    let r = j.get("result").cloned().unwrap_or(json!({}));
    json!({
        "success": true,
        "provider": {
            "name": "api.neosoft.best",
            "phone": r.get("phone").cloned().unwrap_or(Value::Null),
            "masked": r.get("masked").cloned().unwrap_or(Value::Null),
            "status": r.get("status").and_then(|v| v.as_str()).unwrap_or("Unknown"),
            "banned": r.get("banned").and_then(|v| v.as_bool()).unwrap_or(false),
            "exists": r.get("exists").and_then(|v| v.as_bool()).unwrap_or(false),
            "detail": r.get("detail").cloned().unwrap_or(Value::Null)
        }
    })
}

async fn provider_xzc(nomor: &str) -> Value {
    let res = client().get(format!("{}?number={}", UPSTREAM_3, nomor))
                    .header("neckhurt", "hate4jew")
        .send().await;
    let Ok(res) = res else { return json!({ "success": false, "message": "Upstream xzc-corporation tidak merespon" }); };
    let j: Value = res.json().await.unwrap_or(Value::Null);
    if j.is_null() || j.get("error").and_then(|v| v.as_str()) == Some("invalid_phone") {
        return json!({ "success": false, "message": j.get("error").and_then(|v| v.as_str()).unwrap_or("Nomor tidak valid pada upstream xzc-corporation") });
    }
    json!({
        "success": true,
        "provider": {
            "name": "xzc-corporation.biz.id",
            "number": j.get("number").cloned().unwrap_or(Value::Null),
            "banned": j.get("banned").and_then(|v| v.as_bool()).unwrap_or(false),
            "otp_ready": j.get("otp_ready").and_then(|v| v.as_bool()).unwrap_or(false),
            "wa_clone": j.get("wa_clone").and_then(|v| v.as_bool()).unwrap_or(false),
            "cooldowns": j.get("cooldowns").cloned().unwrap_or(json!({})),
            "status": if j.get("banned").and_then(|v| v.as_bool()).unwrap_or(false) { "Banned" } else { "Safe" }
        }
    })
}

fn is_banned(r: &Value) -> bool {
    r.get("banned").and_then(|v| v.as_bool()).unwrap_or(false)
        || r.get("status").and_then(|v| v.as_str()).unwrap_or("").to_lowercase().contains("ban")
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let Some(nomor) = str_param(&m, "nomor") else {
        return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'nomor' wajib diisi"}))).into_response();
    };
    let normalized = normalize(&nomor);
    let (p1, p2, p3) = tokio::join!(provider_kyuux(&normalized), provider_neosoft(&normalized), provider_xzc(&normalized));
    let providers = vec![p1, p2, p3];
    if providers.iter().all(|p| p.is_null()) {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Semua provider gagal", "result": null}))).into_response();
    }
    let ok: Vec<&Value> = providers.iter().filter(|p| p.get("success").and_then(|v| v.as_bool()) == Some(true)).collect();
    if ok.is_empty() {
        return (StatusCode::BAD_GATEWAY, Json(json!({"status": false, "message": "Semua provider gagal", "result": null}))).into_response();
    }
    let get_p = |name: &str| ok.iter().find(|p| p.pointer("/provider/name").and_then(|v| v.as_str()) == Some(name)).map(|p| p["provider"].clone()).unwrap_or(json!({}));
    let p1 = get_p("kyuux-r.indevs.in");
    let p2 = get_p("api.neosoft.best");
    let p3 = get_p("xzc-corporation.biz.id");
    let banned = ok.iter().any(|p| is_banned(&p["provider"]));
    let last_status = ok.last().and_then(|p| p.pointer("/provider/status")).cloned().unwrap_or(json!("Safe"));
    let num = |v: &Value, def: i64| v.as_i64().unwrap_or(def);
    let cd = p3.get("cooldowns").cloned().unwrap_or(json!({}));
    let detail = p2.get("detail").cloned().unwrap_or(json!({}));
    let masked = p2.get("masked").cloned().unwrap_or(Value::Null)
        .as_str().map(|s| json!(s)).unwrap_or_else(|| p3.get("number").cloned().unwrap_or(Value::Null).as_str().map(|s| json!(s)).unwrap_or_else(|| p1.get("number").cloned().unwrap_or(Value::Null).as_str().map(|s| json!(s)).unwrap_or(Value::Null)));
    Json(json!({
        "status": true,
        "message": "Berhasil mengecek status WhatsApp",
        "result": {
            "phone": normalized,
            "phone_masked": masked,
            "status": if banned { "Banned" } else { last_status.as_str().unwrap_or("Safe") },
            "is_banned": banned,
            "is_registered": p2.get("exists").and_then(|v| v.as_bool()).unwrap_or(true),
            "otp_ready": p3.get("otp_ready").and_then(|v| v.as_bool()).unwrap_or(!banned),
            "wa_clone": p3.get("wa_clone").and_then(|v| v.as_bool()).unwrap_or(false),
            "device": p1.pointer("/info/device").and_then(|v| v.as_str()).filter(|s| *s != "Unknown"),
            "email": p1.pointer("/info/email").and_then(|v| v.as_str()).filter(|s| *s != "Unknown"),
            "otp": {
                "ready": p3.get("otp_ready").and_then(|v| v.as_bool()).unwrap_or(true),
                "methods": detail.get("fallback_methods").cloned().unwrap_or(json!([])),
                "wait_times_seconds": {
                    "sms": cd.get("sms").map(|v| num(v, num(detail.get("sms_wait").unwrap_or(&json!(0)), 0))).unwrap_or(num(detail.get("sms_wait").unwrap_or(&json!(0)), 0)),
                    "voice": cd.get("voice").map(|v| num(v, num(detail.get("voice_wait").unwrap_or(&json!(0)), 0))).unwrap_or(num(detail.get("voice_wait").unwrap_or(&json!(0)), 0)),
                    "flash": cd.get("flash").map(|v| num(v, num(detail.get("flash_wait").unwrap_or(&json!(0)), 0))).unwrap_or(num(detail.get("flash_wait").unwrap_or(&json!(0)), 0)),
                    "email": cd.get("email").map(|v| num(v, num(detail.get("email_otp_wait").unwrap_or(&json!(0)), 0))).unwrap_or(num(detail.get("email_otp_wait").unwrap_or(&json!(0)), 0)),
                    "wa_message": cd.get("wa_message").and_then(|v| v.as_i64()).unwrap_or(0),
                    "account_transfer": cd.get("account_transfer").and_then(|v| v.as_i64()).unwrap_or(0),
                    "silent_auth": cd.get("silent_auth").and_then(|v| v.as_i64()).unwrap_or(0)
                }
            }
        },
        "_providers": {
            "total_success": ok.len(),
            "errors": providers.iter().filter(|p| p.get("success").and_then(|v| v.as_bool()) != Some(true)).map(|p| p.get("message").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>()
        }
    })).into_response()
}

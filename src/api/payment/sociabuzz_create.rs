// Sociabuzz Create Payment — native conversion of api/payment/sociabuzz-create.js
// Full donation flow natively: cookie jar, CSRF extraction, queue form, payment page,
// pay/setting, send/create. JSON DB di data/sociabuzz.json sama seperti Node.
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

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

const BASE_URL: &str = "https://sociabuzz.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36";

struct Method { key: &'static str, type_payment: &'static str, source_payment: &'static str, min: i64 }
const METHODS: &[Method] = &[
    Method { key: "qris", type_payment: "qris", source_payment: "xendit", min: 1000 },
    Method { key: "gopay", type_payment: "ewallet_id", source_payment: "midtrans", min: 1000 },
    Method { key: "ovo", type_payment: "ewallet_id", source_payment: "xendit", min: 1000 },
    Method { key: "dana", type_payment: "ewallet_id", source_payment: "xendit", min: 1000 },
    Method { key: "linkaja", type_payment: "ewallet_id", source_payment: "xendit", min: 1000 },
    Method { key: "shopeepay_idr", type_payment: "ewallet_id", source_payment: "2c2p", min: 1000 },
    Method { key: "bca", type_payment: "bank_transfer", source_payment: "midtrans", min: 10000 },
    Method { key: "mandiri", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "bri", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "bni", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "bsi", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "cimb", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "permata", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "bjb", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "bnc", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "sahabat_sampoerna", type_payment: "bank_transfer", source_payment: "xendit", min: 10000 },
    Method { key: "indomaret", type_payment: "retail_outlet", source_payment: "xendit", min: 10000 },
    Method { key: "alfamart", type_payment: "retail_outlet", source_payment: "xendit", min: 10000 },
    Method { key: "alfamidi", type_payment: "retail_outlet", source_payment: "xendit", min: 10000 },
    Method { key: "alfaexpress", type_payment: "retail_outlet", source_payment: "xendit", min: 10000 },
    Method { key: "lawson", type_payment: "retail_outlet", source_payment: "xendit", min: 10000 },
    Method { key: "dandan", type_payment: "retail_outlet", source_payment: "xendit", min: 10000 },
];

fn db_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/sociabuzz.json")
}

fn load_db() -> Vec<Value> {
    std::fs::read_to_string(db_path()).ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_db(db: &[Value]) {
    if let Some(dir) = db_path().parent() { let _ = std::fs::create_dir_all(dir); }
    let _ = std::fs::write(db_path(), serde_json::to_string_pretty(db).unwrap_or_default());
}

/// Simple string cookie jar (ordered name→value).
struct Jar(Vec<(String, String)>);

impl Jar {
    fn get(&self, name: &str) -> Option<&str> { self.0.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str()) }
    fn set(&mut self, name: &str, value: &str) {
        match self.0.iter_mut().find(|(k, _)| k == name) { Some(e) => e.1 = value.to_string(), None => self.0.push((name.to_string(), value.to_string())) }
    }
    fn header(&self) -> String { self.0.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("; ") }
    fn absorb(&mut self, resp: &reqwest::Response) {
        for c in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = c.to_str() {
                let kv = s.split(';').next().unwrap_or("");
                if let Some((k, v)) = kv.split_once('=') { self.set(k.trim(), v.trim()); }
            }
        }
    }
}

fn extract_one<'a>(html: &'a str, pattern: &regex::Regex) -> Option<String> {
    pattern.captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

/// Multipart-less JSON POST helper for /payment/send/create.
async fn post_json(client: &reqwest::Client, url: &str, jar: &Jar, body: Value, referer: &str) -> Result<Value, String> {
    let res = client.post(url)
        .header("Cookie", jar.header())
        .header("Origin", BASE_URL)
        .header("Referer", referer)
                    .header("X-Requested-With", "XMLHttpRequest")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;
    res.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let (Some(username), Some(amount_raw), Some(method)) = (str_param(&m, "username"), str_param(&m, "amount"), str_param(&m, "method")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "Parameter 'username', 'amount', dan 'method' wajib diisi"}))).into_response();
    };
    let method_lc = method.to_lowercase();
    let Some(pm) = METHODS.iter().find(|x| x.key == method_lc) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": format!("Method {} not available", method)}))).into_response();
    };
    let digits: String = amount_raw.chars().filter(|c| c.is_ascii_digit()).collect();
    let amount: i64 = digits.parse().unwrap_or(0);
    if amount < pm.min {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": format!("Minimum Rp {} for {}", pm.min, method_lc)}))).into_response();
    }

    let client = client();
    let mut jar = Jar(Vec::new());
    let donate_url = format!("{}/{}/donate", BASE_URL, username);

    // 1. Halaman donate → CSRF
    let home = match client.get(&donate_url)            .header("Accept", "text/html").header("User-Agent", UA).send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e.to_string()}))).into_response(),
    };
    jar.absorb(&home);
    if home.status() == reqwest::StatusCode::NOT_FOUND {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": "Username Sociabuzz tidak ditemukan"}))).into_response();
    }
    let home_html = home.text().await.unwrap_or_default();
    let csrf_re = regex::Regex::new(r#"input[^>]*name="sb_token_csrf"[^>]*value="([^"]+)""#).unwrap();
    let csrf_re2 = regex::Regex::new(r#"input[^>]*value="([^"]+)"[^>]*name="sb_token_csrf""#).unwrap();
    let csrf = extract_one(&home_html, &csrf_re).or_else(|| extract_one(&home_html, &csrf_re2));
    let Some(csrf) = csrf else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": "Failed to load donation page (CSRF not found)"}))).into_response();
    };

    // 2. get-form-queue
    let email = str_param(&m, "email").unwrap_or_else(|| format!("donatur{}@gmail.com", chrono::Utc::now().timestamp_millis()));
    let note_owned = str_param(&m, "message").unwrap_or_default();
    let fullname_owned = str_param(&m, "name").unwrap_or_else(|| "Donatur".to_string());
    let form = [
        ("sb_token_csrf", csrf.as_str()), ("currency", "IDR"), ("amount", &amount_raw), ("qty", "1"),
        ("support_duration", "30"), ("note", note_owned.as_str()),
        ("fullname", fullname_owned.as_str()),
        ("email", email.as_str()), ("is_agree", "1"), ("years18", "1"), ("is_vote", "0"), ("is_voice", "0"),
        ("is_mediashare", "0"), ("is_gif", "0"), ("is_sound", "0"), ("is_voicy", "0"), ("vote_id", ""),
        ("ms_maxtime", ""), ("start_from", "0"), ("ms_starthour", "0"), ("ms_startminute", "0"),
        ("ms_startsecond", "0"), ("spin_check", "0"), ("prev_url", donate_url.as_str()), ("hide_email", "0"),
        ("is_tiktok", "0"), ("tiktok_duration", "0"), ("is_instagram", "0"), ("instagram_duration", "0"),
        ("wishlist_id", ""), ("quickpay", "0"),
    ];
    let sub = match client.post(format!("{}/get-form-queue", donate_url))
        .header("Cookie", jar.header())
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Origin", BASE_URL)
        .header("Referer", &donate_url)
                    .header("X-Requested-With", "XMLHttpRequest")
        .header("User-Agent", UA)
        .form(&form)
        .send().await
    {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e.to_string()}))).into_response(),
    };
    jar.absorb(&sub);
    let sub_json: Value = sub.json().await.unwrap_or(json!({}));
    if sub_json.get("success").and_then(|v| v.as_str()) != Some("true") {
        let alert = sub_json.pointer("/content/form_alert").and_then(|v| v.as_str()).unwrap_or("Donation failed");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": alert}))).into_response();
    }
    let payment_url = sub_json.pointer("/content/redirect").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if payment_url.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": "Donation failed"}))).into_response();
    }
    let token = payment_url.split("/payment/x/").nth(1)
        .map(|s| s.split(|c| c == '?' || c == '#').next().unwrap_or("").to_string())
        .unwrap_or_default();

    // 3. Halaman payment → csrf2
    let pay = match client.get(&payment_url)            .header("Accept", "text/html").header("User-Agent", UA).send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e.to_string()}))).into_response(),
    };
    jar.absorb(&pay);
    let pay_html = pay.text().await.unwrap_or_default();
    let mut csrf2 = extract_one(&pay_html, &csrf_re).or_else(|| extract_one(&pay_html, &csrf_re2)).unwrap_or_default();
    jar.set("sociabuzz_sb_cookie_csrf", &csrf2);

    // 4. pay/setting
    let _ = client.get(format!("{}/payment/pay/setting", BASE_URL))
        .header("Cookie", jar.header())
        .header("User-Agent", UA)
        .query(&[
            ("amount", amount_raw.as_str()), ("currency", "IDR"), ("base_amount", amount_raw.as_str()),
            ("base_currency", "IDR"), ("currency_def", "IDR"), ("convertion", "IDR"),
            ("country", "Indonesia"), ("feature", "TRIBE"), ("is_borne_fee", "1"), ("risk", ""),
            ("message", ""), ("direct", ""), ("service_fee", "1"), ("token", token.as_str()), ("country_account", ""),
        ])
        .send().await;
    if let Some(c) = jar.get("csrf_cookie_name") {
        let c = c.to_string();
        jar.set("sociabuzz_sb_cookie_csrf", &c);
        csrf2 = c;
    }

    // 5. send/create
    let mut send_body = json!({
        "sb_token_csrf": csrf2,
        "order_id": token,
        "final_currency": "IDR",
        "currency_def": "IDR",
        "payment_method": method_lc,
        "type_payment": pm.type_payment,
        "source_payment": pm.source_payment,
        "country": "ID",
        "country_pay": "Indonesia"
    });
    if let Some(phone) = str_param(&m, "phone") { send_body["phone_number"] = json!(phone); }
    let rd = match post_json(&client, &format!("{}/payment/send/create", BASE_URL), &jar, send_body, &payment_url).await {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    };
    if rd.get("status").and_then(|v| v.as_bool()) != Some(true) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": rd.to_string()}))).into_response();
    }

    let clean = |s: &str| -> i64 { s.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0) };
    let total = rd.pointer("/data/amount").and_then(|v| v.as_str().map(clean)).or_else(|| rd.pointer("/data/total").and_then(|v| v.as_str().map(clean))).unwrap_or(amount);
    let fee = total - amount;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let id = format!("TRX-{}{:04}", now_ms, rand::Rng::gen_range(&mut rand::thread_rng(), 0..10000));
    let created = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let expired = rd.pointer("/data/countdown").and_then(|v| v.as_str())
        .and_then(|c| chrono::DateTime::parse_from_rfc2822(c).ok().map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)))
        .unwrap_or_else(|| (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true));

    let mut payment_info = json!({
        "method": method_lc,
        "payment_method": rd.get("payment_method"),
        "type_payment": rd.get("type_payment"),
        "source_payment": rd.get("source_payment")
    });
    for (src_key, out_key) in [("qr_string", "qr_string"), ("account_number", "account_number"), ("name", "bank_name"), ("bank", "bank"), ("redirect_url", "redirect_url"), ("payment_link", "payment_link")] {
        if let Some(v) = rd.pointer(&format!("/data/{}", src_key)) {
            if !v.is_null() { payment_info[out_key] = v.clone(); }
        }
    }
    if let Some(inv) = rd.get("inv_id") {
        payment_info["inv_id"] = inv.clone();
        payment_info["pending_url"] = json!(format!("{}/payment/pending?type={}&inv_id={}", BASE_URL, rd.get("payment_method").and_then(|v| v.as_str()).unwrap_or(""), inv));
    }
    if let Some(tid) = rd.pointer("/data/id") { payment_info["transaction_id"] = tid.clone(); }

    let trx = json!({
        "id": id, "order_id": token, "payment_url": payment_url,
        "payment_info": payment_info, "amount": amount, "total_amount": total,
        "fee": fee, "status": "pending", "created_at": created, "expired_at": expired,
        "paid_at": Value::Null, "supporter": str_param(&m, "name"), "message": str_param(&m, "message"),
        "username": username
    });
    let mut db = load_db();
    db.push(trx.clone());
    save_db(&db);
    Json(json!({"success": true, "result": trx})).into_response()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36")
        .build()
        .unwrap_or_default()
}

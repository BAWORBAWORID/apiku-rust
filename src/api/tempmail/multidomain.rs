// multidomain — native conversion of api/tempmail/multidomain.js
// Generator.email backend (17+ domains). create & inbox via HTML scraping.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://generator.email/";
const VALIDATE_PATH: &str = "check_adres_validation3.php";

const DOMAINS: [&str; 17] = [
    "pdood.com",
    "agallagher.id",
    "emailmultimedia.com",
    "giangholang.xyz",
    "24hhost.cc",
    "ghk55.us",
    "moreglass.vn",
    "himkinet.ru",
    "wwefd.top",
    "yang-gtens.pro",
    "appcloudmurah.email",
    "j3r8qd.site",
    "biosu.dev",
    "raveqxon.space",
    "rayrayactive.com",
    "thxm3.pro",
    "czub.xyz",
];

struct State {
    cookie: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())
}

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            .parse()
            .unwrap(),
    );
    h.insert(
        "Accept-Language",
        "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap(),
    );
    h.insert("Upgrade-Insecure-Requests", "1".parse().unwrap());
    h
}

async fn request(
    state: &mut State,
    path: &str,
    extra_cookie: Option<&str>,
    form: Option<&str>,
) -> Result<String, String> {
    let c = client()?;
    let mut url = path.to_string();
    // manual redirect-following (max 5), preserving the surl cookie like Node
    for _ in 0..5 {
        let mut req = c.get(&url).headers(base_headers());
        let cookie_val = extra_cookie.unwrap_or(&state.cookie);
        if !cookie_val.is_empty() {
            req = req.header("Cookie", cookie_val);
        }
        if let Some(f) = form {
            req = req
                            .header("Content-Type", "application/x-www-form-urlencoded")
                .body(f.to_string());
            let method_req = c
                .post(&url)
                .headers(base_headers())
                            .header("Content-Type", "application/x-www-form-urlencoded")
                .body(f.to_string());
            let mut method_req = method_req;
            if !cookie_val.is_empty() {
                method_req = method_req.header("Cookie", cookie_val);
            }
            let res = method_req.send().await.map_err(|e| e.to_string())?;
            if let Some(ck) = res.headers().get_all("set-cookie").iter().next() {
                if let Ok(s) = ck.to_str() {
                    if let Some(eq) = s.find("surl=") {
                        let rest = &s[eq..];
                        let end = rest.find(';').unwrap_or(rest.len());
                        state.cookie = rest[..end].to_string();
                    }
                }
            }
            let status = res.status().as_u16();
            if (301..=302).contains(&status) {
                if let Some(loc) = res.headers().get("location").and_then(|l| l.to_str().ok()) {
                    url = if loc.starts_with("http") {
                        loc.to_string()
                    } else {
                        format!("{BASE_URL}{}", loc.trim_start_matches('/'))
                    };
                    continue;
                }
            }
            return res.text().await.map_err(|e| e.to_string());
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        // track surl cookie
        for ck in res.headers().get_all("set-cookie") {
            if let Ok(s) = ck.to_str() {
                if let Some(eq) = s.find("surl=") {
                    let rest = &s[eq..];
                    let end = rest.find(';').unwrap_or(rest.len());
                    state.cookie = rest[..end].to_string();
                }
            }
        }
        let status = res.status().as_u16();
        if (301..=302).contains(&status) {
            if let Some(loc) = res.headers().get("location").and_then(|l| l.to_str().ok()) {
                url = if loc.starts_with("http") {
                    loc.to_string()
                } else {
                    format!("{BASE_URL}{}", loc.trim_start_matches('/'))
                };
                continue;
            }
        }
        return res.text().await.map_err(|e| e.to_string());
    }
    Err("Redirect terlalu banyak".to_string())
}

fn split_email(email: &str) -> Option<(String, String)> {
    let value = email.trim();
    let (u, d) = value.split_once('@')?;
    if u.is_empty() || d.is_empty() {
        return None;
    }
    Some((u.to_string(), d.to_string()))
}

fn normalize_link(href: &str) -> Option<String> {
    if href.is_empty() {
        return None;
    }
    if href.starts_with("http") {
        Some(href.to_string())
    } else {
        Some(format!("{BASE_URL}{}", href.trim_start_matches('/')))
    }
}

fn text_between(html: &str, open: &str) -> Option<String> {
    html.find(open).and_then(|i| {
        let start = i + open.len();
        html[start..]
            .find('<')
            .map(|e| html[start..start + e].trim().to_string())
    })
}

fn extract_message(html: &str) -> Value {
    // .e7m.col-md-9 span occurrences
    let mut spans: Vec<String> = Vec::new();
    let marker = "<span";
    let mut idx = 0;
    while let Some(p) = html[idx..].find(marker) {
        let abs = idx + p;
        let end = html[abs..]
            .find("</span>")
            .map(|e| abs + e)
            .unwrap_or(html.len());
        let seg = &html[abs..end];
        let inner_start = seg.find('>').map(|g| g + 1).unwrap_or(0);
        let text = seg[inner_start..].trim().to_string();
        spans.push(text);
        idx = end;
    }
    let span_at = |i: usize| spans.get(i).cloned().unwrap_or_default();
    let from_raw = span_at(3);
    let from = {
        // strip (.*?)
        let mut out = String::new();
        let mut depth = 0;
        for c in from_raw.chars() {
            match c {
                '(' => depth += 1,
                ')' => {
                    if depth > 0 {
                        depth -= 1;
                    }
                }
                c if depth == 0 => out.push(c),
                _ => {}
            }
        }
        out.trim().to_string()
    };

    let body_marker = "mess_bodiyy";
    let (body_text, links) = match html.find(body_marker) {
        Some(b) => {
            let seg = &html[b..];
            let seg_end = seg.find("</div>").map(|e| e).unwrap_or(seg.len());
            let seg = &seg[..seg_end];
            let text = {
                let mut out = String::new();
                let mut in_tag = false;
                for c in seg.chars() {
                    match c {
                        '<' => in_tag = true,
                        '>' => in_tag = false,
                        c if !in_tag => out.push(c),
                        _ => {}
                    }
                }
                out.trim().to_string()
            };
            let mut links = Vec::new();
            let mut li = 0;
            while let Some(h) = seg[li..].find("href=\"") {
                let start = li + h + 6;
                let end = seg[start..]
                    .find('"')
                    .map(|e| start + e)
                    .unwrap_or(seg.len());
                if let Some(n) = normalize_link(&seg[start..end]) {
                    if !links.contains(&n) {
                        links.push(n);
                    }
                }
                li = end;
            }
            (text, links)
        }
        None => (String::new(), Vec::new()),
    };

    let created = html
        .find("e7m tooltip")
        .and_then(|t| {
            let seg = &html[t..];
            let start = seg.find('>')? + 1;
            let end = seg[start..].find('<')?;
            Some(
                seg[start..start + end]
                    .trim()
                    .trim_start_matches("Created:")
                    .trim()
                    .to_string(),
            )
        })
        .unwrap_or_default();
    let subject = text_between(html, "<h1").unwrap_or_default();

    json!({
        "from": from,
        "to": span_at(1),
        "created": created,
        "subject": subject,
        "message": body_text,
        "links": links,
    })
}

async fn validate(state: &mut State, email: &str) -> (Value, Value) {
    let parsed = match split_email(email) {
        Some(p) => p,
        None => return (Value::Null, Value::Null),
    };
    let form = format!(
        "usr={}&dmn={}",
        urlencoding::encode(&parsed.0),
        urlencoding::encode(&parsed.1)
    );
    match request(state, VALIDATE_PATH, None, Some(&form)).await {
        Ok(body) => {
            let j: Value = serde_json::from_str(&body).unwrap_or(json!({}));
            (
                j.get("status").cloned().unwrap_or(Value::Null),
                j.get("uptime").cloned().unwrap_or(Value::Null),
            )
        }
        Err(_) => (Value::Null, Value::Null),
    }
}

async fn generate(domain: &str) -> Result<Value, String> {
    let mut state = State {
        cookie: String::new(),
    };
    let _ = request(&mut state, domain, None, None).await;
    let html = request(&mut state, "", None, None).await?;
    let email = html
        .find("id=\"email_ch_text\"")
        .and_then(|i| {
            let seg = &html[i..];
            let gt = seg.find('>')? + 1;
            let end = seg[gt..].find('<')?;
            Some(seg[gt..gt + end].trim().to_string())
        })
        .unwrap_or_default();
    if email.is_empty() {
        return Err("Gagal generate email".to_string());
    }
    let (status, uptime) = validate(&mut state, &email).await;
    Ok(json!({ "email": email, "emailStatus": status, "uptime": uptime }))
}

async fn inbox(email: &str) -> Result<Value, String> {
    let parsed = split_email(email).ok_or("Email tidak valid")?;
    let mut state = State {
        cookie: String::new(),
    };
    let (status, uptime) = validate(&mut state, email).await;
    let mailbox_cookie = format!("surl={}/{}", parsed.1, parsed.0);
    let html = request(&mut state, "", Some(&mailbox_cookie), None).await?;

    if html.contains("Email generator is ready") {
        return Ok(json!({ "email": email, "emailStatus": status, "uptime": uptime, "inbox": [] }));
    }
    let total = html
        .find("id=\"mess_number\"")
        .and_then(|i| {
            let seg = &html[i..];
            let gt = seg.find('>')? + 1;
            let end = seg[gt..].find('<')?;
            seg[gt..gt + end].trim().parse::<usize>().ok()
        })
        .unwrap_or(0);

    let mut messages = Vec::new();
    if total == 1 {
        messages.push(extract_message(&html));
    } else if total > 1 {
        // #email-table a hrefs
        let table = match html.find("email-table") {
            Some(t) => &html[t..],
            None => "",
        };
        let mut paths: Vec<String> = Vec::new();
        let mut li = 0;
        while let Some(h) = table[li..].find("href=\"") {
            let start = li + h + 6;
            let end = table[start..]
                .find('"')
                .map(|e| start + e)
                .unwrap_or(table.len());
            let href = table[start..end].to_string();
            if !href.is_empty() && !paths.contains(&href) {
                paths.push(href);
            }
            li = end;
        }
        for path in paths {
            let pc = format!("surl={}", path.trim_start_matches('/'));
            let msg_html = request(&mut state, &path, Some(&pc), None)
                .await
                .unwrap_or_default();
            messages.push(extract_message(&msg_html));
        }
    }
    Ok(json!({ "email": email, "emailStatus": status, "uptime": uptime, "inbox": messages }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| -> Option<String> {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()))
        })
    };
    let action = get("action").unwrap_or_default();

    if action == "create" {
        let selected_domain = get("domain").unwrap_or_default();
        let selected_domain = if selected_domain.is_empty() {
            use std::time::{SystemTime, UNIX_EPOCH};
            let s = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos() as usize;
            DOMAINS[s % DOMAINS.len()].to_string()
        } else {
            selected_domain
        };
        return match generate(&selected_domain).await {
            Ok(result) => Json(json!({ "status": true, "action": "create", "result": result }))
                .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": e })),
            )
                .into_response(),
        };
    }

    if action == "inbox" {
        let email = match get("email").filter(|e| !e.trim().is_empty()) {
            Some(e) => e,
            None => return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "message": "Parameter 'email' wajib diisi untuk action=inbox" }))).into_response(),
        };
        let result = inbox(&email).await;
        let status = result.is_ok();
        return Json(json!({
            "status": status,
            "action": "inbox",
            "email": email,
            "result": result.unwrap_or(json!(null)),
        })).into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        Json(
            json!({ "status": false, "message": "Parameter 'action' harus 'create' atau 'inbox'" }),
        ),
    )
        .into_response()
}

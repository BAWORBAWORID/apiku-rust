// emailtick — native conversion of api/tempmail/emailtick.js
// emailtick.com scraper (create & inbox). Session (mailbox/salt/cookies) persisted
// to data/session/emailtick_session.json.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const BASE: &str = "https://www.emailtick.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
const MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;

fn session_file() -> PathBuf {
    let dir = PathBuf::from("data");
    let _ = fs::create_dir_all(&dir);
    dir.join("emailtick_session.json")
}

fn load_all_sessions() -> HashMap<String, Value> {
    let mut out = HashMap::new();
    if let Ok(raw) = fs::read_to_string(session_file()) {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) {
            let now = now_ms();
            for (sid, sess) in map {
                if now.saturating_sub(sess.get("createdAt").and_then(|c| c.as_u64()).unwrap_or(0))
                    < MAX_AGE_MS
                {
                    out.insert(sid, sess);
                }
            }
        }
    }
    out
}

fn save_all_sessions(map: &HashMap<String, Value>) {
    let obj: serde_json::Map<String, Value> =
        map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let _ = fs::write(session_file(), Value::Object(obj).to_string());
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn merge_cookies(old: &[(String, String)], new: &[(String, String)]) -> Vec<(String, String)> {
    let mut map: Vec<(String, String)> = old.to_vec();
    for (k, v) in new {
        if let Some(entry) = map.iter_mut().find(|(ek, _)| ek == k) {
            entry.1 = v.clone();
        } else {
            map.push((k.clone(), v.clone()));
        }
    }
    map
}

fn cookie_header(cookies: &[(String, String)]) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

struct Resp {
    status: u16,
    text: String,
    cookies: Vec<(String, String)>,
}

async fn request(
    method: reqwest::Method,
    url: &str,
    cookies: &[(String, String)],
    data: Option<&str>,
    referer: Option<&str>,
) -> Result<Resp, String> {
    let client = reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client
        .request(method, url)
        .header("User-Agent", UA)
                    .header("Accept", "*/*")
                    .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
        .header("Referer", referer.unwrap_or(&format!("{BASE}/")));
    if !cookies.is_empty() {
        req = req.header("Cookie", cookie_header(cookies));
    }
    if let Some(d) = data {
        req = req
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; charset=UTF-8",
            )
                        .header("X-Requested-With", "XMLHttpRequest")
            .header("Origin", BASE)
            .body(d.to_string());
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let mut new_cookies = Vec::new();
    for v in res.headers().get_all("set-cookie") {
        if let Ok(s) = v.to_str() {
            if let Some(first) = s.split(';').next() {
                if let Some(eq) = first.find('=') {
                    new_cookies.push((
                        first[..eq].trim().to_string(),
                        first[eq + 1..].trim().to_string(),
                    ));
                }
            }
        }
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok(Resp {
        status,
        text,
        cookies: new_cookies,
    })
}

fn parse_home(html: &str) -> (Option<String>, Option<String>) {
    let input_val = |id: &str| -> Option<String> {
        let marker = format!("id=\"{id}\"");
        let idx = html.find(&marker)?;
        let seg = &html[idx..];
        let vm = "value=\"";
        let vidx = seg.find(vm)?;
        let start = vidx + vm.len();
        let end = seg[start..].find('"')?;
        Some(seg[start..start + end].to_string())
    };
    (input_val("mailbox"), input_val("salt"))
}

fn parse_inbox(html: &str) -> Vec<Value> {
    // each <tr> containing >= 3 <td>; second td has link /mailbox/code/<code>
    let mut msgs = Vec::new();
    let mut idx = 0;
    while let Some(tr_pos) = html[idx..].find("<tr") {
        let tr_abs = idx + tr_pos;
        let tr_end = html[tr_abs..]
            .find("</tr>")
            .map(|e| tr_abs + e)
            .unwrap_or(html.len());
        let tr = &html[tr_abs..tr_end];
        idx = tr_end;

        let mut tds: Vec<String> = Vec::new();
        let mut ti = 0;
        while let Some(td_pos) = tr[ti..].find("<td") {
            let td_abs = ti + td_pos;
            let td_end = tr[td_abs..]
                .find("</td>")
                .map(|e| td_abs + e)
                .unwrap_or(tr.len());
            tds.push(tr[td_abs..td_end].to_string());
            ti = td_end;
        }
        if tds.len() < 3 {
            continue;
        }
        let strip = |s: &str| -> String {
            let mut out = String::new();
            let mut in_tag = false;
            for c in s.chars() {
                match c {
                    '<' => in_tag = true,
                    '>' => in_tag = false,
                    c if !in_tag => out.push(c),
                    _ => {}
                }
            }
            out.trim().to_string()
        };
        let sender = strip(&tds[0]);
        let subject_td = &tds[1];
        let subject = strip(subject_td);
        let time = strip(&tds[2]);

        let link = subject_td.find("href=\"").map(|h| {
            let start = h + 6;
            let end = subject_td[start..].find('"').unwrap_or(0);
            subject_td[start..start + end].to_string()
        });
        let code = link.as_deref().and_then(|l| {
            let marker = "/mailbox/code/";
            l.find(marker).map(|i| {
                let rest = &l[i + marker.len()..];
                rest.chars()
                    .take_while(|c| c.is_ascii_alphanumeric())
                    .collect::<String>()
            })
        });
        let code = match code {
            Some(c) if !c.is_empty() => c,
            _ => continue,
        };
        if format!("{sender} {subject}")
            .to_lowercase()
            .contains("inbox is empty")
        {
            continue;
        }
        msgs.push(json!({
            "sender": if sender.is_empty() { "Unknown Sender" } else { &sender },
            "subject": if subject.is_empty() { "(No Subject)" } else { &subject },
            "time": time,
            "link": link,
            "code": code,
        }));
    }
    msgs
}

fn html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn looks_like_html_page(s: &str) -> bool {
    let t = s.trim().to_lowercase();
    t.starts_with("<!doctype") || t.starts_with("<html") || t.contains("<head")
}

async fn activate_mailbox(
    cookies: &[(String, String)],
    mailbox: &str,
) -> Result<(bool, Vec<(String, String)>, String), String> {
    let r = request(
        reqwest::Method::POST,
        &format!("{BASE}/index/index/goactive.html"),
        cookies,
        Some(&format!("mailbox={}", urlencoding::encode(mailbox))),
        None,
    )
    .await?;
    let raw = r.text.trim().to_string();
    let ok = raw == "1" || raw.parse::<i64>().map(|n| n == 1).unwrap_or(false);
    Ok((ok, r.cookies, raw.chars().take(120).collect()))
}

async fn check_mail(
    cookies: &[(String, String)],
    mailbox: &str,
    salt: &str,
) -> Result<(String, Vec<(String, String)>), String> {
    let r = request(
        reqwest::Method::POST,
        &format!("{BASE}/index/index/checkmail.html"),
        cookies,
        Some(&format!(
            "box={}&salt={}",
            urlencoding::encode(mailbox),
            urlencoding::encode(salt)
        )),
        None,
    )
    .await?;
    Ok((r.text.trim().to_string(), r.cookies))
}

async fn warm_up_detail(
    cookies: &[(String, String)],
    detail_url: &str,
) -> Result<Vec<(String, String)>, String> {
    let r = request(
        reqwest::Method::GET,
        detail_url,
        cookies,
        None,
        Some(&format!("{BASE}/")),
    )
    .await?;
    Ok(r.cookies)
}

async fn fetch_mail_content(
    cookies: &[(String, String)],
    code: &str,
    detail_url: &str,
    retries: u32,
) -> Result<(String, String, Vec<Value>), String> {
    for attempt in 1..=retries {
        let r = request(
            reqwest::Method::POST,
            &format!("{BASE}/index/index/mailcontent.html"),
            cookies,
            Some(&format!("code={}", urlencoding::encode(code))),
            Some(detail_url),
        )
        .await?;
        let raw = r.text.trim().to_string();
        if looks_like_html_page(&raw) {
            if attempt < retries {
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                continue;
            }
            return Err("HTML error page returned".to_string());
        }
        let j: Value = match serde_json::from_str(&raw) {
            Ok(j) => j,
            Err(_) => {
                if attempt < retries {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    continue;
                }
                return Err("Invalid JSON".to_string());
            }
        };
        if j.get("status").and_then(|s| s.as_i64()) == Some(0) {
            return Err(j
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("status=0")
                .to_string());
        }
        let content_html = j
            .pointer("/msg/content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let attachments = j
            .pointer("/msg/attachments")
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default();
        let body_html = content_html.trim().to_string();
        let body_text = html_to_text(&body_html);
        return Ok((body_html, body_text, attachments));
    }
    Err("Unknown".to_string())
}

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": "error", "message": msg }))).into_response()
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
    let session_id = match get("sessionId").filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => {
            return err(
                StatusCode::BAD_REQUEST,
                "Parameter 'sessionId' wajib diisi (string).",
            )
        }
    };
    let action = match get("action") {
        Some(a) if ["create", "inbox"].contains(&a.as_str()) => a,
        _ => {
            return err(
                StatusCode::BAD_REQUEST,
                "Parameter 'action' harus berupa 'create' atau 'inbox'.",
            )
        }
    };

    let mut sessions = load_all_sessions();

    if action == "create" {
        if let Some(existing) = sessions.get(&session_id).cloned() {
            if now_ms().saturating_sub(
                existing
                    .get("createdAt")
                    .and_then(|c| c.as_u64())
                    .unwrap_or(0),
            ) < MAX_AGE_MS
            {
                let mailbox = existing
                    .get("mailbox")
                    .and_then(|m| m.as_str())
                    .unwrap_or("")
                    .to_string();
                return Json(json!({
                    "status": "success",
                    "sessionId": session_id,
                    "email": mailbox,
                    "action": "create",
                    "message": "Menggunakan sesi email yang sudah ada (aktif 24 jam).",
                }))
                .into_response();
            }
        }

        let home1 = match request(reqwest::Method::GET, BASE, &[], None, None).await {
            Ok(r) => r,
            Err(e) => {
                return err(
                    StatusCode::BAD_GATEWAY,
                    &format!("Gagal menghubungi emailtick.com: {e}"),
                )
            }
        };
        let mut cookies = home1.cookies;
        let (mailbox, salt) = parse_home(&home1.text);
        let (mailbox, salt) = match (mailbox, salt) {
            (Some(m), Some(s)) if !m.is_empty() && !s.is_empty() => (m, s),
            _ => return err(StatusCode::BAD_GATEWAY, "Gagal menemukan mailbox/salt dari emailtick.com (kemungkinan struktur HTML berubah / diblok)."),
        };

        let (ok, act_cookies, raw_preview) = match activate_mailbox(&cookies, &mailbox).await {
            Ok(v) => v,
            Err(e) => {
                return err(
                    StatusCode::BAD_GATEWAY,
                    &format!("Aktivasi mailbox emailtick gagal: {e}"),
                )
            }
        };
        cookies = merge_cookies(&cookies, &act_cookies);
        if !ok {
            return Json(json!({
                "status": "error",
                "message": "Aktivasi mailbox emailtick gagal.",
                "detail": raw_preview,
            }))
            .into_response();
        }

        sessions.insert(
            session_id.clone(),
            json!({ "mailbox": mailbox, "salt": salt, "cookies": cookies, "createdAt": now_ms() }),
        );
        save_all_sessions(&sessions);

        return Json(json!({
            "status": "success",
            "sessionId": session_id,
            "email": mailbox,
            "action": "create",
        }))
        .into_response();
    }

    // action == inbox
    let session = match sessions.get(&session_id).cloned() {
        Some(s) => s,
        None => {
            return err(
                StatusCode::NOT_FOUND,
                &format!("Sesi '{session_id}' tidak ditemukan atau telah kedaluwarsa. Harap panggil action=create terlebih dahulu."),
            )
        }
    };
    let mailbox = session
        .get("mailbox")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let salt = session
        .get("salt")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let mut cookies: Vec<(String, String)> = session
        .get("cookies")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    let a = p.as_array()?;
                    Some((
                        a.first()?.as_str()?.to_string(),
                        a.get(1)?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    // checkmail trigger
    if let Ok((_, new_ck)) = check_mail(&cookies, &mailbox, &salt).await {
        cookies = merge_cookies(&cookies, &new_ck);
    }
    // inbox page
    let home2 = match request(reqwest::Method::GET, BASE, &cookies, None, None).await {
        Ok(r) => r,
        Err(e) => return err(StatusCode::BAD_GATEWAY, &format!("Gagal memuat inbox: {e}")),
    };
    cookies = merge_cookies(&cookies, &home2.cookies);

    let inbox = parse_inbox(&home2.text);
    let mut messages: Vec<Value> = Vec::new();

    for msg in inbox.iter().take(15) {
        let code = msg
            .get("code")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let detail_url = msg
            .get("link")
            .and_then(|l| l.as_str())
            .map(|l| format!("{BASE}{l}"));
        match detail_url {
            None => {
                let mut m = msg.clone();
                m["id"] = json!(code);
                m["bodyText"] = json!("");
                m["bodyHtml"] = json!("");
                messages.push(m);
            }
            Some(url) => {
                if let Ok(new_ck) = warm_up_detail(&cookies, &url).await {
                    cookies = merge_cookies(&cookies, &new_ck);
                }
                let content = fetch_mail_content(&cookies, &code, &url, 2).await;
                let (body_text, body_html, attachments) = match content {
                    Ok((h, t, a)) => (t, h, a),
                    Err(_) => (String::new(), String::new(), Vec::new()),
                };
                messages.push(json!({
                    "id": code,
                    "sender": msg.get("sender").cloned().unwrap_or(Value::Null),
                    "subject": msg.get("subject").cloned().unwrap_or(Value::Null),
                    "time": msg.get("time").cloned().unwrap_or(Value::Null),
                    "bodyText": body_text,
                    "bodyHtml": body_html,
                    "attachments": attachments,
                }));
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        }
    }

    // persist refreshed cookies
    sessions.insert(
        session_id.clone(),
        json!({ "mailbox": mailbox, "salt": salt, "cookies": cookies, "createdAt": session.get("createdAt").cloned().unwrap_or(json!(now_ms())) }),
    );
    save_all_sessions(&sessions);

    Json(json!({
        "status": "success",
        "sessionId": session_id,
        "email": mailbox,
        "count": messages.len(),
        "messages": messages,
    })).into_response()

}

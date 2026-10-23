// BypassLink v3 — native conversion of api/bypass/bypasslinkv3.js
// Universal safelink gateway bypass: cookie jar, ray_id/alias form extraction,
// /api/session + /api/verify + /api/go flow, redirect chain up to 15 hops.
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Default, Clone)]
struct CookieJar {
    cookies: std::collections::BTreeMap<String, String>,
}

impl CookieJar {
    fn set_from_headers(&mut self, headers: &HeaderMap) {
        for val in headers.get_all("set-cookie") {
            if let Ok(s) = val.to_str() {
                let pair = s.split(';').next().unwrap_or("");
                if let Some(eq) = pair.find('=') {
                    let name = pair[..eq].trim().to_string();
                    let value = pair[eq + 1..].trim().to_string();
                    if !name.is_empty() {
                        self.cookies.insert(name, value);
                    }
                }
            }
        }
    }
    fn header(&self) -> String {
        self.cookies
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("; ")
    }
    fn get(&self, name: &str) -> Option<String> {
        self.cookies.get(name).cloned()
    }
}

fn resolve_relative(href: &str, base: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    url::Url::parse(base)
        .ok()
        .and_then(|b| b.join(href).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| href.to_string())
}

struct Resp {
    status: u16,
    headers: HeaderMap,
    body: String,
    final_url: String,
}

async fn fetch_with_jar(
    url: &str,
    method: &str,
    json_body: Option<&Value>,
    referer: Option<&str>,
    jar: &mut CookieJar,
) -> Result<Resp, String> {
    let client = reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut current = url.to_string();
    let mut method = method.to_string();
    let mut body = json_body.cloned();
    let mut redirect_count = 0;

    loop {
        let mut req = match method.as_str() {
            "POST" => client.post(&current),
            _ => client.get(&current),
        };
        req = req
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                        .header("Accept-Language", "en-US,en;q=0.9");
        if let Some(r) = referer {
            req = req.header("Referer", r);
        }
        let cookie_header = jar.header();
        if !cookie_header.is_empty() {
            req = req.header("Cookie", &cookie_header);
        }
        if let Some(b) = &body {
            req = req            .header("Content-Type", "application/json").json(b);
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        jar.set_from_headers(res.headers());
        let status = res.status().as_u16();
        if (300..400).contains(&status) {
            let loc = res
                .headers()
                .get("location")
                .and_then(|l| l.to_str().ok())
                .unwrap_or("")
                .to_string();
            if loc.is_empty() || redirect_count >= 10 {
                return Ok(Resp {
                    status,
                    headers: res.headers().clone(),
                    body: String::new(),
                    final_url: current,
                });
            }
            redirect_count += 1;
            method = "GET".into();
            body = None;
            current = resolve_relative(loc.trim(), &current);
            continue;
        }
        let headers = res.headers().clone();
        let text = res.text().await.unwrap_or_default();
        return Ok(Resp { status, headers, body: text, final_url: current });
    }
}

fn generate_session_token(raw_xsrf_cookie: &str) -> String {
    use sha2::{Digest, Sha256};
    let unquoted = raw_xsrf_cookie.trim_matches('"').to_string();
    let dummy_fp = Sha256::digest(
        b"webgl:ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)||audio:12.345678901234||canvas:abcdef123||fonts:20/25||system:8CPU,8GB,Win32,0,1,0||env:Asia/Jakarta,1920,1080,24,en-US||network:4g,10,50",
    );
    use base64::Engine;
    let o = format!("#{}", base64::engine::general_purpose::STANDARD.encode(dummy_fp));
    let keep = unquoted.len().min(128 - o.len());
    format!("{}{}", &unquoted[..keep], o)
}

async fn bypass_safelink(
    target_url: &str,
    initial_html: Option<&str>,
    jar: &mut CookieJar,
) -> Result<String, String> {
    let html = match initial_html {
        Some(h) => h.to_string(),
        None => {
            let r1 = fetch_with_jar(target_url, "GET", None, None, jar).await?;
            r1.body
        }
    };

    let form_re = regex::Regex::new(r#"(?is)<form[^>]+action=["']([^"']+)["'][^>]*>"#).unwrap();
    let ray_re = regex::Regex::new(r#"(?i)name=["']ray_id["']\s+value=["']([^"']+)["']"#).unwrap();
    let alias_re = regex::Regex::new(r#"(?i)name=["']alias["']\s+value=["']([^"']+)["']"#).unwrap();

    let action_url = form_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let ray_id = ray_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let alias = alias_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let (action_url, ray_id, alias) = match (action_url, ray_id, alias) {
        (Some(a), Some(r), Some(al)) => (a, r, al),
        _ => return Err("Safelink form (ray_id/alias) not found".to_string()),
    };

    let parsed_action =
        url::Url::parse(&resolve_relative(&action_url, target_url)).map_err(|e| e.to_string())?;
    let blog_origin = format!(
        "{}://{}",
        parsed_action.scheme(),
        parsed_action.host_str().unwrap_or("")
    );
    let redirect_url = format!(
        "{}/redirect.php?ray_id={}&alias={}",
        blog_origin,
        urlencoding::encode(&ray_id),
        urlencoding::encode(&alias)
    );

    let r2 = fetch_with_jar(&redirect_url, "GET", None, Some(target_url), jar).await?;
    let step1_page_url = r2.final_url.clone();

    let xsrf1 = jar
        .get("XSRF-TOKEN")
        .ok_or_else(|| "Missing XSRF-TOKEN on gateway.".to_string())?;
    let token_payload1 = generate_session_token(&xsrf1);

    let session_data1: Value = fetch_with_jar(
        &format!("{}/api/session", blog_origin),
        "POST",
        Some(&json!({ "_token": token_payload1 })),
        Some(&step1_page_url),
        jar,
    )
    .await
    .and_then(|r| serde_json::from_str(&r.body).map_err(|e| e.to_string()))
    .unwrap_or(json!({}));

    let step = session_data1
        .get("step")
        .and_then(|s| s.as_i64())
        .unwrap_or(1);
    let mut step2_page_url = step1_page_url.clone();

    if step == 1 {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        let verify_data: Value = fetch_with_jar(
            &format!("{}/api/verify", blog_origin),
            "POST",
            Some(&json!({ "_a": 0, "captcha": null, "passcode": null })),
            Some(&step1_page_url),
            jar,
        )
        .await
        .and_then(|r| serde_json::from_str(&r.body).map_err(|e| e.to_string()))
        .unwrap_or(json!({}));

        let mut target = verify_data
            .get("target")
            .and_then(|t| t.as_str())
            .unwrap_or("/redirect.php")
            .to_string();
        if target.starts_with('/') {
            target = format!("{}{}", blog_origin, target);
        }
        let r3 = fetch_with_jar(&target, "GET", None, Some(&step1_page_url), jar).await?;
        step2_page_url = r3.final_url.clone();

        let xsrf2 = jar.get("XSRF-TOKEN").unwrap_or(xsrf1);
        let _ = fetch_with_jar(
            &format!("{}/api/session", blog_origin),
            "POST",
            Some(&json!({ "_token": generate_session_token(&xsrf2) })),
            Some(&step2_page_url),
            jar,
        )
        .await;
    }

    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    let key: i64 = 500;
    let size = format!("{}.{}", (1920 + key) * 2, (1080 + key) * 2);

    let go_data: Value = fetch_with_jar(
        &format!("{}/api/go", blog_origin),
        "POST",
        Some(&json!({ "key": key, "size": size })),
        Some(&step2_page_url),
        jar,
    )
    .await
    .and_then(|r| serde_json::from_str(&r.body).map_err(|e| e.to_string()))
    .map_err(|_| "Invalid /api/go response.".to_string())?;

    let mut ready_url = go_data
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "Failed to get ready URL.".to_string())?
        .to_string();
    if !ready_url.starts_with("http://") && !ready_url.starts_with("https://") {
        ready_url = resolve_relative(&ready_url, &blog_origin);
    }

    let r_ready = fetch_with_jar(&ready_url, "GET", None, Some(&step2_page_url), jar).await?;
    let html_ready = &r_ready.body;
    let dest_re = regex::Regex::new(r#"(?i)window\.location\.href\s*=\s*["']([^"']+)["']"#).unwrap();
    if let Some(m) = dest_re.captures(html_ready) {
        let dest = m.get(1).unwrap().as_str();
        return Ok(dest.replace("\\/", "/").replace("\\u0026", "&"));
    }
    Ok(ready_url)
}

async fn resolve_chain(initial_url: &str) -> Result<String, String> {
    let mut current = initial_url.trim().to_string();
    if !current.starts_with("http://") && !current.starts_with("https://") {
        current = format!("https://{}", current);
    }
    let mut visited = std::collections::HashSet::new();
    let max_hops = 15;

    for _ in 0..max_hops {
        if visited.contains(&current) {
            break;
        }
        visited.insert(current.clone());

        let mut jar = CookieJar::default();
        let res = match fetch_with_jar(&current, "GET", None, None, &mut jar).await {
            Ok(r) => r,
            Err(e) => return Err(format!("Fetch failed: {}", e)),
        };

        let status = res.status;
        if (300..400).contains(&status) {
            if let Some(loc) = res.headers.get("location").and_then(|l| l.to_str().ok()) {
                current = resolve_relative(loc.trim(), &current);
                continue;
            }
        }
        if res.final_url != current && (200..300).contains(&status) {
            current = res.final_url.clone();
        }

        let html = res.body.clone();
        if html.contains("ray_id") || html.contains("redirect.php") {
            let mut jar2 = jar.clone();
            match bypass_safelink(&current, Some(&html), &mut jar2).await {
                Ok(dest) if !dest.is_empty() && dest != current => {
                    current = dest;
                    continue;
                }
                Ok(_) => {}
                Err(e) => return Err(e),
            }
        }

        let meta_re = regex::Regex::new(
            r#"(?i)<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']"#,
        )
        .unwrap();
        if let Some(m) = meta_re.captures(&html) {
            current = resolve_relative(m.get(1).unwrap().as_str().trim(), &current);
            continue;
        }
        break;
    }
    Ok(current)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let url_param = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });
    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "error": "Parameter 'url' wajib diisi."
            })))
            .into_response()
        }
    };

    match resolve_chain(&url).await {
        Ok(dest) => {
            Json(json!({ "status": true, "result": dest, "destination": dest })).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false, "error": e, "url": url
        })))
        .into_response(),
    }
}

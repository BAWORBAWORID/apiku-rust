// Safelinku Bypass — native conversion of api/bypass/safelink.js
// lokerwfh.net gateway: ray_id/alias -> redirect.php cookie -> /api/session,
// /api/verify, /api/go with Idempotency-Key -> final window.location.href.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const BASE: &str = "https://lokerwfh.net";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

fn no_redirect_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

fn random_str(len: usize) -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn parse_ads(html: &str) -> Option<Value> {
    let re = regex::Regex::new(r"(?s)const ads = JSON\.parse\('(.+?)'\);").unwrap();
    let m = re.captures(html)?.get(1)?.as_str().to_string();
    let mut out = String::with_capacity(m.len());
    let mut chars = m.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(cp) {
                            out.push(ch);
                        }
                    }
                }
                Some('/') => out.push('/'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    serde_json::from_str(&out).ok()
}

async fn bypass(url: &str) -> Result<String, String> {
    let client = client()?;
    let nr = no_redirect_client()?;

    let html = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let val = |name: &str| -> Option<String> {
        let re = regex::Regex::new(&format!(r#"name="{}"\s+value="([^"]+)""#, name)).unwrap();
        re.captures(&html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    };
    let ray_id = val("ray_id").ok_or("Failed to get ray_id/alias from HTML")?;
    let alias = val("alias").ok_or("Failed to get ray_id/alias from HTML")?;
    let action_re = regex::Regex::new(r#"action="([^"]+)""#).unwrap();
    let action_url = action_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| format!("{}/redirect.php", BASE));

    let redir = nr
        .get(format!("{}?ray_id={}&alias={}", action_url, ray_id, alias))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let cookie = redir
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|s| s.split(';').next().map(|p| p.to_string()))
        .collect::<Vec<_>>()
        .join("; ");
    let location = redir
        .headers()
        .get("location")
        .and_then(|l| l.to_str().ok())
        .ok_or("No location from redirect.php")?
        .to_string();
    let artikel_url = if location.starts_with("http") {
        location
    } else {
        format!("{}{}", BASE, location)
    };

    let artikel = client
        .get(&artikel_url)
        .header("Cookie", &cookie)
                    .header("Referer", "https://sfl.gl/")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    parse_ads(&artikel).ok_or("ads object not found")?;

    let api = |req: reqwest::RequestBuilder| {
        req.header("Cookie", &cookie)
            .header("Referer", &artikel_url)
            .header("Origin", BASE)
                        .header("Content-Type", "application/json")
    };

    api(client.post(format!("{}/api/session", BASE)))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    api(client.post(format!("{}/api/verify", BASE)))
        .body(json!({ "_a": 0, "captcha": null, "passcode": null }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_secs(4)).await;

    let key: i64 = {
        use rand::Rng;
        rand::thread_rng().gen_range(0..1000)
    };
    let size = format!("{}.{}", (1366 + key) * 2, (768 + key) * 2);
    let go: Value = api(client.post(format!("{}/api/go", BASE)))
        .header("Idempotency-Key", random_str(32))
        .body(json!({ "key": key, "size": size, "_dvc": "a1b2c3d4" }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let go_url = go
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or("No url from /api/go")?
        .to_string();
    let full_url = if go_url.starts_with("http") {
        go_url
    } else {
        format!("{}{}", BASE, go_url)
    };

    let ready = client
        .get(&full_url)
        .header("Cookie", &cookie)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let m_re = regex::Regex::new(r#"window\.location\.href\s*=\s*["']([^"']+)["']"#).unwrap();
    let m = m_re
        .captures(&ready)
        .and_then(|c| c.get(1))
        .ok_or("Final URL not found in ready/go")?;
    Ok(m.as_str().replace("\\/", "/"))
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
                "status": false,
                "message": "Parameter 'url' wajib diisi"
            })))
            .into_response()
        }
    };
    if url::Url::parse(&url).is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Format URL tidak valid"
        })))
        .into_response();
    }
    let start = std::time::Instant::now();
    match bypass(&url).await {
        Ok(result) => Json(json!({
            "status": true,
            "result": {
                "originalUrl": url,
                "bypassedUrl": result,
                "responseTime": format!("{}ms", start.elapsed().as_millis())
            }
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": e,
            "result": { "responseTime": format!("{}ms", start.elapsed().as_millis()) }
        })))
        .into_response(),
    }
}

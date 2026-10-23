// ModJall Bypass — native conversion of api/bypass/modjall.js
// Khaddavi safelink gateway flow: extract ray_id/alias, follow redirect.php,
// /api/verify + /api/go with XSRF-TOKEN cookie, then read final token.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

#[derive(Default, Clone)]
struct CookieJar {
    cookies: std::collections::BTreeMap<String, String>,
}

impl CookieJar {
    fn update(&mut self, headers: &reqwest::header::HeaderMap) {
        for val in headers.get_all("set-cookie") {
            if let Ok(s) = val.to_str() {
                let pair = s.split(';').next().unwrap_or("");
                if let Some(eq) = pair.find('=') {
                    let k = pair[..eq].trim().to_string();
                    let v = pair[eq + 1..].trim().to_string();
                    if !k.is_empty() {
                        self.cookies.insert(k, v);
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
    fn get(&self, k: &str) -> String {
        self.cookies.get(k).cloned().unwrap_or_default()
    }
}

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

fn token_re() -> regex::Regex {
    regex::Regex::new(r#"(?i)(?:var\s+token\s*=\s*|value=)["']([a-f0-9]{32})["']"#).unwrap()
}

async fn run_bypass(raw_url: &str) -> Result<(Option<String>, u64), String> {
    let start = std::time::Instant::now();
    let client = client()?;
    let nr = no_redirect_client()?;
    let mut cookies = CookieJar::default();

    let res1 = client.get(raw_url).send().await.map_err(|e| e.to_string())?;
    cookies.update(res1.headers());
    let html1 = res1.text().await.unwrap_or_default();

    if let Some(m) = token_re().captures(&html1) {
        return Ok((
            Some(m.get(1).unwrap().as_str().to_string()),
            start.elapsed().as_millis() as u64,
        ));
    }

    let ray_re = regex::Regex::new(r#"(?i)name="ray_id"\s+value="([^"]+)""#).unwrap();
    let alias_re = regex::Regex::new(r#"(?i)name="alias"\s+value="([^"]+)""#).unwrap();
    let action_re = regex::Regex::new(r#"(?i)action="([^"]+)""#).unwrap();

    let ray_id = ray_re
        .captures(&html1)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("Gagal mengekstrak ray_id atau alias dari halaman.")?;
    let alias = alias_re
        .captures(&html1)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("Gagal mengekstrak ray_id atau alias dari halaman.")?;
    let form_action = action_re
        .captures(&html1)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "https://app.khaddavi.net/redirect.php".to_string());
    let gateway_origin = url::Url::parse(&form_action)
        .map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or("")))
        .unwrap_or_default();

    let redirect_q = format!(
        "{}?ray_id={}&alias={}",
        form_action,
        urlencoding::encode(&ray_id),
        urlencoding::encode(&alias)
    );
    let res2 = nr
        .get(&redirect_q)
        .header("Referer", raw_url)
        .header("Cookie", cookies.header())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    cookies.update(res2.headers());
    let loc1 = res2
        .headers()
        .get("location")
        .and_then(|l| l.to_str().ok())
        .map(|s| s.to_string())
        .ok_or("Gagal mendapatkan lokasi artikel step 1.")?;
    let loc1 = if loc1.starts_with('/') {
        format!("{}{}", gateway_origin, loc1)
    } else {
        loc1
    };

    let res3 = client
        .head(&loc1)
        .header("Referer", &redirect_q)
        .header("Cookie", cookies.header())
        .send()
        .await;
    if let Ok(r3) = &res3 {
        cookies.update(r3.headers());
    }

    let xsrf = cookies.get("XSRF-TOKEN");
    let verify: Value = client
        .post(format!("{}/api/verify", gateway_origin))
        .header("Referer", &loc1)
        .header("Origin", &gateway_origin)
                    .header("Content-Type", "application/json")
        .header("X-XSRF-TOKEN", &xsrf)
        .header("Cookie", cookies.header())
        .body(json!({ "_a": 0, "captcha": null }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let step2_target = verify
        .get("target")
        .and_then(|t| t.as_str())
        .ok_or_else(|| format!("API Verify gagal: {}", verify))?
        .to_string();

    let res_step2 = nr
        .get(&step2_target)
        .header("Referer", &loc1)
        .header("Cookie", cookies.header())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    cookies.update(res_step2.headers());
    let loc2 = res_step2
        .headers()
        .get("location")
        .and_then(|l| l.to_str().ok())
        .map(|s| s.to_string())
        .ok_or("Gagal mendapatkan lokasi artikel step 2.")?;
    let loc2 = if loc2.starts_with('/') {
        format!("{}{}", gateway_origin, loc2)
    } else {
        loc2
    };

    if let Ok(ra) = client
        .head(&loc2)
        .header("Referer", &step2_target)
        .header("Cookie", cookies.header())
        .send()
        .await
    {
        cookies.update(ra.headers());
    }

    let key: i64 = {
        use rand::Rng;
        rand::thread_rng().gen_range(0..1000)
    };
    let size = format!("{}.{}", (1366 + key) * 2, (768 + key) * 2);
    let xsrf = cookies.get("XSRF-TOKEN");

    let go: Value = client
        .post(format!("{}/api/go", gateway_origin))
        .header("Referer", &loc2)
        .header("Origin", &gateway_origin)
                    .header("Content-Type", "application/json")
        .header("X-XSRF-TOKEN", &xsrf)
        .header("Cookie", cookies.header())
        .body(json!({ "key": key, "size": size }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let shortlink_url = go
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| format!("API Go gagal: {}", go))?
        .to_string();

    let res_short = client
        .get(&shortlink_url)
        .header("Referer", &loc2)
        .header("Cookie", cookies.header())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let final_loc = res_short
        .headers()
        .get("location")
        .and_then(|l| l.to_str().ok())
        .map(|s| s.to_string());
    let html_short = res_short.text().await.unwrap_or_default();

    let destination = {
        let href_re = regex::Regex::new(r#"(?i)window\.location\.href\s*=\s*"([^"]+)""#).unwrap();
        if let Some(m) = href_re.captures(&html_short) {
            m.get(1)
                .unwrap()
                .as_str()
                .replace("\\/", "/")
                .replace("\\\"", "\"")
                .replace("\\u0026", "&")
        } else {
            final_loc.unwrap_or_else(|| shortlink_url.clone())
        }
    };

    let res_final = client
        .get(&destination)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let html_final = res_final.text().await.unwrap_or_default();
    let final_token = token_re()
        .captures(&html_final)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    Ok((final_token, start.elapsed().as_millis() as u64))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let raw_url = query.get("url").cloned().or_else(|| {
        body.as_ref()
            .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
    });
    let raw_url = match raw_url {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "success": false,
                "message": "Parameter url tidak ditemukan."
            })))
            .into_response()
        }
    };

    match run_bypass(&raw_url).await {
        Ok((token, ms)) => Json(json!({
            "success": token.is_some(),
            "result": {
                "token": token,
                "original_url": raw_url,
            },
            "execution_time_ms": ms,
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "success": false,
            "message": e,
        })))
        .into_response(),
    }
}

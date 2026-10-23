use base64::Engine as _;
// reCAPTCHA v3 / v3 Enterprise bypass — converted from api/solve/recaptcha-v3.js
// Pure HTTP: anchor → extract recaptcha-token → reload → extract rresp.
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;
use super::common::{err, merged_params, ok};

const DEFAULT_SITEKEY: &str = "6LfB5_IbAAAAAMCtsjEHEHKqcB9iQocwwxTiihJu";
const DEFAULT_V: &str = "pCoGBhjs9s8EhFOHJFe8cqis";

fn build_co(url: &str) -> Option<String> {
    // origin:port base64 without padding, mirroring Node's Buffer.from(`${origin}:${port}`)
    let (protocol, rest) = if let Some(r) = url.strip_prefix("https://") {
        ("https://", r)
    } else if let Some(r) = url.strip_prefix("http://") {
        ("http://", r)
    } else {
        return None;
    };
    let origin = format!("{protocol}{}", rest.split('/').next().unwrap_or(""));
    let port = if protocol == "https://" { "443" } else { "80" };
    let raw = format!("{origin}:{port}");
    Some(base64::engine::general_purpose::STANDARD.encode(raw).replace('=', ""))
}

fn extract_between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = text.find(start)? + start.len();
    let rest = &text[i..];
    let j = rest.find(end)?;
    Some(&rest[..j])
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let params = merged_params(&query, body.map(|b| b.0));

    let sitekey = params
        .get("sitekey")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_SITEKEY)
        .to_string();
    let page_url = params.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    let anchor_url = params.get("anchorUrl").and_then(Value::as_str).map(str::to_string);

    if anchor_url.is_none() && page_url.is_empty() {
        return Json(err("Parameter 'url' wajib diisi"));
    }
    let _ = &state;

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(err(&e.to_string())),
    };

    let (version_path, params_str) = if let Some(anchor) = &anchor_url {
        // match /(api2|enterprise)\/anchor\?(.*)/
        match anchor.split_once("/anchor?") {
            Some((prefix, qs)) => {
                let vp = prefix.rsplit('/').next().unwrap_or("api2").to_string();
                (vp, qs.to_string())
            }
            None => return Json(err("Invalid anchor URL")),
        }
    } else {
        let co = match params.get("co").and_then(Value::as_str) {
            Some(c) => c.to_string(),
            None => match build_co(&page_url) {
                Some(c) => c,
                None => return Json(err("'url' atau 'co' wajib diisi")),
            },
        };
        let cb: String = (0..12)
            .map(|_| {
                let n = rand::random::<u8>() % 36;
                if n < 10 { (b'0' + n) as char } else { (b'a' + n - 10) as char }
            })
            .collect();
        let qs = format!(
            "ar=1&k={sitekey}&co={co}&hl=en&v={DEFAULT_V}&size=invisible&cb={cb}"
        );
        ("api2".to_string(), qs)
    };

    let base = format!("https://www.google.com/recaptcha/{version_path}/");
    let qs_params: HashMap<String, String> = params_str
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let k = qs_params.get("k").cloned().unwrap_or_else(|| sitekey.clone());
    let co = qs_params.get("co").cloned().unwrap_or_default();
    let v = qs_params.get("v").cloned().unwrap_or_else(|| DEFAULT_V.to_string());

    // 1. anchor → recaptcha-token
    let anchor_res = match client.get(format!("{base}anchor?{params_str}")).send().await {
        Ok(r) => r,
        Err(e) => return Json(err(&format!("anchor request failed: {e}"))),
    };
    let anchor_text = match anchor_res.text().await {
        Ok(t) => t,
        Err(e) => return Json(err(&e.to_string())),
    };
    let recaptcha_token = match extract_between(&anchor_text, "\"recaptcha-token\" value=\"", "\"") {
        Some(t) => t.to_string(),
        None => return Json(err("recaptcha-token tidak ditemukan")),
    };

    // 2. reload → rresp
    let action = params.get("action").and_then(Value::as_str);
    let mut form = vec![
        ("v", v.as_str()),
        ("reason", "q"),
        ("c", recaptcha_token.as_str()),
        ("k", k.as_str()),
        ("co", co.as_str()),
    ];
    if let Some(sa) = action {
        form.push(("sa", sa));
    }
    let reload_res = match client
        .post(format!("{base}reload?k={k}"))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Json(err(&format!("reload request failed: {e}"))),
    };
    let reload_text = match reload_res.text().await {
        Ok(t) => t,
        Err(e) => return Json(err(&e.to_string())),
    };
    let token = match extract_between(&reload_text, "\"rresp\",\"", "\"") {
        Some(t) => t.to_string(),
        None => return Json(err("rresp tidak ditemukan — sitekey/co salah atau di-block")),
    };

    Json(ok(json!({
        "token": token,
        "responseTime": format!("{}ms", start_time.elapsed().as_millis()),
    })))
}

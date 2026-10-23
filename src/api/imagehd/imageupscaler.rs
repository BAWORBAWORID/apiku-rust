// Image Upscaler — native conversion of api/imagehd/imageupscaler.js
// imageupscaler.com: scrape nonce from page -> admin-ajax processing_images_adv.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE: &str = "https://imageupscaler.com";
const AJAX: &str = "https://imageupscaler.com/wp-admin/admin-ajax.php";

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn merge_params(query: HashMap<String, String>, body: Option<Json<Value>>) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in query {
        m.insert(k, Value::String(v));
    }
    if let Some(Json(b)) = body {
        if let Value::Object(o) = b {
            for (k, v) in o {
                m.insert(k, v);
            }
        }
    }
    Value::Object(m)
}

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("accept", "*/*".parse().unwrap());
    h.insert("accept-language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h.insert("cache-control", "no-cache".parse().unwrap());
    h.insert("pragma", "no-cache".parse().unwrap());
    h.insert("user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36".parse().unwrap());
    h
}

fn gen_pid() -> String {
    let a = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut b: String = (0..20).map(|_| rng.gen_range(0..10).to_string()).collect();
    b.truncate(20);
    format!("{}{}", a, b)[..30.min(a.len() + b.len())].to_string()
}

fn extract_nonce(html: &str) -> Option<String> {
    let key = "name=\"process_nonce\"";
    let idx = html.find(key)?;
    let rest = &html[idx + key.len()..];
    let vidx = rest.find("value=\"")? + "value=\"".len();
    let end = rest[vidx..].find('"')? + vidx;
    Some(rest[vidx..end].to_string())
}

fn extract_pid(html: &str) -> Option<String> {
    // pid "..." pattern with 20-35 digits
    for marker in ["\"pid\"", "'pid'", "pid"] {
        if let Some(idx) = html.find(marker) {
            let rest = &html[idx + marker.len()..];
            // skip separators : = " '
            let digits: String = rest
                .chars()
                .skip_while(|c| !c.is_ascii_digit())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if digits.len() >= 20 && digits.len() <= 35 {
                return Some(digits);
            }
        }
    }
    None
}

fn join_cookies(resp: &reqwest::Response) -> String {
    let mut out = Vec::new();
    for v in resp.headers().get_all("set-cookie") {
        if let Ok(s) = v.to_str() {
            if let Some(first) = s.split(';').next() {
                out.push(first.to_string());
            }
        }
    }
    out.join("; ")
}

fn b64_data_url(bytes: &[u8], mime: &str) -> String {
    use base64::Engine;
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let params = merge_params(query, body);
    let url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    let scale = params
        .get("scale")
        .and_then(|v| v.as_str())
        .unwrap_or("4x")
        .to_lowercase();
    let increase = if scale == "2x" || scale == "2" {
        "2"
    } else if scale == "6x" || scale == "6" {
        "6"
    } else {
        "4"
    };

    // Download image
    let img_cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())
        .unwrap_or_else(|_| reqwest::Client::new());
    let img_bytes = match img_cl
        .get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
    {
        Ok(r) => match r.bytes().await {
            Ok(b) => b.to_vec(),
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        },
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let ext = url
        .split('.')
        .next_back()
        .unwrap_or("jpg")
        .split('?')
        .next()
        .unwrap_or("jpg")
        .to_lowercase();
    let mime = if ext == "png" {
        "image/png"
    } else if ext == "webp" {
        "image/webp"
    } else {
        "image/jpeg"
    };
    let b64 = b64_data_url(&img_bytes, mime);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let fname = format!("upscale_{now}.{ext}");
    let file_id = format!("{now}_{fname}");

    // Session: fetch page for nonce/pid/cookies
    let session_cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let page = match session_cl
        .get(format!("{BASE}/upscale-image-4x/"))
        .headers(base_headers())
        .header("referer", BASE)
        .send()
        .await
    {
        Ok(r) => {
            let cookies = join_cookies(&r);
            let text = r.text().await.unwrap_or_default();
            (text, cookies)
        }
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let nonce = match extract_nonce(&page.0) {
        Some(n) => n,
        None => return jerr(StatusCode::INTERNAL_SERVER_ERROR, "nonce not found"),
    };
    let pid = extract_pid(&page.0).unwrap_or_else(gen_pid);

    let media_data = json!([{ "fileSrc": b64, "fileName": fname, "fileId": file_id }]).to_string();
    let parameters = json!({
        "upscale-type": "standard",
        "increase": increase,
        "save-format": "auto"
    })
    .to_string();

    let form = [
        ("action", "processing_images_adv"),
        ("nonce", nonce.as_str()),
        ("pid", pid.as_str()),
        ("function", "upscale-image-4x"),
        ("batch_number", "1"),
        ("total_batches", "1"),
        ("mediaData", media_data.as_str()),
        ("parameters", parameters.as_str()),
    ];

    let mut ajax_cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
        .post(AJAX)
        .headers(base_headers())
                    .header("content-type", "application/x-www-form-urlencoded")
        .header("referer", format!("{BASE}/upscale-image-4x/"));
    if !page.1.is_empty() {
        ajax_cl = ajax_cl.header("cookie", page.1.clone());
    }
    let resp = match ajax_cl.form(&form).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let data: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let success = data.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    let items = data.pointer("/data/items").and_then(|i| i.as_array());
    if !success || items.map(|i| i.is_empty()).unwrap_or(true) {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal upscale: {data}"));
    }
    let item = &items.unwrap()[0];
    let item_url = item.get("url").cloned().unwrap_or(Value::Null);
    let item_name = item.get("name").cloned().unwrap_or(Value::Null);
    let credits = data
        .pointer("/data/remainingCredits")
        .cloned()
        .unwrap_or(Value::Null);

    Json(json!({
        "status": true,
        "result": {
            "url": item_url,
            "name": item_name,
            "credits_remaining": credits,
            "scale": format!("{increase}x"),
        }
    })).into_response()

}

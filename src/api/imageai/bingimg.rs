// AI Bing Image Search — native conversion of api/imageai/bingimg.js
// Scrapes bing.com/images/search HTML (a.iusc m attributes, murl field),
// picks a random valid image URL and returns the downloaded image bytes.
use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

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

fn p_str<'a>(p: &'a Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        p.get(*k).and_then(|v| v.as_str()).map(|s| s.to_string())
    })
}

fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default()
}

fn bytes_response(ct: &str, bytes: bytes::Bytes) -> Response {
    (StatusCode::OK, [(header::CONTENT_TYPE, ct.to_string())], bytes).into_response()
}

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn valid_image_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]
        .iter()
        .any(|e| lower.contains(e))
        || lower.contains("image")
        || lower.contains("img")
}

fn extract_image_urls(html: &str) -> Vec<String> {
    // m attribute is HTML-escaped JSON: m="{&quot;murl&quot;:&quot;https://...&quot;...}"
    let re = regex::Regex::new(r#"murl&quot;:&quot;(.*?)&quot;"#).unwrap();
    let mut out: Vec<String> = Vec::new();
    for cap in re.captures_iter(html) {
        let mut url = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        url = url.replace(r"\", "");
        if url.starts_with("http") && valid_image_url(&url) && !out.contains(&url) {
            out.push(url);
        }
    }
    out
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, _body: Option<Json<Value>>) -> Response {
    let query_param = match query.get("query") {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => {
            return jerr(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi");
        }
    };
    let sanitized: String = query_param
        .chars()
        .filter(|c| *c != '<' && *c != '>')
        .collect::<String>()
        .trim()
        .chars()
        .take(100)
        .collect();

    let search_url = format!(
        "https://www.bing.com/images/search?q={}&form=HDRSC2&first=1&tsc=ImageBasicHover",
        urlencoding::encode(&sanitized)
    );

    let client = http_client(60);
    let html = match client
        .get(&search_url)
                    .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("accept-language", "en-US,en;q=0.5")
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal memuat halaman Bing: {e}")),
        },
        Err(e) => {
            let msg = if e.is_timeout() {
                "Timeout saat mengakses Bing".to_string()
            } else if e.status() == Some(StatusCode::FORBIDDEN) {
                "Akses ke Bing diblokir. Coba lagi nanti.".to_string()
            } else {
                format!("Akses ke Bing gagal: {e}")
            };
            return jerr(StatusCode::INTERNAL_SERVER_ERROR, &msg);
        }
    };

    let urls = extract_image_urls(&html);
    if urls.is_empty() {
        return jerr(StatusCode::NOT_FOUND, "Tidak ada gambar ditemukan untuk pencarian ini");
    }

    use rand::Rng;
    let idx = rand::thread_rng().gen_range(0..urls.len());
    let selected = urls[idx].clone();

    let img_res = match client
        .get(&selected)
                    .header("referer", "https://www.bing.com/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return jerr(StatusCode::NOT_FOUND, "Gambar tidak ditemukan (404)"),
    };
    let ct = img_res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    if !ct.starts_with("image/") {
        return jerr(StatusCode::NOT_FOUND, "URL bukan gambar");
    }

    match img_res.bytes().await {
        Ok(bytes) => bytes_response(&ct, bytes),
        Err(e) => jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal download gambar: {e}")),
    }
}

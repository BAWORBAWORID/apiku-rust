// Photooxy Text Effects — native conversion of api/ephoto/photooxy.js
// Best-effort native: GET halaman effect, POST #main-form teks, ekstrak URL hasil.
// TextPro Effects Generator — native conversion of api/ephoto/textpro.js
// textpro.me: efek dilayani via jQuery AJAX submit di browser (dilindungi Cloudflare).
// Versi native best-effort: GET halaman effect, POST form ke action, cari URL hasil.
// Pollinations AI Image — native conversion of api/imageai/pollinations.js
// Pure HTTP: GET image.pollinations.ai/prompt/<prompt> and stream the image bytes back.
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

fn browser_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(UA)
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default()
}

/// Ambil form action + jumlah input text[] dari halaman effect.
fn parse_form(html: &str, page_url: &str) -> (String, usize) {
    let action_re = regex::Regex::new(r#"<form[^>]*action="([^"]*)"[^>]*>"#).unwrap();
    let action = action_re
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let action_url = if action.is_empty() {
        page_url.to_string()
    } else if action.starts_with("http") {
        action
    } else if let Ok(base) = url::Url::parse(page_url) {
        base.join(&action).map(|u| u.to_string()).unwrap_or(page_url.to_string())
    } else {
        page_url.to_string()
    };
    let text_count = html.matches("name=\"text[]\"").count();
    (action_url, text_count)
}

/// Encode form fields text[] = teks (multiple).
fn text_form_fields(texts: &[&str]) -> String {
    texts
        .iter()
        .map(|t| format!("text%5B%5D={}", urlencoding::encode(t)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Cari URL hasil (image) dari response create-image / halaman result.
fn find_result_url(text: &str) -> Option<String> {
    let re = regex::Regex::new(r#""(?:fullsize_)?image"\s*:\s*"([^"]+)""#).unwrap();
    if let Some(m) = re.captures(text) {
        let img = m.get(1).unwrap().as_str().replace(r"\/", "/");
        return Some(if img.starts_with("http") {
            img
        } else {
            format!("https://{img}")
        });
    }
    let href_re = regex::Regex::new(r#"img[^>]+src="(https?://[^"]*(?:yotools|image|result)[^"]*)""#).unwrap();
    href_re.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}


const PHOTOOXY_EFFECTS: &[(&str, &str, usize)] = &[
    ("flaming", "https://photooxy.com/logo-and-text-effects/realistic-flaming-text-effect-online-197.html", 1),
    ("shadow-sky", "https://photooxy.com/logo-and-text-effects/shadow-text-effect-in-the-sky-394.html", 1),
    ("metallic", "https://photooxy.com/other-design/create-metallic-text-glow-online-188.html", 1),
    ("naruto", "https://photooxy.com/manga-and-anime/make-naruto-banner-online-free-378.html", 1),
    ("pubg", "https://photooxy.com/battlegrounds/make-wallpaper-battlegrounds-logo-text-146.html", 2),
    ("under-grass", "https://photooxy.com/logo-and-text-effects/make-quotes-under-grass-376.html", 1),
    ("harry-potter", "https://photooxy.com/logo-and-text-effects/create-harry-potter-text-on-horror-background-178.html", 1),
    ("flower-typography", "https://photooxy.com/art-effects/flower-typography-text-effect-164.html", 1),
    ("picture-of-love", "https://photooxy.com/logo-and-text-effects/create-a-picture-of-love-message-377.html", 1),
    ("coffee-cup", "https://photooxy.com/logo-and-text-effects/put-any-text-in-to-coffee-cup-371.html", 1),
    ("butterfly", "https://photooxy.com/logo-and-text-effects/butterfly-text-with-reflection-effect-183.html", 1),
    ("night-sky", "https://photooxy.com/logo-and-text-effects/write-stars-text-on-the-night-sky-200.html", 1),
    ("carved-wood", "https://photooxy.com/logo-and-text-effects/carved-wood-effect-online-171.html", 1),
    ("illuminated-metallic", "https://photooxy.com/logo-and-text-effects/illuminated-metallic-effect-177.html", 1),
    ("sweet-candy", "https://photooxy.com/logo-and-text-effects/sweet-andy-text-online-168.html", 1),
];

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let effect = p_str(&params, &["effect"]).unwrap_or_default();
    let text = p_str(&params, &["text"]).unwrap_or_default();
    let text2 = p_str(&params, &["text2"]).unwrap_or_default();

    if effect == "list" {
        let effects: Vec<Value> = PHOTOOXY_EFFECTS
            .iter()
            .map(|(name, url, count)| json!({ "name": name, "url": url, "textCount": count }))
            .collect();
        return Json(json!({
            "status": true,
            "message": "Daftar effect photooxy",
            "total": effects.len(),
            "effects": effects
        }))
        .into_response();
    }

    let (key, url, text_count) = match PHOTOOXY_EFFECTS.iter().find(|(k, _, _)| *k == effect.as_str()) {
        Some((k, u, c)) => (*k, *u, *c),
        None => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": format!("Effect \"{effect}\" tidak valid"),
                "code": "INVALID_EFFECT"
            }))).into_response()
        }
    };

    if text.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'text' wajib diisi",
            "code": "MISSING_TEXT"
        }))).into_response();
    }
    if text_count == 2 && text2.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": format!("Effect \"{effect}\" membutuhkan 2 teks. Gunakan parameter 'text' dan 'text2'"),
            "code": "MISSING_TEXT2"
        }))).into_response();
    }
    if text.len() > 100 || text2.len() > 100 {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Text terlalu panjang. Maksimal 100 karakter per teks.",
            "code": "TEXT_TOO_LONG"
        }))).into_response();
    }

    let client = browser_client(90);

    // 1. GET halaman effect
    let page = match client.get(url).send().await {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal memuat halaman photooxy: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal memuat halaman photooxy: {e}")),
    };
    let (action_url, _) = parse_form(&page, url);

    // 2. POST form teks (multipart)
    let mut form = reqwest::multipart::Form::new();
    let mut texts: Vec<&str> = vec![text.trim()];
    if text_count == 2 {
        texts.push(text2.trim());
    }
    for t in &texts {
        form = form.part("text[]", reqwest::multipart::Part::text(t.to_string()));
    }
    let hidden_re = regex::Regex::new(r#"<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)""#).unwrap();
    for cap in hidden_re.captures_iter(&page) {
        let name = cap.get(1).unwrap().as_str();
        let value = cap.get(2).unwrap().as_str().replace("&amp;", "&");
        form = form.part(name.to_string(), reqwest::multipart::Part::text(value));
    }
    let submit = client.post(&action_url).multipart(form).send().await;
    let result_html = match submit {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal memproses efek: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal memproses efek: {e}")),
    };

    // 3. Cari URL hasil (img result / yotools)
    let img_re = regex::Regex::new(r#"<img[^>]+src="(https?://[^"]*(?:yotools|photooxy)[^"]*)""#).unwrap();
    let link_re = regex::Regex::new(r#"href="(https?://[^"]*(?:yotools|download|result)[^"]*)""#).unwrap();
    let result_url = img_re
        .captures(&result_html)
        .or_else(|| link_re.captures(&result_html))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("&amp;", "&"));
    let result_url = match result_url {
        Some(u) => u,
        None => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": "Gagal memuat gambar hasil. Mungkin effect sedang tidak tersedia.",
            "code": "IMAGE_ERROR"
        }))).into_response(),
    };

    // 4. Download gambar
    let img = match client.get(&result_url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Gagal download gambar: {e}")),
    };
    let mime = img
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    match img.bytes().await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, mime),
                (header::HeaderName::from_static("x-effect"), key.to_string()),
                (header::HeaderName::from_static("x-image-url"), result_url),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => jerr(StatusCode::BAD_GATEWAY, &format!("Gagal download gambar: {e}")),
    }
}

// Ephoto 360 Text Effects — native conversion of api/ephoto/ephoto.js
// Best-effort native: GET page effect, POST form teks, ekstrak form_value_input,
// POST /effect/create-image, download gambar. Efek butuh upload gambar ditolak.
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
    // Prioritaskan form ajax-submit / action kosong (form efek), bukan form search
    let form_re = regex::Regex::new(r#"<form[^>]*class="[^"]*ajax-submit[^"]*"[^>]*action="([^"]*)"[^>]*>|<form[^>]*action="([^"]*)"[^>]*class="[^"]*ajax-submit[^"]*"[^>]*>"#).unwrap();
    let action = form_re
        .captures(html)
        .map(|c| c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().to_string()))
        .flatten()
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


/// Daftar effect (key, url). Lengkap sesuai Node (62 efek).
const EFFECTS: &[(&str, &str)] = &[
    ("call-of-duty-warzone", "https://en.ephoto360.com/create-call-of-duty-warzone-youtube-banner-online-548.html"),
    ("porn-hub-style", "https://en.ephoto360.com/create-pornhub-style-logos-online-free-549.html"),
    ("pubg-glitch-video", "https://en.ephoto360.com/create-pubg-style-glitch-video-avatar-554.html"),
    ("free-logo-intro", "https://en.ephoto360.com/free-logo-intro-video-maker-online-558.html"),
    ("logo-gaming-assassin", "https://en.ephoto360.com/create-logo-team-logo-gaming-assassin-style-574.html"),
    ("sand-summer-beach-576", "https://en.ephoto360.com/write-in-sand-summer-beach-online-576.html"),
    ("elegant-rotation-logo", "https://en.ephoto360.com/create-elegant-rotation-logo-online-586.html"),
    ("wet-glass", "https://en.ephoto360.com/write-text-on-wet-glass-online-589.html"),
    ("multicolored-neon-591", "https://en.ephoto360.com/create-multicolored-neon-light-signatures-591.html"),
    ("luxury-gold-text-594", "https://en.ephoto360.com/create-a-luxury-gold-text-effect-online-594.html"),
    ("sand-summer-beach-595", "https://en.ephoto360.com/write-in-sand-summer-beach-online-free-595.html"),
    ("gradient-text-600", "https://en.ephoto360.com/create-3d-gradient-text-effect-online-600.html"),
    ("blackpink-logo-607", "https://en.ephoto360.com/create-blackpink-logo-online-free-607.html"),
    ("vintage-3d-light-bulb", "https://en.ephoto360.com/create-realistic-vintage-3d-light-bulb-608.html"),
    ("pubg-mascot-logo", "https://en.ephoto360.com/pubg-mascot-logo-maker-for-an-esports-team-612.html"),
    ("pubg-logo-cute", "https://en.ephoto360.com/pubg-logo-maker-cute-character-online-617.html"),
    ("clouds-in-sky", "https://en.ephoto360.com/write-text-effect-clouds-in-the-sky-online-619.html"),
    ("shimmering-aov", "https://en.ephoto360.com/create-beautiful-shimmering-aov-wallpapers-full-hd-for-mobile-643.html"),
    ("futuristic-technology", "https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html"),
    ("watercolor-text-655", "https://en.ephoto360.com/create-a-watercolor-text-effect-online-655.html"),
    ("glitter-text", "https://en.ephoto360.com/free-glitter-text-effect-maker-online-656.html"),
    ("paper-cut-3d", "https://en.ephoto360.com/multicolor-3d-paper-cut-style-text-effect-658.html"),
    ("embroidery-text", "https://en.ephoto360.com/create-a-realistic-embroidery-text-effect-online-662.html"),
    ("graffiti-wall", "https://en.ephoto360.com/create-a-graffiti-text-effect-on-the-wall-online-665.html"),
    ("cute-girl-graffiti", "https://en.ephoto360.com/cute-girl-painting-graffiti-text-effect-667.html"),
    ("cartoon-graffiti", "https://en.ephoto360.com/create-a-cartoon-style-graffiti-text-effect-online-668.html"),
    ("football-team-logo", "https://en.ephoto360.com/create-football-team-logo-online-free-671.html"),
    ("bear-logo-maker-673", "https://en.ephoto360.com/free-bear-logo-maker-online-673.html"),
    ("foggy-glass", "https://en.ephoto360.com/handwritten-text-on-foggy-glass-online-680.html"),
    ("underwater-text", "https://en.ephoto360.com/3d-underwater-text-effect-online-682.html"),
    ("cute-girl-gamer", "https://en.ephoto360.com/create-cute-girl-gamer-mascot-logo-online-687.html"),
    ("beach-text-688", "https://en.ephoto360.com/create-3d-text-effect-on-the-beach-online-688.html"),
    ("black-white-team", "https://en.ephoto360.com/create-an-online-team-logo-in-black-and-white-style-689.html"),
    ("traveling-bear", "https://en.ephoto360.com/create-funny-animations-of-a-traveling-bear-701.html"),
    ("glowing-text-706", "https://en.ephoto360.com/create-glowing-text-effects-online-706.html"),
    ("star-wars-mascot", "https://en.ephoto360.com/create-a-star-wars-character-mascot-logo-online-707.html"),
    ("blackpink-neon-710", "https://en.ephoto360.com/create-a-blackpink-neon-logo-text-effect-online-710.html"),
    ("blackpink-style-711", "https://en.ephoto360.com/online-blackpink-style-logo-maker-effect-711.html"),
    ("signature-arrow", "https://en.ephoto360.com/create-multicolored-signature-attachment-arrow-effect-714.html"),
    ("captain-america", "https://en.ephoto360.com/create-a-cinematic-captain-america-text-effect-online-715.html"),
    ("eraser-deleting", "https://en.ephoto360.com/create-eraser-deleting-text-effect-online-717.html"),
    ("american-flag-3d", "https://en.ephoto360.com/free-online-american-flag-3d-text-effect-generator-725.html"),
    ("christmas-sparkles", "https://en.ephoto360.com/create-sparkles-3d-christmas-text-effect-online-727.html"),
    ("digital-glitch", "https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html"),
    ("neon-glitch-768", "https://en.ephoto360.com/create-impressive-neon-glitch-text-effects-online-768.html"),
    ("pixel-glitch", "https://en.ephoto360.com/create-pixel-glitch-text-effect-online-769.html"),
    ("frozen-christmas", "https://en.ephoto360.com/create-a-frozen-christmas-text-effect-online-792.html"),
    ("golden-christmas", "https://en.ephoto360.com/christmas-and-new-year-glittering-3d-golden-text-effect-794.html"),
    ("thor-logo", "https://en.ephoto360.com/create-thor-logo-style-text-effects-online-for-free-796.html"),
    ("neon-light-colorful", "https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html"),
    ("colorful-paint-3d", "https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html"),
    ("glossy-silver-3d", "https://en.ephoto360.com/create-glossy-silver-3d-text-effect-online-802.html"),
    ("foil-balloon", "https://en.ephoto360.com/beautiful-3d-foil-balloon-effects-for-holidays-and-birthday-803.html"),
    ("naruto-shippuden", "https://en.ephoto360.com/naruto-shippuden-logo-style-text-effect-online-808.html"),
    ("dragon-ball", "https://en.ephoto360.com/create-dragon-ball-style-text-effects-online-809.html"),
    ("pavement-typography", "https://en.ephoto360.com/create-typography-text-effect-on-pavement-online-774.html"),
    ("born-pink-album", "https://en.ephoto360.com/create-blackpink-s-born-pink-album-logo-online-779.html"),
    ("castle-pop-out", "https://en.ephoto360.com/create-a-3d-castle-pop-out-mobile-photo-effect-786.html"),
    ("blackpink-signatures", "https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html"),
    ("typography-multi-layer", "https://en.ephoto360.com/create-online-typography-art-effects-with-multiple-layers-811.html"),
    ("comic-3d", "https://en.ephoto360.com/create-online-3d-comic-style-text-effects-817.html"),
    ("deadpool-style", "https://en.ephoto360.com/create-text-effects-in-the-style-of-the-deadpool-logo-818.html"),
];

fn list_response() -> Response {
    let effects: Vec<Value> = EFFECTS
        .iter()
        .map(|(key, url)| {
            let id = url.rsplit('-').next().unwrap_or("").trim_end_matches(".html").to_string();
            let output_type = if key.contains("video") || key.contains("glitch") || key.contains("intro") || key.contains("rotation") {
                "video"
            } else {
                "image"
            };
            json!({ "key": key, "id": id, "url": url, "type": output_type })
        })
        .collect();
    Json(json!({
        "status": true,
        "message": "Daftar effect ephoto360",
        "total": effects.len(),
        "effects": effects
    })).into_response()

}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let effect = p_str(&params, &["effect"]).unwrap_or_default();
    if effect == "list" {
        return list_response();
    }

    let text = p_str(&params, &["text"]).unwrap_or_default();
    let text2 = p_str(&params, &["text2"]).unwrap_or_default();

    let (key, url) = match EFFECTS.iter().find(|(k, _)| *k == effect.as_str()) {
        Some((k, u)) => (*k, *u),
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
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false,
                "message": format!("Gagal terhubung ke server ephoto360: {e}"),
                "code": "CONNECTION_ERROR"
            }))).into_response(),
        },
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": format!("Gagal terhubung ke server ephoto360: {e}"),
            "code": "CONNECTION_ERROR"
        }))).into_response(),
    };
    let (action_url, num_text_inputs) = parse_form(&page, url);
    if num_text_inputs == 0 {
        return jerr(StatusCode::BAD_REQUEST, "Effect ini butuh upload gambar/foto, bukan teks! Gunakan efek lain yang berbasis teks.");
    }

    // 2. Submit form teks (multipart seperti FormData(form)) — pakai multipart best-effort
    let mut form = reqwest::multipart::Form::new();
    let mut texts: Vec<&str> = vec![text.trim()];
    if !text2.is_empty() {
        texts.push(text2.trim());
    }
    for t in &texts {
        form = form.part("text[]", reqwest::multipart::Part::text(t.to_string()));
    }
    // hidden inputs dari halaman (build_server, dll)
    let hidden_re = regex::Regex::new(r#"<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)""#).unwrap();
    for cap in hidden_re.captures_iter(&page) {
        let name = cap.get(1).unwrap().as_str();
        let value = cap.get(2).unwrap().as_str().replace("&amp;", "&");
        form = form.part(name.to_string(), reqwest::multipart::Part::text(value));
    }
    // radio/select checked (pilihan template wajib ikut, seperti FormData browser)
    let radio_re = regex::Regex::new(r#"<input[^>]*type="radio"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>"#).unwrap();
    for cap in radio_re.captures_iter(&page) {
        let tag = cap.get(0).unwrap().as_str();
        let name = cap.get(1).unwrap().as_str();
        let value = cap.get(2).unwrap().as_str().replace("&amp;", "&");
        if tag.contains("checked") {
            form = form.part(name.to_string(), reqwest::multipart::Part::text(value));
        }
    }
    let select_re = regex::Regex::new(r#"<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)</select>"#).unwrap();
    let opt_re = regex::Regex::new(r#"<option[^>]*value="([^"]*)"[^>]*>"#).unwrap();
    for cap in select_re.captures_iter(&page) {
        let name = cap.get(1).unwrap().as_str();
        let inner = cap.get(2).unwrap().as_str();
        if let Some(o) = opt_re.captures(inner) {
            form = form.part(name.to_string(), reqwest::multipart::Part::text(o.get(1).unwrap().as_str().to_string()));
        }
    }
    // submit button value
    form = form.part("submit".to_string(), reqwest::multipart::Part::text("GO".to_string()));
    let submit = client.post(&action_url).multipart(form).send().await;
    let submit_html = match submit {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false,
                "message": format!("Gagal memproses gambar: {e}"),
                "code": "FORM_ERROR"
            }))).into_response(),
        },
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": format!("Gagal memproses gambar: {e}"),
            "code": "FORM_ERROR"
        }))).into_response(),
    };

    // 3. form_value_input
    let fv_re = regex::Regex::new(r#"name="form_value_input" value="([^"]+)""#).unwrap();
    let form_value = match fv_re.captures(&submit_html).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": "Gagal memproses gambar. Mungkin effect membutuhkan upload gambar atau sedang tidak tersedia.",
            "code": "FORM_ERROR"
        }))).into_response(),
    };
    let decoded = form_value
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#92;", "\\\\")
        .replace("\\\\/", "/");
    let parsed: Value = match serde_json::from_str(&decoded) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": format!("Gagal parse form_value_input: {e}"),
            "code": "FORM_ERROR"
        }))).into_response(),
    };

    // 4. POST /effect/create-image
    let origin = url::Url::parse(url).map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or_default())).unwrap_or_default();
    let create_res = client
        .post(format!("{origin}/effect/create-image"))
                    .header("x-requested-with", "XMLHttpRequest")
                    .header("content-type", "application/x-www-form-urlencoded")
        .header("referer", url)
        .body({
            // urlencoded body dari parsed JSON
            let mut parts: Vec<String> = Vec::new();
            if let Value::Object(o) = &parsed {
                for (k, v) in o {
                    let val = match v {
                        Value::String(s) => s.clone(),
                        other => serde_json::to_string(other).unwrap_or_default(),
                    };
                    parts.push(format!("{}={}", urlencoding::encode(k), urlencoding::encode(&val)));
                }
            }
            parts.join("&")
        })
        .send()
        .await;
    let create_json: Value = match create_res {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
                "status": false,
                "message": format!("Create image failed: {e}"),
                "code": "FORM_ERROR"
            }))).into_response(),
        },
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": format!("Create image failed: {e}"),
            "code": "FORM_ERROR"
        }))).into_response(),
    };
    if !create_json.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        let msg = create_json.get("message").and_then(|m| m.as_str()).unwrap_or("Create image failed");
        return (StatusCode::BAD_GATEWAY, Json(json!({
            "status": false,
            "message": format!("Create image failed: {msg}"),
            "code": "FORM_ERROR"
        }))).into_response();
    }

    // 5. URL gambar & download
    let image_url = create_json
        .get("fullsize_image")
        .or_else(|| create_json.get("image"))
        .and_then(|v| v.as_str())
        .map(|s| if s.starts_with("http") { s.to_string() } else { format!("{origin}{s}") })
        .unwrap_or_default();
    if image_url.is_empty() {
        return jerr(StatusCode::BAD_GATEWAY, "Create image failed: no image URL");
    }
    let img = match client.get(&image_url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Download gambar gagal: {e}")),
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
                (header::HeaderName::from_static("x-image-url"), image_url),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => jerr(StatusCode::BAD_GATEWAY, &format!("Download gambar gagal: {e}")),
    }
}

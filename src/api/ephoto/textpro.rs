// TextPro Effects Generator — native conversion of api/ephoto/textpro.js
// textpro.me: efek dilayani via jQuery AJAX submit di browser (dilindungi Cloudflare).
// Versi native best-effort: GET halaman effect, POST form ke action, cari URL hasil.
// Pollinations AI Image — native conversion of api/imageai/pollinations.js
// Pure HTTP: GET image.pollinations.ai/prompt/<prompt> and stream the image bytes back.
use axum::{
    body::Body,
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

const EFFECTS: &[(&str, &str, i32)] = &[
    // (key, url, params) — subset ringkas dari 81 efek Node
    ("3d-blood", "https://textpro.me/3d-blood-text-effect-online-1073.html", 2),
    ("3d-blue", "https://textpro.me/3d-blue-text-effect-online-1093.html", 1),
    ("3d-box", "https://textpro.me/3d-box-text-effect-online-880.html", 1),
    ("3d-christmas", "https://textpro.me/3d-christmas-text-effect-by-name-1055.html", 1),
    ("3d-chrome", "https://textpro.me/3d-chrome-text-effect-online-1085.html", 1),
    ("3d-deep-sea", "https://textpro.me/3d-deep-sea-text-effect-online-1020.html", 1),
    ("3d-diamond", "https://textpro.me/3d-diamond-text-effect-online-1078.html", 2),
    ("3d-emerald", "https://textpro.me/3d-emerald-text-effect-online-1079.html", 2),
    ("3d-fire", "https://textpro.me/3d-fire-text-effect-online-1072.html", 2),
    ("3d-glass", "https://textpro.me/3d-glass-text-effect-online-1069.html", 2),
    ("3d-glossy", "https://textpro.me/3d-glossy-text-effect-online-1086.html", 1),
    ("3d-glowing", "https://textpro.me/3d-glowing-text-effect-online-1029.html", 1),
    ("3d-gold", "https://textpro.me/3d-gold-text-effect-online-1076.html", 2),
    ("3d-ice", "https://textpro.me/3d-ice-text-effect-online-1074.html", 2),
    ("3d-light", "https://textpro.me/3d-light-text-effect-online-1066.html", 2),
    ("3d-luxury-gold", "https://textpro.me/3d-luxury-gold-text-effect-online-1003.html", 1),
    ("3d-metal", "https://textpro.me/3d-metal-text-effect-online-1061.html", 2),
    ("3d-pool", "https://textpro.me/3d-pool-text-effect-online-1071.html", 2),
    ("3d-purple", "https://textpro.me/3d-purple-text-effect-online-1091.html", 1),
    ("3d-rainbow", "https://textpro.me/3d-rainbow-text-effect-online-1087.html", 1),
    ("3d-red", "https://textpro.me/3d-red-text-effect-online-1094.html", 1),
    ("3d-ruby", "https://textpro.me/3d-ruby-text-effect-online-1080.html", 2),
    ("3d-sapphire", "https://textpro.me/3d-sapphire-text-effect-online-1081.html", 2),
    ("3d-shadow", "https://textpro.me/3d-shadow-text-effect-online-1063.html", 2),
    ("3d-silver", "https://textpro.me/3d-silver-text-effect-online-1077.html", 2),
    ("3d-smoke", "https://textpro.me/3d-smoke-text-effect-online-1075.html", 2),
    ("3d-space", "https://textpro.me/3d-space-text-effect-online-1067.html", 2),
    ("3d-sparkle", "https://textpro.me/3d-sparkle-text-effect-online-1090.html", 1),
    ("3d-stone", "https://textpro.me/3d-stone-text-effect-online-1082.html", 2),
    ("3d-valentine", "https://textpro.me/3d-valentine-text-effect-online-1089.html", 1),
    ("3d-water", "https://textpro.me/3d-water-text-effect-online-1070.html", 2),
    ("3d-water-pipe", "https://textpro.me/3d-water-pipe-text-effect-online-1088.html", 1),
    ("3d-yellow", "https://textpro.me/3d-yellow-text-effect-online-1095.html", 1),
    ("blue-glow", "https://textpro.me/blue-glow-text-effect-online-984.html", 1),
    ("neon-light", "https://textpro.me/neon-light-text-effect-online-882.html", 1),
    ("purple-glow", "https://textpro.me/purple-glow-text-effect-online-986.html", 1),
    ("red-glow", "https://textpro.me/red-glow-text-effect-online-987.html", 1),
    ("yellow-glow", "https://textpro.me/yellow-glow-text-effect-online-988.html", 1),
    ("american-flag", "https://textpro.me/create-american-flag-text-effect-online-1040.html", 2),
    ("avengers", "https://textpro.me/create-avengers-logo-style-text-effect-online-970.html", 2),
    ("blackpink", "https://textpro.me/create-blackpink-logo-style-online-1001.html", 1),
    ("captain-america", "https://textpro.me/create-captain-america-text-effect-online-1024.html", 2),
    ("iron-man", "https://textpro.me/create-iron-man-text-effect-online-1025.html", 2),
    ("joker-logo", "https://textpro.me/create-logo-joker-online-934.html", 2),
    ("logo-wolf", "https://textpro.me/create-logo-wolf-online-936.html", 2),
    ("spiderman", "https://textpro.me/create-spiderman-logo-style-text-effect-online-939.html", 2),
    ("wanted-poster", "https://textpro.me/create-wanted-poster-text-effect-online-936.html", 2),
    ("bear-logo", "https://textpro.me/online-black-and-white-bear-mascot-logo-creation-1012.html", 1),
    ("glitch", "https://textpro.me/create-impressive-glitch-text-effects-online-1027.html", 1),
    ("green-horror", "https://textpro.me/create-green-horror-style-text-effect-online-1036.html", 1),
    ("horror", "https://textpro.me/create-horror-text-effect-online-1096.html", 1),
    ("magma", "https://textpro.me/create-a-magma-hot-text-effect-online-1030.html", 1),
    ("cloud", "https://textpro.me/cloud-text-effect-online-1043.html", 1),
    ("fire", "https://textpro.me/fire-text-effect-online-1042.html", 1),
    ("ice-cold", "https://textpro.me/ice-cold-text-effect-online-1053.html", 1),
    ("lava", "https://textpro.me/lava-text-effect-online-1052.html", 1),
    ("lightning", "https://textpro.me/lightning-text-effect-online-1049.html", 1),
    ("realistic-cloud", "https://textpro.me/realistic-cloud-text-effect-online-1038.html", 2),
    ("sand-writing", "https://textpro.me/sand-writing-text-effect-online-1051.html", 1),
    ("snow", "https://textpro.me/snow-text-effect-online-1056.html", 1),
    ("stone", "https://textpro.me/stone-text-effect-online-1057.html", 1),
    ("thunder", "https://textpro.me/online-thunder-text-effect-generator-1031.html", 1),
    ("water-drop", "https://textpro.me/water-drop-text-effect-online-1050.html", 1),
    ("wood", "https://textpro.me/wood-text-effect-online-857.html", 1),
    ("break-wall", "https://textpro.me/break-wall-text-effect-online-1047.html", 1),
    ("chrome", "https://textpro.me/chrome-text-effect-online-975.html", 1),
    ("cyber", "https://textpro.me/cyber-text-effect-online-1035.html", 1),
    ("emboss", "https://textpro.me/emboss-text-effect-online-902.html", 1),
    ("glossy", "https://textpro.me/glossy-text-effect-online-1041.html", 1),
    ("holographic", "https://textpro.me/holographic-text-effect-online-1060.html", 1),
    ("pencil-sketch", "https://textpro.me/create-a-sketch-text-effect-online-1044.html", 1),
    ("shadow", "https://textpro.me/shadow-text-effect-online-884.html", 1),
    ("sliding", "https://textpro.me/sliding-text-effect-online-903.html", 1),
    ("toxic", "https://textpro.me/toxic-text-effect-online-1054.html", 1),
    ("berry", "https://textpro.me/create-berry-text-effect-online-free-1033.html", 1),
    ("chocolate-cake", "https://textpro.me/chocolate-cake-text-effect-890.html", 1),
    ("pink-candy", "https://textpro.me/pink-candy-text-effect-online-1048.html", 1),
    ("strawberry", "https://textpro.me/strawberry-text-effect-online-889.html", 1),
    ("3d-orange-juice", "https://textpro.me/create-a-3d-orange-juice-text-effect-online-1084.html", 1),
    ("christmas-tree", "https://textpro.me/christmas-tree-text-effect-online-1058.html", 2),
    ("neon-3d", "https://textpro.me/create-3d-neon-light-text-effect-online-1028.html", 1),
];

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let effect = p_str(&params, &["effect"])
        .map(|e| e.to_lowercase().replace(' ', "-"))
        .unwrap_or_default();
    let text = p_str(&params, &["text"]).unwrap_or_default();
    let text2 = p_str(&params, &["text2"]).unwrap_or_default();

    let config = EFFECTS.iter().find(|(k, _, _)| *k == effect.as_str());
    let (effect, url, param_count) = match config {
        Some((k, u, p)) => (k.to_string(), u.to_string(), *p),
        None => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "success": false,
                "message": format!("Invalid effect \"{effect}\". Available: {} effects", EFFECTS.len())
            }))).into_response()
        }
    };

    if text.trim().is_empty() {
        return jerr(StatusCode::BAD_REQUEST, "Parameter \"text\" is required");
    }
    if text2.trim().is_empty() {
        return jerr(StatusCode::BAD_REQUEST, "Parameter \"text2\" is required");
    }
    if text.len() > 200 || text2.len() > 200 {
        return jerr(StatusCode::BAD_REQUEST, "Text too long. Maximum 200 characters");
    }

    let format = {
        let f = p_str(&params, &["format"]).unwrap_or_else(|| "png".into()).to_lowercase();
        if !["png", "jpeg", "jpg", "webp"].contains(&f.as_str()) {
            return jerr(StatusCode::BAD_REQUEST, &format!("Invalid format. Allowed: png, jpeg, jpg, webp"));
        }
        f
    };
    let download = params.get("download").map(|d| d.as_str() == Some("true") || d.as_str() == Some("1")).unwrap_or(false);

    let client = browser_client(90);

    // 1. GET halaman effect
    let page = match client.get(&url).send().await {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Cannot connect to TextPro server: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Cannot connect to TextPro server: {e}")),
    };
    let (action_url, _) = parse_form(&page, &url);

    // 2. POST form teks ke action (best-effort; Cloudflare bisa memblokir)
    let texts: Vec<&str> = if param_count == 2 {
        vec![text.trim(), text2.trim()]
    } else {
        vec![text.trim()]
    };
    let submit = client
        .post(&action_url)
                    .header("content-type", "application/x-www-form-urlencoded")
                    .header("x-requested-with", "XMLHttpRequest")
        .header("referer", &url)
        .body(text_form_fields(&texts))
        .send()
        .await;
    let submit_text = match submit {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Failed to generate image: {e}")),
        },
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Failed to generate image: {e}")),
    };

    // 3. Cari URL hasil
    let result_url = match find_result_url(&submit_text) {
        Some(u) => u,
        None => {
            return (StatusCode::BAD_GATEWAY, Json(json!({
                "success": false,
                "message": "TextPro server failed to generate the image",
                "effect": effect
            }))).into_response()
        }
    };

    // 4. Download gambar
    let img = match client.get(&result_url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::BAD_GATEWAY, &format!("Failed to download image: {e}")),
    };
    let mime = format!("image/{format}");
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.clone())
        .header("x-effect", effect.clone());
    if download {
        builder = builder.header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"textpro-{effect}.{}.\"", format),
        );
    }
    match img.bytes().await {
        Ok(bytes) => builder.body(Body::from(bytes)).unwrap_or_else(|_| jerr(StatusCode::INTERNAL_SERVER_ERROR, "body error")),
        Err(e) => jerr(StatusCode::BAD_GATEWAY, &format!("Failed to download image: {e}")),
    }
}

// NSFW Foot Image — native conversion of api/nsfw/foot.js
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

// NSFW Foot — native conversion of api/nsfw/foot.js
// Data di-embed dari assets/foot.json; GET ?json=true atau ?type=json
// mengembalikan JSON {status,total,url}, selain itu gambar/gift di-fetch & dikirim langsung.
const LIST_JSON: &str = include_str!("assets/foot.json");
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn get_list() -> Vec<String> {
    serde_json::from_str::<Vec<String>>(LIST_JSON).unwrap_or_default()
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, _body: Option<Json<Value>>) -> Response {
    let list = get_list();
    if list.is_empty() {
        return jerr(StatusCode::NOT_FOUND, "Data foot kosong atau tidak ditemukan");
    }

    use rand::Rng;
    let rand_url = list[rand::thread_rng().gen_range(0..list.len())].clone();

    if query.get("type").map(|t| t == "json").unwrap_or(false)
        || query.get("json").map(|j| j == "true").unwrap_or(false)
    {
        return Json(json!({ "status": true, "total": list.len(), "url": rand_url })).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::SERVICE_UNAVAILABLE, &format!("{e}")),
    };

    match client.get(&rand_url).send().await {
        Ok(res) if res.status().is_success() => {
            let ct = res
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("image/jpeg")
                .to_string();
            match res.bytes().await {
                Ok(bytes) if !bytes.is_empty() => (
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, ct),
                        (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0".to_string()),
                        (header::PRAGMA, "no-cache".to_string()),
                        (header::HeaderName::from_static("surrogate-control"), "no-store".to_string()),
                        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                        (header::VARY, "*".to_string()),
                    ],
                    bytes,
                )
                    .into_response(),
                _ => Json(json!({
                    "status": true,
                    "url": rand_url,
                    "message": "Gagal memuat buffer gambar langsung, mengembalikan URL"
                }))
                .into_response(),
            }
        }
        _ => Json(json!({
            "status": true,
            "url": rand_url,
            "message": "Gagal memuat buffer gambar langsung, mengembalikan URL"
        }))
        .into_response(),
    }
}

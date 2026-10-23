// Lazada Search — native conversion of api/search/lazada.js
// AJAX tag search lazada.co.id dengan generated cookies (randomized anti-bot).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn random_hex(bytes: usize) -> String {
    (0..bytes * 2).map(|_| format!("{:x}", rand::random::<u8>() % 16)).collect()
}

fn random_base64url(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn random_base64(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(buf)
}

fn random_alphanum(len: usize) -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..len).map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char).collect()
}

fn uuid_v4() -> String {
    use rand::RngCore;
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

fn generate_cookies() -> String {
    let now = chrono::Utc::now().timestamp_millis();
    let cookies = [
        ("__wpkreporterwid_", uuid_v4()),
        ("t_fv", now.to_string()),
        ("t_uid", random_alphanum(32)),
        ("hng", "ID|id|IDR|360".into()),
        ("userLanguageML", "id".into()),
        ("lwrid", random_alphanum(28)),
        ("cna", random_alphanum(24)),
        ("lzd_sid", random_hex(16)),
        ("__itrace_wid", uuid_v4()),
        ("lzd_cid", uuid_v4()),
        ("_tb_token_", random_hex(7).chars().take(13).collect()),
        ("xlly_s", "1".into()),
        ("_m_h5_tk", format!("{}_{}", random_hex(16), now)),
        ("_m_h5_tk_enc", random_hex(16)),
        ("t_sid", random_alphanum(32)),
        ("utm_origin", "https://www.google.com/".into()),
        ("utm_channel", "SEO".into()),
        ("lwrtk", random_base64(42)),
        ("epssw", format!("12*{}.", random_base64url(172))),
        ("tfstk", format!("{}.", random_base64url(200))),
        ("__lwsc_test__", format!("{}{}", now, rand::random::<f64>().to_string().chars().skip(1).collect::<String>())),
    ];
    cookies.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("; ")
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let keyword = match get_param("keyword").as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(k) => k.to_string(),
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'keyword' wajib diisi"),
    };
    let page: u32 = get_param("page").and_then(|p| p.parse().ok()).unwrap_or(1).max(1);

    let path_keyword = urlencoding::encode(&keyword).replace("%20", "+");
    let query_keyword = urlencoding::encode(&keyword);

    let target_url = format!(
        "https://www.lazada.co.id/tag/{}/?ajax=true&catalog_redirect_tag=true&isFirstRequest=true&page={}&q={}&spm=a2o4j.homepage.searchbar.diwen",
        path_keyword, page, query_keyword
    );
    let referer_url = format!(
        "https://www.lazada.co.id/tag/{}/?q={}&spm=a2o4j.homepage.searchbar.diwen&catalog_redirect_tag=true",
        path_keyword, query_keyword
    );

    let client = match reqwest::Client::builder()
        
        .danger_accept_invalid_certs(false)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let res = client
        .get(&target_url)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 16; Infinix X6837) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.137 Mobile Safari/537.36")
        .header("sec-ch-ua-platform", "\"Android\"")
        .header("sec-ch-ua", "\"Android WebView\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"")
                    .header("sec-ch-ua-mobile", "?1")
                    .header("x-requested-with", "com.xbrowser.play")
                    .header("sec-fetch-site", "same-origin")
                    .header("sec-fetch-mode", "cors")
                    .header("sec-fetch-dest", "empty")
        .header("referer", &referer_url)
                    .header("accept-language", "en-ID,en;q=0.9,id-ID;q=0.8,id;q=0.7,en-US;q=0.6")
        .header("Cookie", generate_cookies())
        .send()
        .await;

    let res = match res {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP Error! Status: {}", r.status().as_u16())),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let result: Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let list_items = match result.pointer("/mods/listItems").and_then(Value::as_array) {
        Some(a) => a.clone(),
        None => return err(StatusCode::NOT_FOUND, "Data tidak ditemukan."),
    };

    let products: Vec<Value> = list_items
        .iter()
        .map(|item| {
            json!({
                "name": item.get("name").cloned().unwrap_or(Value::Null),
                "price": item.get("price").cloned().unwrap_or(Value::Null),
                "originalPrice": item.get("originalPrice").or_else(|| item.get("price")).cloned().unwrap_or(Value::Null),
                "discount": item.get("discount").cloned().unwrap_or(json!("0%")),
                "rating": item.get("ratingScore").cloned().unwrap_or(json!("0")),
                "location": item.get("location").cloned().unwrap_or(json!("Unknown")),
                "seller": item.get("sellerName").cloned().unwrap_or(json!("Unknown")),
                "image": item.get("image").cloned().unwrap_or(Value::Null),
                "productUrl": format!("https:{}", item.get("itemUrl").and_then(Value::as_str).unwrap_or("")),
            })
        })
        .collect();

    Json(json!({
        "status": true,
        "result": {"total_results": products.len(), "page": page, "items": products},
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

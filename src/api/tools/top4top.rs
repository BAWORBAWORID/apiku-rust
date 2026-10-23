// Top4Top — native conversion of api/tools/top4top.js (upload via URL remote)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;
use reqwest::header;

const BASE: &str = "https://top4top.io";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SUBMIT_URL: &str = "[ سحب الملفات من رابط ]";

fn extract_links(html: &str) -> (Vec<String>, Vec<String>, Vec<String>, Vec<String>) {
    let rx = regex::Regex::new(r#"https?://[a-z0-9-]+\.top4top\.io/[^"'\s<>\\]+"#).unwrap();
    let mut all: Vec<String> = Vec::new();
    for m in rx.find_iter(html) {
        let l = m.as_str().to_string();
        if !all.contains(&l) {
            all.push(l);
        }
    }
    let drx = regex::Regex::new(r"/[a-z]_[a-z0-9]+\.[a-z0-9]+$").unwrap();
    let direct: Vec<String> = all.iter().filter(|l| drx.is_match(l)).cloned().collect();
    let page: Vec<String> = all
        .iter()
        .filter(|l| l.contains("/downloadf-"))
        .cloned()
        .collect();
    let other: Vec<String> = all
        .iter()
        .filter(|l| !direct.contains(l) && !page.contains(l))
        .cloned()
        .collect();
    (all, direct, page, other)
}

fn file_name_from_url(src: &str, content_type: &str) -> String {
    let path = url::Url::parse(src)
        .map(|u| u.path().to_string())
        .unwrap_or_default();
    let mut name = path
        .split('/')
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or("file")
        .to_string();
    if !name.contains('.') && !content_type.is_empty() {
        let ext = match content_type.split(';').next().unwrap_or("").trim() {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/gif" => ".gif",
            "image/webp" => ".webp",
            "video/mp4" => ".mp4",
            "audio/mpeg" => ".mp3",
            "application/pdf" => ".pdf",
            "application/zip" => ".zip",
            "text/plain" => ".txt",
            "application/json" => ".json",
            "application/javascript" => ".js",
            "application/vnd.android.package-archive" => ".apk",
            _ => "",
        };
        if !ext.is_empty() {
            name.push_str(ext);
        }
    }
    name
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str().map(|s| s.to_string()).or_else(|| {
                    if v.is_null() {
                        None
                    } else {
                        Some(v.to_string())
                    }
                })
            })
        })
    };

    let src = match get("url") {
        Some(u) if u.starts_with("http://") || u.starts_with("https://") => u,
        Some(_) => return Json(
            json!({"success": false, "error": "Parameter 'url' wajib diisi (format http/https)"}),
        )
        .into_response(),
        None => return Json(
            json!({"success": false, "error": "Parameter 'url' wajib diisi (format http/https)"}),
        )
        .into_response(),
    };

    let client = &state.client;

    // 1. Download source file
    let file_res = match client
        .get(&src)
        .header("User-Agent", UA)
        
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(
                json!({"success": false, "error": format!("Gagal download sumber: {}", e)}),
            )
            .into_response()
        }
    };
    if !file_res.status().is_success() {
        return Json(json!({"success": false, "error": format!("Gagal download sumber: HTTP {}", file_res.status().as_u16())})).into_response();
    }
    let content_type = file_res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|c| c.to_str().ok())
        .unwrap_or("")
        .to_string();
    let buffer = match file_res.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return Json(
                json!({"success": false, "error": format!("Gagal download sumber: {}", e)}),
            )
            .into_response()
        }
    };
    if buffer.is_empty() {
        return Json(json!({"success": false, "error": "File kosong"})).into_response();
    }
    let file_name = file_name_from_url(&src, &content_type);

    // 2. Get session (sid + cookies) from homepage
    let home_res = match client
        .get(format!("{}/", BASE))
        .header("User-Agent", UA)
                    .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
        
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(
                json!({"success": false, "error": format!("Gagal membuka homepage: {}", e)}),
            )
            .into_response()
        }
    };
    let cookies: String = home_res
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|c| c.to_str().ok())
        .filter_map(|c| c.split(';').next().map(|s| s.to_string()))
        .collect::<Vec<_>>()
        .join("; ");
    let home_body = home_res.text().await.unwrap_or_default();
    let sid_re = regex::Regex::new(r#"name=["']sid["'][^>]*value=["']([^"']+)["']"#).unwrap();
    let sid = match sid_re.captures(&home_body).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => {
            return Json(json!({"success": false, "error": "Field sid tidak ketemu di homepage"}))
                .into_response()
        }
    };

    // 3. Post form (submittxt = remote URL upload)
    let form = [
        ("sid", sid.as_str()),
        ("file_1_", src.as_str()),
        ("submittxt", SUBMIT_URL),
    ];
    let post_res = match client
        .post(format!("{}/index.php", BASE))
        .header("User-Agent", UA)
        .header("Origin", BASE)
        .header("Referer", format!("{}/", BASE))
        .header("Cookie", cookies)
        .form(&form)
        
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Json(json!({"success": false, "error": format!("Gagal upload: {}", e)}))
                .into_response()
        }
    };
    if !post_res.status().is_success() {
        return Json(
            json!({"success": false, "error": format!("HTTP {}", post_res.status().as_u16())}),
        )
        .into_response();
    }
    let resp_body = post_res.text().await.unwrap_or_default();
    let (all, direct, page, other) = extract_links(&resp_body);
    if direct.is_empty() && page.is_empty() {
        return Json(json!({"success": false, "error": "Link tidak ketemu di response"}))
            .into_response();
    }

    let cdn = direct
        .first()
        .or_else(|| page.first())
        .cloned()
        .unwrap_or_default();
    Json(json!({
        "success": true,
        "source": src,
        "filename": file_name,
        "size": buffer.len(),
        "cdn": cdn,
        "direct": direct,
        "page": page,
        "other": other,
        "all": all,
    })).into_response()

}

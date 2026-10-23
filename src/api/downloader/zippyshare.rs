// Zippyshare Downloader — native conversion of api/downloader/zippyshare.js
// zippyshare.day flow: GET page → csrf-token meta + downloadId + cookies →
// POST /{id}/download/create with X-CSRF-TOKEN → download_link (+HEAD redirect).
// Classic zippyshare.com uses obfuscated math eval on the page — NOT converted
// (honest error), only zippyshare.day is native.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn is_known_domain(host: &str) -> bool {
    let h = host.to_lowercase();
    h == "zippyshare.com"
        || h == "zippyshare.day"
        || (h.starts_with("www") && h.ends_with(".zippyshare.com"))
        || (h.starts_with("www") && h.ends_with(".zippyshare.day"))
}

fn valid_url(url: &str) -> bool {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return false;
    }
    let rest = &url[url.find("://").unwrap() + 3..];
    let host = rest.split('/').next().unwrap_or("");
    is_known_domain(host)
}

fn meta_content(html: &str, name: &str) -> Option<String> {
    // <meta name="csrf-token" content="...">
    let i = html.find(name)?;
    let seg = &html[i..];
    let c = seg.find("content=\"")?;
    Some(seg[c + 9..].split('"').next().unwrap_or("").to_string())
}

fn text_between_tag(html: &str, tag_open: &str) -> String {
    html.find(tag_open).and_then(|i| {
        let rest = &html[i..];
        let gt = rest.find('>')?;
        Some(rest[gt + 1..].split('<').next().unwrap_or("").trim().to_string())
    }).unwrap_or_default()
}

async fn download_zippyshare_day(client: &reqwest::Client, clean_url: &str) -> Result<Value, String> {
    let resp = client
        .get(clean_url)
        .header("User-Agent", UA)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Gagal memuat halaman Zippyshare: HTTP {}", resp.status().as_u16()));
    }
    let cookies: String = resp
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|c| c.split(';').next())
        .filter(|c| !c.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    let html = resp.text().await.unwrap_or_default();

    let csrf = meta_content(&html, "csrf-token").filter(|s| !s.is_empty())
        .ok_or_else(|| "Tidak dapat menemukan CSRF token pada halaman.".to_string())?;
    let download_id = html.find("const downloadId").and_then(|i| {
        let seg = &html[i..];
        let q1 = seg.find('"').or_else(|| seg.find('\''))?;
        let rest = &seg[q1 + 1..];
        let q2 = rest.find('"').or_else(|| rest.find('\''))?;
        Some(rest[..q2].to_string())
    }).or_else(|| clean_url.split('/').nth(3).map(|s| s.to_string()))
    .filter(|s| !s.is_empty())
    .ok_or_else(|| "Tidak dapat menemukan download ID pada halaman.".to_string())?;

    let filename = {
        let f = text_between_tag(&html, "filebox-title");
        if !f.is_empty() {
            f
        } else if let Some(m) = meta_content(&html, "name=\"title\"") {
            let m = m.replace("Zippyshare - ", "");
            if m.is_empty() { "file".to_string() } else { m }
        } else {
            let t = text_between_tag(&html, "<title>");
            t.replace("Zippyshare — Download — ", "").replace("Zippyshare - Download - ", "")
        }
    };
    let filename = if filename.is_empty() { "file".to_string() } else { filename };

    let filesize = {
        let mut fs_ = String::new();
        let mut rest = &html[..];
        while let Some(p) = rest.find("File size") {
            // scan forward for ": " value up to closing tag
            let seg = &rest[p..];
            if let Some(colon) = seg.find(':') {
                let val = &seg[colon + 1..];
                let v = val.trim_start().split('<').next().unwrap_or("").trim().to_string();
                if !v.is_empty() {
                    fs_ = v;
                    break;
                }
            }
            rest = &seg[9..];
        }
        if fs_.is_empty() {
            // downloadBtnTxt "Download (X)"
            html.find("downloadBtnTxt").and_then(|i| {
                let seg = &html[i..];
                let open = seg.find('(')?;
                Some(seg[open + 1..].split(')').next().unwrap_or("").trim().to_string())
            }).unwrap_or_default()
        } else {
            fs_
        }
    };
    let upload_at = {
        let mut u = String::new();
        let mut rest = &html[..];
        while let Some(p) = rest.find("Uploaded at") {
            let seg = &rest[p..];
            if let Some(colon) = seg.find(':') {
                let v = seg[colon + 1..].trim_start().split('<').next().unwrap_or("").trim().to_string();
                if !v.is_empty() {
                    u = v;
                    break;
                }
            }
            rest = &seg[11..];
        }
        u
    };
    let uploader_country = html.find("uploaded from").and_then(|i| {
        let seg = &html[i..];
        let st = seg.find("<strong>")? + 8;
        Some(seg[st..].split('<').next().unwrap_or("").trim().to_string())
    });

    let create_url = format!("https://zippyshare.day/{download_id}/download/create");
    let create: Value = client
        .post(&create_url)
        .header("User-Agent", UA)
        .header("X-CSRF-TOKEN", csrf)
                    .header("X-Requested-With", "XMLHttpRequest")
        .header("Referer", clean_url)
        .header("Cookie", cookies.clone())
                    .header("Accept", "application/json, text/javascript, */*; q=0.01")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if create.get("error").and_then(|e| e.as_str()).is_some() {
        return Err(format!("Zippyshare error: {}", create.get("error").and_then(|e| e.as_str()).unwrap_or("")));
    }
    let download_url = create.get("download_link").and_then(|d| d.as_str()).unwrap_or("");
    if download_url.is_empty() {
        return Err("Download link tidak ditemukan dalam respon.".into());
    }

    // HEAD redirect check
    let direct = client
        .head(download_url)
        .header("User-Agent", UA)
        .header("Referer", clean_url)
        .header("Cookie", cookies)
        .send()
        .await
        .ok()
        .filter(|r| r.status().is_redirection())
        .and_then(|r| r.headers().get("location").and_then(|l| l.to_str().ok()).map(|s| s.to_string()));

    Ok(json!({
        "url": download_url,
        "direct_url": direct.unwrap_or_else(|| download_url.to_string()),
        "filename": filename,
        "filesize": filesize,
        "uploadDate": upload_at,
        "views": Value::Null,
        "uploaderCountry": uploader_country,
        "platform": "Zippyshare"
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        if let Some(u) = b.get("url").and_then(|u| u.as_str()) {
            merged.insert("url".into(), u.to_string());
        }
    }
    let url = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();
    if url.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false,
            "error": "Parameter \"url\" is required",
            "example": "/api/downloader/zippyshare?url=https://zippyshare.day/62pbk9GdX6q1UXY/file",
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response();
    }
    if !valid_url(&url) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false,
            "error": "Invalid Zippyshare URL. Must be a valid https://zippyshare.day/ID/file or https://[wwwN].zippyshare.com/v/ID/file.html URL",
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false, "error": e.to_string(), "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response(),
    };

    if url.contains("zippyshare.day") {
        match download_zippyshare_day(&client, &url).await {
            Ok(result) => Json(json!({
                "success": true,
                "url": result.get("url"),
                "direct_url": result.get("direct_url"),
                "filename": result.get("filename"),
                "filesize": result.get("filesize"),
                "uploadDate": result.get("uploadDate"),
                "views": result.get("views"),
                "uploaderCountry": result.get("uploaderCountry"),
                "platform": result.get("platform"),
                "timestamp": chrono::Utc::now().to_rfc3339()
            }))
            .into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, Json(json!({
                "success": false, "error": e, "timestamp": chrono::Utc::now().to_rfc3339()
            }))).into_response(),
        }
    } else {
        (StatusCode::NOT_IMPLEMENTED, Json(json!({
            "success": false,
            "error": "zippyshare.com klasik butuh evaluasi ekspresi matematika terobfuscasi di halaman — belum didukung native. Gunakan URL zippyshare.day.",
            "timestamp": chrono::Utc::now().to_rfc3339()
        }))).into_response()
    }
}

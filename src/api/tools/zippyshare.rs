// Zippyshare — native conversion of api/tools/zippyshare.js (uploader via presigned R2)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;
use reqwest::header;

const BASE_URL: &str = "https://zippyshare.day";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".into();
    }
    let k = 1024.0_f64;
    let sizes = ["B", "KB", "MB", "GB", "TB"];
    let i = (bytes as f64).ln() / k.ln();
    format!("{:.2} {}", (bytes as f64) / k.powf(i), sizes[i as usize])
}

fn guess_mime(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "txt" => "text/plain",
        "json" => "application/json",
        "js" => "application/javascript",
        "apk" => "application/vnd.android.package-archive",
        _ => "application/octet-stream",
    }
}

#[allow(clippy::too_many_arguments)]
async fn upload_to_zippyshare(
    client: &reqwest::Client,
    buffer: bytes::Bytes,
    filename: &str,
    mime_type: &str,
    password: &str,
    auto_delete: i64,
) -> Result<Value, String> {
    // 1. Get CSRF & cookies
    let home_res = client
        .get(format!("{}/", BASE_URL))
        .header("User-Agent", USER_AGENT)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        
        .send()
        .await
        .map_err(|e| format!("Gagal membuka Zippyshare: {}", e))?;
    if !home_res.status().is_success() {
        return Err(format!(
            "Gagal membuka Zippyshare: HTTP {}",
            home_res.status().as_u16()
        ));
    }
    let cookies: String = home_res
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|c| c.to_str().ok())
        .filter_map(|c| c.split(';').next().map(|s| s.to_string()))
        .collect::<Vec<_>>()
        .join("; ");
    let html = home_res.text().await.map_err(|e| e.to_string())?;
    let csrf_re =
        regex::Regex::new(r#"<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']"#).unwrap();
    let csrf = csrf_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("Gagal mengekstrak CSRF token dari Zippyshare.")?;

    // 2. Presign
    let presign_res = client
        .post(format!("{}/upload/presign", BASE_URL))
        .header("User-Agent", USER_AGENT)
        .header("X-CSRF-TOKEN", csrf.clone())
                    .header("X-Requested-With", "XMLHttpRequest")
        .header("Referer", format!("{}/", BASE_URL))
        .header("Cookie", cookies.clone())
        .json(&json!({
            "filename": filename,
            "size": buffer.len(),
            "mime": mime_type,
            "password": password,
            "upload_auto_delete": auto_delete,
            "folder_id": Value::Null,
        }))
        
        .send()
        .await
        .map_err(|e| format!("Presign Zippyshare gagal: {}", e))?;
    if !presign_res.status().is_success() {
        return Err(format!(
            "Presign Zippyshare gagal: HTTP {}",
            presign_res.status().as_u16()
        ));
    }
    let presign: Value = presign_res.json().await.map_err(|e| e.to_string())?;
    if presign.get("type").and_then(|t| t.as_str()) == Some("error")
        || presign.get("presigned_url").is_none()
    {
        return Err(presign
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Gagal mendapatkan URL presign dari Zippyshare.")
            .to_string());
    }
    let presigned_url = presign
        .get("presigned_url")
        .and_then(|p| p.as_str())
        .unwrap_or("")
        .to_string();
    let token = presign
        .get("token")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    // 3. Upload raw to R2
    let r2_res = client
        .put(&presigned_url)
        .header("Content-Type", mime_type)
        .body(buffer.clone())
        
        .send()
        .await
        .map_err(|e| format!("Upload storage R2 gagal: {}", e))?;
    if !r2_res.status().is_success() {
        return Err(format!(
            "Upload storage R2 gagal: HTTP {}",
            r2_res.status().as_u16()
        ));
    }

    // 4. Complete
    let complete_res = client
        .post(format!("{}/upload/complete", BASE_URL))
        .header("User-Agent", USER_AGENT)
        .header("X-CSRF-TOKEN", csrf)
                    .header("X-Requested-With", "XMLHttpRequest")
        .header("Referer", format!("{}/", BASE_URL))
        .header("Cookie", cookies.clone())
        .json(&json!({"token": token, "mime": mime_type}))
        
        .send()
        .await
        .map_err(|e| format!("Complete upload gagal: {}", e))?;
    if !complete_res.status().is_success() {
        return Err(format!(
            "Complete upload gagal: HTTP {}",
            complete_res.status().as_u16()
        ));
    }
    let complete: Value = complete_res.json().await.map_err(|e| e.to_string())?;
    if complete.get("type").and_then(|t| t.as_str()) != Some("success") {
        return Err(complete
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Konfirmasi upload Zippyshare gagal.")
            .to_string());
    }

    let page_url = complete
        .get("download_link")
        .and_then(|d| d.as_str())
        .unwrap_or("")
        .to_string();
    let mut download_url = page_url.clone();
    let mut cdn_url: Option<String> = None;

    // 5. Resolve direct download & CDN link
    let parts: Vec<&str> = page_url.split('/').collect();
    if parts.len() > 3 {
        let download_id = parts[3];
        if let Ok(dl_res) = client
            .post(format!("{}/{}/download/create", BASE_URL, download_id))
            .header("User-Agent", USER_AGENT)
                        .header("X-Requested-With", "XMLHttpRequest")
            .header("Referer", &page_url)
            .header("Cookie", cookies.clone())
            .json(&json!({}))
            
            .send()
            .await
        {
            if dl_res.status().is_success() {
                if let Ok(dl_data) = dl_res.json::<Value>().await {
                    if let Some(dl_link) = dl_data.get("download_link").and_then(|d| d.as_str()) {
                        download_url = dl_link.to_string();
                        if let Ok(head_res) = client
                            .head(dl_link)
                            .header("User-Agent", USER_AGENT)
                            .header("Referer", &page_url)
                            .header("Cookie", cookies)
                            
                            .send()
                            .await
                        {
                            let s = head_res.status().as_u16();
                            if (300..400).contains(&s) {
                                cdn_url = head_res
                                    .headers()
                                    .get(reqwest::header::LOCATION)
                                    .and_then(|l| l.to_str().ok())
                                    .map(|l| l.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(json!({
        "filename": filename,
        "filesize": format_bytes(buffer.len() as u64),
        "filesize_bytes": buffer.len(),
        "mimetype": mime_type,
        "download_id": complete.get("download_id"),
        "page_url": page_url,
        "download_url": download_url,
        "cdn_url": cdn_url.unwrap_or(download_url),
    }))
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

    let client = &state.client;
    let url_param = get("url");
    let buffer: bytes::Bytes;
    let filename: String;
    let mime_type: String;

    if let Some(target) = url_param.filter(|u| !u.trim().is_empty()) {
        let target = target.trim().to_string();
        let res = match client
            .get(&target)
            .header("User-Agent", USER_AGENT)
            
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Json(
                json!({"status": false, "message": format!("Gagal mengunduh file remote: {}", e)}),
            )
            .into_response(),
        };
        if !res.status().is_success() {
            return Json(json!({"status": false, "message": format!("Gagal mengunduh file remote: HTTP {}", res.status().as_u16())})).into_response();
        }
        mime_type = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|c| c.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .trim()
            .to_string();
        let path = url::Url::parse(&target)
            .map(|u| u.path().to_string())
            .unwrap_or_default();
        filename = path
            .split('/')
            .filter(|s| !s.is_empty())
            .last()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("remote_{}.bin", chrono::Utc::now().timestamp()));
        buffer = match res.bytes().await {
            Ok(b) => b,
            Err(e) => return Json(
                json!({"status": false, "message": format!("Gagal mengunduh file remote: {}", e)}),
            )
            .into_response(),
        };
    } else {
        return Json(json!({
            "status": false,
            "message": "Parameter \"url\" wajib diisi (multipart file upload belum didukung di native; gunakan remote url)",
            "example": {"json": "POST /api/tools/zippyshare dengan {\"url\": \"https://example.com/file.jpg\"}"},
        }))
        .into_response();
    }

    let mime = if mime_type.is_empty() {
        guess_mime(&filename).to_string()
    } else {
        mime_type
    };
    let password = get("password").unwrap_or_default();
    let auto_delete: i64 = get("auto_delete")
        .or_else(|| get("exp"))
        .and_then(|a| a.trim().parse().ok())
        .unwrap_or(0);

    match upload_to_zippyshare(client, buffer, &filename, &mime, &password, auto_delete).await {
        Ok(result) => {
            Json(json!({"status": true, "action": "upload", "result": result})).into_response()
        }
        Err(e) => Json(json!({"status": false, "message": e})).into_response(),
    }
}

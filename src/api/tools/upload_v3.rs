use md5::Digest;
// UploadV3 — native conversion of api/tools/upload-v3.js (multi-CDN upload with fallback)
use axum::{
    extract::{Multipart, Query},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const EXPIRY_DB: &str = "data/uploaderv3.json";
const MAX_SIZE: usize = 50 * 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fn uuid_v4() -> String {
    let b: [u8; 16] = rand::random();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] & 0x0f, b[7],
        (b[8] & 0x3f) | 0x80, b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

fn detect_mime(buffer: &[u8]) -> (&'static str, &'static str) {
    // (mime, ext)
    if buffer.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        ("image/png", "png")
    } else if buffer.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ("image/jpeg", "jpg")
    } else if buffer.starts_with(b"GIF8") {
        ("image/gif", "gif")
    } else if buffer.starts_with(b"RIFF") && buffer.len() > 11 && &buffer[8..12] == b"WEBP" {
        ("image/webp", "webp")
    } else if buffer.starts_with(b"PK") {
        ("application/zip", "zip")
    } else if buffer.starts_with(&[0x1F, 0x8B]) {
        ("application/gzip", "gz")
    } else if buffer.starts_with(b"%PDF") {
        ("application/pdf", "pdf")
    } else {
        ("application/octet-stream", "bin")
    }
}

fn calculate_expiry(exp: &str, unit: &str) -> u64 {
    let num: u64 = exp.trim().parse().unwrap_or(5);
    let multiplier: u64 = match unit.to_lowercase().as_str() {
        "jam" => 3_600_000,
        "hari" => 86_400_000,
        "minggu" => 604_800_000,
        "bulan" => 2_592_000_000,
        "tahun" => 31_536_000_000,
        _ => 60_000,
    };
    num.saturating_mul(multiplier).min(31_536_000_000)
}

fn format_expiry(ms: u64) -> String {
    let s = ms / 1000;
    let m = s / 60;
    let h = m / 60;
    let d = h / 24;
    if d > 0 {
        format!("{} hari", d)
    } else if h > 0 {
        format!("{} jam", h)
    } else if m > 0 {
        format!("{} menit", m)
    } else {
        format!("{} detik", s)
    }
}

fn read_db() -> Vec<Value> {
    std::fs::read_to_string(EXPIRY_DB)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_db(entries: Vec<Value>) {
    let _ = std::fs::create_dir_all("data");
    let _ = std::fs::write(
        EXPIRY_DB,
        serde_json::to_string_pretty(&entries).unwrap_or_default(),
    );
}

async fn upload_poners(
    client: &reqwest::Client,
    buffer: &[u8],
    filename: &str,
    mime: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(buffer.to_vec())
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("files[]", part);
    let res = client
        .post("https://pone.rs/upload")
        .header("User-Agent", UA)
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| format!("poners: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("poners HTTP {}", res.status().as_u16()));
    }
    let j: Value = res.json().await.map_err(|e| format!("poners: {}", e))?;
    j.pointer("/files/0/url")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "poners: no url in response".into())
}

async fn upload_nekohime(
    client: &reqwest::Client,
    buffer: &[u8],
    filename: &str,
    mime: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(buffer.to_vec())
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("files[]", part);
    let res = client
        .post("https://nekohime.id/upload")
        .header("User-Agent", UA)
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| format!("nekohime: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("nekohime HTTP {}", res.status().as_u16()));
    }
    let j: Value = res.json().await.map_err(|e| format!("nekohime: {}", e))?;
    j.pointer("/files/0/url")
        .or_else(|| j.pointer("/data/url"))
        .or_else(|| j.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "nekohime: no url in response".into())
}

async fn upload_phototourl(
    client: &reqwest::Client,
    buffer: &[u8],
    filename: &str,
    mime: &str,
    ext: &str,
) -> Result<String, String> {
    if !mime.starts_with("image/") {
        return Err("phototourl: only image files supported".into());
    }
    let part = reqwest::multipart::Part::bytes(buffer.to_vec())
        .file_name(format!("{}.{}", filename, ext))
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let res = client
        .post("https://phototourl.com/api/upload")
                    .header("Accept", "application/json")
                    .header("Origin", "https://phototourl.com")
                    .header("Referer", "https://phototourl.com/")
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| format!("phototourl: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("phototourl HTTP {}", res.status().as_u16()));
    }
    let j: Value = res.json().await.map_err(|e| format!("phototourl: {}", e))?;
    j.get("url")
        .or_else(|| j.pointer("/data/url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "phototourl: no url in response".into())
}

async fn upload_zasscdn(
    client: &reqwest::Client,
    buffer: &[u8],
    filename: &str,
    mime: &str,
    ext: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(buffer.to_vec())
        .file_name(format!("{}.{}", filename, ext))
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let res = client
        .post("https://cdn.zass.in/upload")
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| format!("zasscdn: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("zasscdn HTTP {}", res.status().as_u16()));
    }
    let j: Value = res.json().await.map_err(|e| format!("zasscdn: {}", e))?;
    if j.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
        if let Some(u) = j.get("url").and_then(|u| u.as_str()) {
            return Ok(u.to_string());
        }
    }
    Err("zasscdn: upload failed".into())
}

async fn upload_aceimg(
    client: &reqwest::Client,
    buffer: &[u8],
    filename: &str,
    mime: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(buffer.to_vec())
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let visitor_id = uuid_v4();
    let res = client
        .post(format!(
            "https://api.aceimg.com/api/upload?visitorId={}",
            urlencoding::encode(&visitor_id)
        ))
                    .header("Origin", "https://aceimg.com")
                    .header("Referer", "https://aceimg.com/")
        .multipart(form)
        
        .send()
        .await
        .map_err(|e| format!("aceimg: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("aceimg HTTP {}", res.status().as_u16()));
    }
    let j: Value = res.json().await.map_err(|e| format!("aceimg: {}", e))?;
    if j.get("status").is_some() {
        if let Some(link) = j.get("link").and_then(|l| l.as_str()) {
            let parsed = url::Url::parse(link).map_err(|_| "aceimg: bad link")?;
            let f = parsed
                .query_pairs()
                .find(|(k, _)| k == "f")
                .map(|(_, v)| v.to_string());
            if let Some(f) = f {
                return Ok(format!("https://cdn.aceimg.com/{}", f));
            }
            return Err("aceimg: no f param".into());
        }
    }
    Err("aceimg: upload failed".into())
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    mut multipart: Multipart,
) -> Response {
    let mut file_data: Option<(String, Vec<u8>, String)> = None;
    let mut cdn = query.get("cdn").cloned().unwrap_or_default();
    let mut exp = query.get("exp").cloned().unwrap_or_else(|| "5".into());
    let mut unit = query.get("unit").cloned().unwrap_or_else(|| "menit".into());

    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or("") {
            "cdn" => cdn = field.text().await.unwrap_or(cdn),
            "exp" => exp = field.text().await.unwrap_or(exp),
            "unit" => unit = field.text().await.unwrap_or(unit),
            "file" => {
                let original = field.file_name().unwrap_or("upload.bin").to_string();
                let mime_field = field
                    .content_type()
                    .map(|c| c.to_string())
                    .unwrap_or_default();
                let data = match field.bytes().await {
                    Ok(d) => d,
                    Err(_) => {
                        return Json(json!({"status": false, "message": "Gagal membaca file"}))
                            .into_response()
                    }
                };
                if data.len() > MAX_SIZE {
                    return Json(json!({"status": false, "message": "File too large (max 50MB)"}))
                        .into_response();
                }
                file_data = Some((original, data.to_vec(), mime_field));
            }
            _ => {}
        }
    }

    let (original_name, buffer, mime_field) = match file_data {
        Some(f) => f,
        None => {
            return Json(json!({"status": false, "message": "No file uploaded (field: 'file')"}))
                .into_response()
        }
    };

    let (mime, ext) = if !mime_field.is_empty() {
        let ext = original_name
            .rsplit('.')
            .next()
            .unwrap_or("bin")
            .to_lowercase();
        let ext = if ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            ext
        } else {
            "bin".to_string()
        };
        (mime_field, ext)
    } else {
        let (m, e) = detect_mime(&buffer);
        (m.to_string(), e.to_string())
    };
    let filename = format!(
        "{:x}.{}",
        md5::Md5::digest(
            chrono::Utc::now()
                .timestamp_nanos_opt()
                .unwrap_or(0)
                .to_le_bytes()
        ),
        ext
    );

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let cdn_lower = cdn.to_lowercase().trim().to_string();
    let targets: Vec<&str> = if !cdn_lower.is_empty() && cdn_lower != "all" {
        vec![match cdn_lower.as_str() {
            "poners" => "poners",
            "nekohime" => "nekohime",
            "phototourl" => "phototourl",
            "zasscdn" => "zasscdn",
            "aceimg" => "aceimg",
            _ => {
                return Json(json!({
                    "status": false,
                    "message": format!("CDN '{}' tidak dikenal (cloudstorage butuh engine cloud lokal; pilih: poners, nekohime, phototourl, zasscdn, aceimg, atau all)", cdn_lower)
                }))
                .into_response()
            }
        }]
    } else {
        vec!["poners", "nekohime", "phototourl", "zasscdn", "aceimg"]
    };

    let mut urls: Vec<Value> = Vec::new();
    let mut last_error: Option<String> = None;

    for t in targets {
        let result = match t {
            "poners" => upload_poners(&client, &buffer, &filename, &mime).await,
            "nekohime" => upload_nekohime(&client, &buffer, &filename, &mime).await,
            "phototourl" => upload_phototourl(&client, &buffer, &filename, &mime, &ext).await,
            "zasscdn" => upload_zasscdn(&client, &buffer, &filename, &mime, &ext).await,
            "aceimg" => upload_aceimg(&client, &buffer, &filename, &mime).await,
            _ => Err("unknown cdn".into()),
        };
        match result {
            Ok(url) => urls.push(json!({"cdn": t, "url": url})),
            Err(e) => last_error = Some(e),
        }
    }

    if urls.is_empty() {
        return Json(json!({
            "status": false,
            "message": "All CDNs failed",
            "error": last_error,
        }))
        .into_response();
    }

    let ttl = calculate_expiry(&exp, &unit);
    let expires_at = (chrono::Utc::now() + chrono::Duration::milliseconds(ttl as i64)).to_rfc3339();

    let entry = json!({
        "id": filename,
        "originalName": original_name,
        "size": buffer.len(),
        "mimetype": mime,
        "urls": urls,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "expiresAt": expires_at,
    });
    let mut db = read_db();
    db.push(entry);
    write_db(db);

    Json(json!({
        "status": true,
        "result": {
            "id": filename,
            "originalName": original_name,
            "size": buffer.len(),
            "mimetype": mime,
            "urls": urls,
            "expiry": format_expiry(ttl),
            "expiryMs": ttl,
            "expiresAt": expires_at,
        }
    })).into_response()

}

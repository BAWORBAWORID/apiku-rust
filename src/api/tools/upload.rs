use md5::Digest;
// Upload — native conversion of api/tools/upload.js (Tourl: multipart upload -> files/ + expiry)
use axum::{
    extract::Multipart,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

const UPLOAD_DIR: &str = "files";
const EXPIRY_DB: &str = "data/exp.json";
const MAX_SIZE: usize = 50 * 1024 * 1024;

fn calculate_expiry(exp: &str, unit: &str) -> u64 {
    let exp_num: u64 = exp.trim().parse().unwrap_or(5);
    let multiplier: u64 = match unit.to_lowercase().as_str() {
        "jam" => 60 * 60 * 1000,
        "hari" => 24 * 60 * 60 * 1000,
        "minggu" => 7 * 24 * 60 * 60 * 1000,
        "bulan" => 30 * 24 * 60 * 60 * 1000,
        "tahun" => 365 * 24 * 60 * 60 * 1000,
        _ => 60 * 1000,
    };
    (exp_num.saturating_mul(multiplier)).min(365 * 24 * 60 * 60 * 1000)
}

fn format_expiry(ms: u64) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;
    if days > 0 {
        return format!(
            "{} hari{} ",
            days,
            if hours % 24 > 0 {
                format!(" {} jam", hours % 24)
            } else {
                String::new()
            }
        );
    }
    if hours > 0 {
        return format!(
            "{} jam{}",
            hours,
            if minutes % 60 > 0 {
                format!(" {} menit", minutes % 60)
            } else {
                String::new()
            }
        );
    }
    if minutes > 0 {
        return format!(
            "{} menit{}",
            minutes,
            if seconds % 60 > 0 {
                format!(" {} detik", seconds % 60)
            } else {
                String::new()
            }
        );
    }
    format!("{} detik", seconds)
}

fn add_expiry_entry(entry: Value) {
    let mut list: Vec<Value> = std::fs::read_to_string(EXPIRY_DB)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    list.push(entry);
    let _ = std::fs::write(
        EXPIRY_DB,
        serde_json::to_string_pretty(&list).unwrap_or_default(),
    );
}

pub async fn handler(mut multipart: Multipart) -> Response {
    std::fs::create_dir_all(UPLOAD_DIR).ok();

    let mut file_data: Option<(String, Vec<u8>)> = None;
    let mut exp = "5".to_string();
    let mut unit = "menit".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "exp" => {
                exp = field.text().await.unwrap_or(exp);
            }
            "unit" => {
                unit = field.text().await.unwrap_or(unit);
            }
            "file" => {
                let original = field.file_name().unwrap_or("upload.bin").to_string();
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
                let ext = std::path::Path::new(&original)
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                let random_name = format!(
                    "{:x}{}",
                    md5::Md5::digest(
                        chrono::Utc::now()
                            .timestamp_nanos_opt()
                            .unwrap_or(0)
                            .to_le_bytes()
                    ),
                    ext
                );
                file_data = Some((random_name, data.to_vec()));
            }
            _ => {}
        }
    }

    let (filename, data) = match file_data {
        Some(f) => f,
        None => {
            return Json(
                json!({"status": false, "message": "Parameter 'file' (multipart) wajib diisi"}),
            )
            .into_response()
        }
    };

    let path = format!("{}/{}", UPLOAD_DIR, filename);
    if let Err(e) = std::fs::write(&path, &data) {
        return Json(json!({"status": false, "message": format!("Gagal menyimpan file: {}", e)}))
            .into_response();
    }

    let ttl_ms = calculate_expiry(&exp, &unit);
    let url = format!("/files/{}", filename);
    let entry = json!({
        "filename": filename,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "expiresAt": (chrono::Utc::now() + chrono::Duration::milliseconds(ttl_ms as i64)).to_rfc3339(),
        "originalName": filename,
        "size": data.len(),
    });
    add_expiry_entry(entry);

    Json(json!({
        "status": true,
        "result": {
            "filename": filename,
            "url": url,
            "size": data.len(),
            "expiry": format_expiry(ttl_ms),
            "expiryMs": ttl_ms,
        }
    })).into_response()

}

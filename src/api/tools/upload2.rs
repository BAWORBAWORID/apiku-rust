use md5::Digest;
// Upload2 — native conversion of api/tools/upload2.js (Tourl2: permanent upload, no expiry)
use axum::{
    extract::Multipart,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

const UPLOAD_DIR: &str = "files";
const MAX_SIZE: usize = 50 * 1024 * 1024;

pub async fn handler(mut multipart: Multipart) -> Response {
    std::fs::create_dir_all(UPLOAD_DIR).ok();

    let mut file_data: Option<(String, Vec<u8>)> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let original = field.file_name().unwrap_or("upload.bin").to_string();
            let data = match field.bytes().await {
                Ok(d) => d,
                Err(_) => {
                    return Json(json!({"status": false, "message": "Gagal membaca file"}))
                        .into_response()
                }
            };
            if data.len() > MAX_SIZE {
                return Json(json!({"status": false, "message": "File too large (max 20MB)"}))
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

    Json(json!({
        "status": true,
        "result": {
            "filename": filename,
            "url": format!("/files/{}", filename),
            "size": data.len(),
            "note": "File permanen, tidak ada auto-delete",
        }
    })).into_response()

}

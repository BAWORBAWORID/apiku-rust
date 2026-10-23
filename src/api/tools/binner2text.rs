use axum::{extract::Query, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use axum::response::Response;

#[derive(Debug, Deserialize)]
pub struct BinaryParams {
    pub binary: Option<String>,
    pub format: Option<String>,
}

pub async fn handler(
    Query(query): Query<BinaryParams>,
    body: Option<Json<BinaryParams>>,
) -> Response {
    let binary_opt = query
        .binary
        .or_else(|| body.as_ref().and_then(|b| b.binary.clone()));
    let format = query
        .format
        .or_else(|| body.as_ref().and_then(|b| b.format.clone()))
        .unwrap_or_else(|| "raw".to_string());

    let binary = match binary_opt {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'binary' wajib diisi"
            })).into_response();
        }
    };

    let clean: String = if format == "space" {
        binary.split_whitespace().collect()
    } else {
        binary.chars().filter(|c| *c == '0' || *c == '1').collect()
    };

    if clean.len() % 8 != 0 {
        return Json(json!({
            "status": false,
            "message": "Panjang binary harus kelipatan 8 bit (1 byte)"
        })).into_response();
    }

    let mut bytes = Vec::new();
    for i in (0..clean.len()).step_by(8) {
        let byte_str = &clean[i..i + 8];
        if let Ok(b) = u8::from_str_radix(byte_str, 2) {
            bytes.push(b);
        }
    }

    let text = String::from_utf8_lossy(&bytes).to_string();

    Json(json!({
        "status": true,
        "result": {
            "text": text,
            "total_bytes": bytes.len()
        },
    })).into_response()
}

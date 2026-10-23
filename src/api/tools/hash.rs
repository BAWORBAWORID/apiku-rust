use axum::{extract::Query, response::IntoResponse, Json};
use md5::{Digest, Md5};
use serde::Deserialize;
use serde_json::json;
use sha1::Sha1;
use sha2::{Sha224, Sha256, Sha384, Sha512};
use axum::response::Response;

#[derive(Debug, Deserialize)]
pub struct HashParams {
    pub text: Option<String>,
    pub algo: Option<String>,
}

pub async fn handler(
    Query(query): Query<HashParams>,
    body: Option<Json<HashParams>>,
) -> Response {
    let text_opt = query
        .text
        .or_else(|| body.as_ref().and_then(|b| b.text.clone()));
    let algo_opt = query
        .algo
        .or_else(|| body.as_ref().and_then(|b| b.algo.clone()));

    let text = match text_opt {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })).into_response();
        }
    };

    let algo = algo_opt
        .unwrap_or_default()
        .to_lowercase()
        .trim()
        .to_string();

    let supported = vec!["md5", "sha1", "sha224", "sha256", "sha384", "sha512"];

    if algo.is_empty() {
        return Json(json!({
            "status": true,
            "result": {
                "message": "Pilih salah satu algo berikut",
                "supported": supported
            },
        })).into_response();
    }

    let hash_result = match algo.as_str() {
        "md5" => {
            let mut hasher = Md5::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        }
        "sha1" => {
            let mut hasher = Sha1::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        }
        "sha224" => {
            let mut hasher = Sha224::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        }
        "sha256" => {
            let mut hasher = Sha256::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        }
        "sha384" => {
            let mut hasher = Sha384::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        }
        "sha512" => {
            let mut hasher = Sha512::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        }
        other => {
            return Json(json!({
                "status": false,
                "message": format!("Algorithm '{}' tidak didukung. Pilihan: {:?}", other, supported)
            })).into_response();
        }
    };

    Json(json!({
        "status": true,
        "result": {
            "text": text,
            "algo": algo,
            "hash": hash_result
        },
    })).into_response()
}

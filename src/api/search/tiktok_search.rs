// TikTok Search v2 (CDP Browser) — native conversion of api/search/tiktok-search.js
// Node versi memakai Chrome via CDP (browser automation + precision scoring +
// multi-datacenter enrich). Butuh browser engine, belum didukung native.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn valid_region(region: &str) -> bool {
    let valid = [
        "ID", "US", "MY", "JP", "VN", "TH", "SG", "PH", "KR", "CN", "TW", "HK",
        "GB", "UK", "CA", "AU", "NZ", "DE", "FR", "ES", "IT", "NL", "BR", "MX",
        "AR", "CL", "CO", "PE", "IN", "PK", "BD", "RU", "UA", "TR", "SA", "AE",
        "EG", "ZA", "ALL", "ANY", "*",
    ];
    valid.contains(&region.to_uppercase().as_str())
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

    let search_query = match get_param("query").filter(|q| !q.trim().is_empty()) {
        Some(q) => q,
        None => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'query' wajib diisi"}))).into_response(),
    };

    let region = get_param("region").unwrap_or_else(|| "ID".to_string());
    if !valid_region(&region) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"status": false, "message": format!("Region '{}' tidak valid. Gunakan: ID, US, MY, JP, ALL, dll", region)})),
        )
            .into_response();
    }

    (StatusCode::NOT_IMPLEMENTED, Json(json!({
        "status": false,
        "message": "butuh browser engine (CDP/Chrome automation), belum didukung native"
    })))
    .into_response()
}

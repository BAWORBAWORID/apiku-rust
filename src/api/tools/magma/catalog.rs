// MagmaCatalog — native conversion of api/tools/magma/catalog.js
use axum::{
    response::{IntoResponse, Response},
    Json,
};
use regex::Regex;
use serde_json::{json, Value};

use crate::state::AppState;

const BASE_URL: &str = "https://magma.esdm.go.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

pub async fn handler(axum::extract::State(state): axum::extract::State<AppState>) -> Response {
    let resp = state
        .client
        .get(BASE_URL)
        .header("User-Agent", UA)
                    .header("Accept", "text/html")
        .send()
        .await;

    let html = match resp {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(h) => h,
            Err(e) => return Json(json!({"status": false, "message": e.to_string(), "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
        },
        Ok(r) => {
            return Json(json!({
                "status": false,
                "message": format!("HTTP {}", r.status().as_u16()),
                "timestamp": chrono::Utc::now().timestamp_millis()
            }))
            .into_response()
        }
        Err(e) => {
            return Json(json!({"status": false, "message": e.to_string(), "timestamp": chrono::Utc::now().timestamp_millis()})).into_response()
        }
    };

    let re = Regex::new(r"var\s+markersGunungApi\s*=\s*(\[[\s\S]*?\])\s*[,;]").unwrap();
    let raw_str = match re.captures(&html).and_then(|c| c.get(1)) {
        Some(m) => m.as_str().to_string(),
        None => {
            return Json(json!({
                "status": false,
                "message": "Tidak bisa ekstrak katalog dari halaman",
                "timestamp": chrono::Utc::now().timestamp_millis()
            }))
            .into_response()
        }
    };

    let raw: Value = match serde_json::from_str(&raw_str) {
        Ok(v) => v,
        Err(_) => {
            return Json(json!({
                "status": false,
                "message": "Gagal parse JSON katalog",
                "timestamp": chrono::Utc::now().timestamp_millis()
            }))
            .into_response()
        }
    };

    let catalog: Vec<Value> = raw
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|it| it.get("ga_code").is_some())
                .map(|it| {
                    json!({
                        "code": it.get("ga_code").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        "name": it.get("ga_nama_gapi").and_then(|v| v.as_str()).unwrap_or(""),
                        "lat": it.get("ga_lat_gapi").and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64())),
                        "lon": it.get("ga_lon_gapi").and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64())),
                        "elevation": it.get("ga_elev_gapi").and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64())),
                        "province": it.get("ga_prov_gapi").cloned().unwrap_or(Value::Null),
                        "kabupaten": it.get("ga_kab_gapi").cloned().unwrap_or(Value::Null),
                        "status": it.get("ga_status").and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64())).unwrap_or(0),
                        "hasVona": it.get("has_vona").map(|v| !v.is_null() && v != &Value::Bool(false) && v != &json!(0)).unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Json(json!({
        "status": true,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "data": {
            "source": BASE_URL,
            "total": catalog.len(),
            "catalog": catalog,
        }
    })).into_response()

}

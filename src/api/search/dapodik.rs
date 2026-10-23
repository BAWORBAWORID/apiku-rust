// Dapodik Sekolah — native conversion of api/search/dapodik.js
// Ambil VITE_STRAPI_URL + VITE_API_TOKEN dari dapo.kemendikdasmen.go.id/env.js,
// lalu panggil API search/detail sekolah dengan Bearer token.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://dapo.kemendikdasmen.go.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    // Node versi pakai key "error" untuk response ini
    (status, Json(json!({"status": false, "error": msg}))).into_response()
}

async fn get_config() -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let js = client
        .get(format!("{}/env.js", BASE_URL))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let extract = |key: &str| -> Option<String> {
        let marker = format!("{}:", key);
        let pos = js.find(&marker)?;
        let rest = &js[pos + marker.len()..];
        let q1 = rest.find('"')?;
        let rest2 = &rest[q1 + 1..];
        let q2 = rest2.find('"')?;
        Some(rest2[..q2].to_string())
    };

    let api_url = extract("VITE_STRAPI_URL").unwrap_or_else(|| BASE_URL.to_string());
    let token = extract("VITE_API_TOKEN").ok_or("Gagal mengurai VITE_API_TOKEN dari env.js")?;
    Ok((api_url.trim_end_matches('/').to_string(), token))
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

    let action = get_param("action").unwrap_or_else(|| "search".to_string());
    let npsn = get_param("npsn");
    let search_query = get_param("query");

    let (api_url, token) = match get_config().await {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    if action == "detail" {
        let npsn = match npsn.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(n) => n,
            None => return err(StatusCode::BAD_REQUEST, "Parameter 'npsn' wajib diisi untuk action=detail"),
        };
        if !npsn.chars().all(|c| c.is_ascii_digit()) {
            return err(StatusCode::INTERNAL_SERVER_ERROR, "NPSN harus berupa angka.");
        }
        let res = client
            .get(format!("{}/api/detail-sekolah", api_url))
            .query(&[("npsn", npsn)])
            .header("Authorization", format!("Bearer {}", token))
                        .header("Content-Type", "application/json")
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => {
                    let result = v.get("data").cloned().unwrap_or(v);
                    Json(json!({"status": true, "result": result})).into_response()
                }
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            },
            Ok(r) => err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Server merespon dengan status HTTP {}", r.status().as_u16())),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        }
    } else {
        let q = match search_query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(q) => q,
            None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk action=search"),
        };
        if q.chars().count() < 4 {
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Kata kunci pencarian minimal harus 4 karakter.");
        }
        let res = client
            .get(format!("{}/api/detail-sekolah/search", api_url))
            .query(&[("q", q)])
            .header("Authorization", format!("Bearer {}", token))
                        .header("Content-Type", "application/json")
            .send()
            .await;
        match res {
            Ok(r) if r.status() == reqwest::StatusCode::BAD_REQUEST => {
                err(StatusCode::INTERNAL_SERVER_ERROR, "Pencarian gagal: Request tidak valid. Kata kunci pencarian minimal 4 karakter.")
            }
            Ok(r) if r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
                err(StatusCode::INTERNAL_SERVER_ERROR, "Terlalu banyak permintaan (Rate limit). Coba beberapa saat lagi.")
            }
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => {
                    let result = v.get("data").cloned().unwrap_or(v);
                    Json(json!({"status": true, "result": result})).into_response()
                }
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            },
            Ok(r) => err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Server merespon dengan status HTTP {}", r.status().as_u16())),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        }
    }
}

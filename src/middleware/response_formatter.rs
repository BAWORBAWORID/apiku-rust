use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use crate::state::AppState;
use serde_json::Value;

/// Middleware response formatter selaras dengan setupResponseFormatter di Node.js.
/// Otomatis menstandarkan urutan JSON:
/// 1. "status" selalu di paling atas
/// 2. Payload endpoint ("result", "message", dll) di tengah
/// 3. "attribution" (dari config / @zyvorapi) otomatis diinjeksi di paling bawah
/// Sehingga pengembang tidak perlu memasang attribution secara manual per endpoint.
pub async fn format_response(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let res = next.run(req).await;

    // Bypass untuk endpoint sistem tertentu atau non-API wrap
    if path == "/health"
        || path == "/stats"
        || path == "/status"
        || path == "/api/stats"
        || path == "/configuration"
        || path.starts_with("/admin/api/")
        || path == "/openapi.json"
        || path.starts_with("/v1/")
        || path.starts_with("/v3/")
    {
        return res;
    }

    // Hanya proses jika Content-Type adalah application/json
    let is_json = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("application/json"))
        .unwrap_or(false);

    if !is_json {
        return res;
    }

    let status_code = res.status();
    let (mut parts, body) = res.into_parts();

    // Baca body hingga batas wajar 25MB
    let bytes = match to_bytes(body, 25 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let Ok(json_val) = serde_json::from_slice::<Value>(&bytes) else {
        return Response::from_parts(parts, Body::from(bytes));
    };

    if let Value::Object(mut orig_map) = json_val {
        let mut formatted = serde_json::Map::new();

        // 1. "status" selalu di urutan pertama
        if let Some(status) = orig_map.remove("status") {
            formatted.insert("status".to_string(), status);
        } else {
            formatted.insert("status".to_string(), Value::Bool(status_code.is_success()));
        }

        // Ambil attribution jika endpoint memasukkannya secara manual
        let explicit_attribution = orig_map.remove("attribution");

        // 2. Masukkan semua field payload (result, message, error, dll) sesuai urutan asli
        for (k, v) in orig_map {
            formatted.insert(k, v);
        }

        // 3. "attribution" selalu di urutan paling bawah
        // Untuk status 2xx (sukses), otomatis inject attribution dari config jika belum ada
        if status_code.is_success() {
            let attr = explicit_attribution
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| {
                    state
                        .config
                        .attribution
                        .clone()
                        .unwrap_or_else(|| "@zyvorapi".to_string())
                });
            formatted.insert("attribution".to_string(), Value::String(attr));
        } else if let Some(attr) = explicit_attribution {
            formatted.insert("attribution".to_string(), attr);
        }

        let new_bytes = match serde_json::to_vec(&formatted) {
            Ok(b) => b,
            Err(_) => return Response::from_parts(parts, Body::from(bytes)),
        };

        // Perbarui Content-Length header
        parts.headers.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from(new_bytes.len()),
        );

        return Response::from_parts(parts, Body::from(new_bytes));
    }

    Response::from_parts(parts, Body::from(bytes))
}

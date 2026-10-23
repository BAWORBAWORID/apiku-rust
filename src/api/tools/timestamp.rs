use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

pub async fn handler() -> impl IntoResponse {
    let now = chrono::Utc::now();
    let unix_ms = now.timestamp_millis();
    let unix = now.timestamp();

    Json(json!({
        "status": true,
        "result": {
            "iso": now.to_rfc3339(),
            "unix": unix,
            "unix_ms": unix_ms
        }
    })).into_response()
}

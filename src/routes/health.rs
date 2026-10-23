use axum::{extract::State, response::{IntoResponse, Json}};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use crate::state::AppState;

pub async fn health_check(State(state): State<AppState>) -> Json<Value> {
    let uptime_secs = state.start_time.elapsed().as_secs();
    let total_reqs = state.total_requests.load(Ordering::Relaxed);
    let rpm_val = state.rpm.load(Ordering::Relaxed);
    let version = state.config.version.as_deref().unwrap_or("2.1.2");

    // Calculate simulated uptime percentage (99.9x%)
    let uptime_percent = format!("{:.2}", (100.0 - (0.02 * (uptime_secs as f64 / 86400.0))).clamp(99.5, 99.99));

    Json(json!({
        "status": "online",
        "latency": 1,
        "uptime": uptime_secs,
        "uptimePercent": uptime_percent,
        "version": version,
        "totalRequests": total_reqs,
        "rpm": rpm_val
    }))
}

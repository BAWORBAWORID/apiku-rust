// Sociabuzz Status Payment — native conversion of api/payment/sociabuzz-status.js
// DB data/sociabuzz.json sama seperti Node + create.
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn db_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/sociabuzz.json")
}

fn load_db() -> Vec<Value> {
    std::fs::read_to_string(db_path()).ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_db(db: &[Value]) {
    if let Some(dir) = db_path().parent() { let _ = std::fs::create_dir_all(dir); }
    let _ = std::fs::write(db_path(), serde_json::to_string_pretty(db).unwrap_or_default());
}

async fn status_payment(inv_id: &str) -> Result<Value, String> {
    let url = format!("https://sociabuzz.com/payment/pending?inv_id={}", inv_id);
    let res = reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36")
        .build().map_err(|e| e.to_string())?
        .get(&url)
                    .header("Accept", "text/html")
        .send().await.map_err(|e| e.to_string())?;
    let html = res.text().await.unwrap_or_default();
    let title = regex::Regex::new(r"<title>([^<]+)").ok()
        .and_then(|re| re.captures(&html))
        .and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
    let tl = title.to_lowercase();
    let status = if tl.contains("pending") { "pending" }
        else if tl.contains("success") { "success" }
        else if tl.contains("expired") { "expired" }
        else if tl.contains("not found") { "not_found" }
        else if tl.contains("fail") { "failed" }
        else { "unknown" };
    Ok(json!({ "status": status, "inv_id": inv_id }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut m = json!({});
    if let Some(Json(b)) = &body { if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } } }
    for (k, v) in &query { m[k] = json!(v); }
    let tid = m.get("transaction_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let Some(transaction_id) = tid else {
        return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "Parameter 'transaction_id' wajib diisi"}))).into_response();
    };
    let mut db = load_db();
    let trx = db.iter_mut().find(|t| {
        t.get("id").and_then(|v| v.as_str()) == Some(transaction_id.as_str())
            || t.pointer("/payment_info/transaction_id").and_then(|v| v.as_str()) == Some(transaction_id.as_str())
            || t.pointer("/payment_info/inv_id").and_then(|v| v.as_str()) == Some(transaction_id.as_str())
    });
    let inv_id = trx.as_ref()
        .and_then(|t| t.pointer("/payment_info/inv_id").and_then(|v| v.as_str()))
        .unwrap_or(&transaction_id).to_string();
    let status_info = match status_payment(&inv_id).await {
        Ok(s) => s,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "message": e}))).into_response(),
    };
    if let Some(t) = trx {
        t["status"] = json!(status_info["status"]);
        if status_info["status"] == "success" && t.get("paid_at").map(|v| v.is_null()).unwrap_or(true) {
            t["paid_at"] = json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        }
        save_db(&db);
    }
    Json(json!({"success": true, "result": status_info})).into_response()
}

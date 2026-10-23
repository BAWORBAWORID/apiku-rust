use axum::{
    extract::Query,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct CapcutParams {
    pub count: Option<usize>,
}

pub async fn handler(
    Query(query): Query<CapcutParams>,
    body: Option<Json<CapcutParams>>,
) -> impl IntoResponse {
    let count = query.count
        .or_else(|| body.as_ref().and_then(|b| b.count))
        .unwrap_or(1)
        .min(3);

    let mut results = Vec::new();
    for _ in 0..count {
        results.push(json!({
            "info": "Use CLI: node tes.js [count]",
            "note": "CapCut account creation requires temp mail OTP handling - see CLI version"
        }));
    }

    Json(json!({
        "status": true,
        "message": "CapCut account creation - use CLI version (node tes.js)",
        "results": results
    })).into_response()
}

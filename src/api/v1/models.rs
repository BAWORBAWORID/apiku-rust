// HF DeepSeek Models — native conversion of api/v1/models.js
use axum::{response::{IntoResponse, Response}, Json};
use serde_json::json;

const HF_MODELS: &[(&str, i64, &str)] = &[(
    "deepseek-ai/DeepSeek-V4-Flash-0731",
    1785427901,
    "deepseek-ai",
)];

pub async fn handler() -> Response {
    let data: Vec<_> = HF_MODELS
        .iter()
        .map(|(id, created, owned)| {
            json!({ "id": id, "object": "model", "created": created, "owned_by": owned })
        })
        .collect();
    Json(json!({ "object": "list", "data": data })).into_response()
}

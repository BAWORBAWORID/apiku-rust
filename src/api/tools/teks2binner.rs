use axum::{extract::Query, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use axum::response::Response;

#[derive(Debug, Deserialize)]
pub struct TextParams {
    pub text: Option<String>,
    pub format: Option<String>,
}

pub async fn handler(
    Query(query): Query<TextParams>,
    body: Option<Json<TextParams>>,
) -> Response {
    let text_opt = query
        .text
        .or_else(|| body.as_ref().and_then(|b| b.text.clone()));
    let format = query
        .format
        .or_else(|| body.as_ref().and_then(|b| b.format.clone()))
        .unwrap_or_else(|| "space".to_string());

    let text = match text_opt {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })).into_response();
        }
    };

    let binaries: Vec<String> = text.bytes().map(|b| format!("{:08b}", b)).collect();
    let result_str = if format == "raw" {
        binaries.join("")
    } else {
        binaries.join(" ")
    };

    Json(json!({
        "status": true,
        "result": {
            "binary": result_str,
            "format": format,
            "length": text.len()
        },
    })).into_response()
}

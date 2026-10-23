// Ocr — native conversion of api/tools/ocr.js
// JS memakai Tesseract.js engine (OCR); native belum didukung — response jujur.
use axum::{
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

pub async fn handler(_query_body: Json<Value>) -> Response {
    Json(json!({
        "status": false,
        "message": "butuh browser engine, belum didukung native"
    })).into_response()

}

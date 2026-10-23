// Image Upscaler V2 (picupscaler.com) — native conversion of api/imagehd/upscalev2.js
// Multipart file upload -> /api/generate/handle. Turnstile solver (browser-based)
// is not available natively; an empty token is sent (Node tolerated it too).
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

const SCALE_OPTIONS: [&str; 3] = ["2", "4", "8"];
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

async fn upscale_image(buffer: Vec<u8>, filename: &str, scale: &str) -> Result<Value, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;

    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename.to_string())
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("image", part)
        .text("user_id", "")
        .text("is_public", "true")
        .text("turnstile_token", "")
        .text("scale", scale.to_string());

    let res = cl
        .post("https://picupscaler.com/api/generate/handle")
        .header("User-Agent", UA)
        .header("sec-ch-ua", "\"Chromium\";v=\"139\", \"Not;A=Brand\";v=\"99\"")
                    .header("sec-ch-ua-mobile", "?1")
        .header("sec-ch-ua-platform", "\"Android\"")
                    .header("Accept-Language", "id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6")
                    .header("origin", "https://picupscaler.com")
                    .header("referer", "https://picupscaler.com/")
                    .header("accept", "application/json, text/plain, */*")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = res
        .json()
        .await
        .unwrap_or(Value::String(res_text_placeholder()));
    let _ = &data;
    Ok(data)
}

// reqwest json() consumes the response; helper keeps types simple for non-JSON bodies.
fn res_text_placeholder() -> String {
    String::new()
}

pub async fn handler(body: Option<Json<Value>>) -> Response {
    let params = body.unwrap_or(Json(Value::Null));

    // Node version required multipart file upload; JSON body with base64 `image`
    // is the accepted native alternative since axum multipart upload differs.
    let image_b64 = params
        .get("image")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let scale = params
        .get("scale")
        .and_then(|v| v.as_str())
        .unwrap_or("2")
        .to_string();

    if image_b64.is_empty() {
        return jerr(
            StatusCode::BAD_REQUEST,
            "Parameter 'image' wajib diisi (base64 image body JSON)",
        );
    }
    if !SCALE_OPTIONS.contains(&scale.as_str()) {
        return jerr(
            StatusCode::BAD_REQUEST,
            &format!("Invalid scale. Must be one of: {}", SCALE_OPTIONS.join(", ")),
        );
    }

    use base64::Engine;
    let buffer = match base64::engine::general_purpose::STANDARD.decode(image_b64.as_bytes()) {
        Ok(b) if !b.is_empty() => b,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'image' bukan base64 yang valid"),
    };

    // 10MB limit (like Node formidable maxFileSize)
    if buffer.len() > 10 * 1024 * 1024 {
        return jerr(StatusCode::BAD_REQUEST, "Ukuran file melebihi 10MB");
    }

    let data = match upscale_image(buffer, "image.jpg", &scale).await {
        Ok(d) => d,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("Failed to upscale image: {e}")),
    };
    if data.is_null() {
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, "No response received from upscaler service");
    }

    Json(json!({
        "status": true,
        "scale": scale,
        "result": data,
        "message": "Image successfully upscaled",
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    })).into_response()

}

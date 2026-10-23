// Image Upscaler V3 (imgupscaler.com via get1.imglarger.com) — native conversion of api/imagehd/upscalev3.js
// Multipart upload -> CheckStatusNew polling. Turnstile not needed here.
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use reqwest::header;

const BASE: &str = "https://get1.imglarger.com";
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn base_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("User-Agent", UA.parse().unwrap());
    h.insert("Accept", "application/json, text/plain, */*".parse().unwrap());
    h.insert("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7".parse().unwrap());
    h.insert("Origin", "https://imgupscaler.com".parse().unwrap());
    h.insert("Referer", "https://imgupscaler.com/".parse().unwrap());
    h
}

async fn upload_image(buffer: Vec<u8>, filename: &str) -> Result<Value, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename.to_string())
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("myfile", part)
        .text("scaleRadio", "2");

    let res = cl
        .post(format!("{BASE}/api/UpscalerNew/UploadNew"))
        .headers(base_headers())
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    if data.get("data").and_then(|d| d.get("code")).is_none() {
        return Err("Invalid response from upload service".to_string());
    }
    Ok(data)
}

async fn check_status(code: &str) -> Result<Value, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let res = cl
        .post(format!("{BASE}/api/UpscalerNew/CheckStatusNew"))
        .headers(base_headers())
                    .header("Content-Type", "application/json")
        .json(&json!({ "code": code, "scaleRadio": 2 }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.json().await.unwrap_or(Value::Null))
}

async fn wait_for_result(code: &str) -> Result<Value, String> {
    let max_attempts = 30;
    for attempt in 0..max_attempts {
        let result = check_status(code).await?;
        if result.get("code").and_then(|c| c.as_i64()) == Some(200) && result.get("data").is_some() {
            let done = ["download_url", "img_url"]
                .iter()
                .any(|k| result.pointer(&format!("/data/{k}")).map(|v| !v.is_null()).unwrap_or(false))
                || ["success", "completed"].contains(
                    &result.pointer("/data/status").and_then(|s| s.as_str()).unwrap_or(""),
                );
            if done {
                return Ok(result);
            }
        }
        if result.get("code").and_then(|c| c.as_i64()) != Some(200) && !result.is_null() {
            let code_num = result.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            if attempt == max_attempts - 1 {
                return Err(format!("Server returned error code: {code_num}"));
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    }
    Err("Timeout after 90 seconds".to_string())
}

pub async fn handler(body: Option<Json<Value>>) -> Response {
    let params = body.unwrap_or(Json(Value::Null));

    let image_b64 = params
        .get("image")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if image_b64.is_empty() {
        return jerr(
            StatusCode::BAD_REQUEST,
            "Parameter 'image' wajib diisi (base64 image body JSON)",
        );
    }

    use base64::Engine;
    let buffer = match base64::engine::general_purpose::STANDARD.decode(image_b64.as_bytes()) {
        Ok(b) if !b.is_empty() => b,
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'image' bukan base64 yang valid"),
    };
    if buffer.len() > 20 * 1024 * 1024 {
        return jerr(StatusCode::BAD_REQUEST, "Ukuran file melebihi 20MB");
    }

    let run = async {
        let upload = upload_image(buffer, "image.jpg").await?;
        let code = upload
            .pointer("/data/code")
            .map(|c| c.to_string().trim_matches('"').to_string())
            .ok_or("Failed to get upload code")?;
        let result = wait_for_result(&code).await?;
        Ok::<Value, String>(json!({
            "upload": upload,
            "result": result,
            "code": code
        }))
    };

    let combined = match run.await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result_obj = combined.get("result").cloned().unwrap_or(Value::Null);
    let download_url = ["/data/download_url", "/data/img_url"]
        .iter()
        .find_map(|p| result_obj.pointer(p).and_then(|u| u.as_str()).map(|s| s.to_string()))
        .unwrap_or(Value::Null.to_string().trim_matches('"').to_string());

    Json(json!({
        "status": true,
        "code": combined.get("code").cloned().unwrap_or(Value::Null),
        "download_url": download_url,
        "result": result_obj,
        "message": "Image successfully upscaled",
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    })).into_response()

}

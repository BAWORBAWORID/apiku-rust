// WebAbility Upscaler — native conversion of api/imagehd/webability.js
// webability.io/api/upscale-image: image as data URL -> JSON result.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_URL: &str = "https://www.webability.io/api/upscale-image";

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn merge_params(query: HashMap<String, String>, body: Option<Json<Value>>) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in query {
        m.insert(k, Value::String(v));
    }
    if let Some(Json(b)) = body {
        if let Value::Object(o) = b {
            for (k, v) in o {
                m.insert(k, v);
            }
        }
    }
    Value::Object(m)
}

fn to_data_url(buffer: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(buffer)
    )
}

async fn prepare_image(image_url: &str) -> Result<String, String> {
    if image_url.is_empty() {
        return Err("Parameter 'url' wajib diisi".to_string());
    }
    if image_url.starts_with("data:image") {
        return Ok(image_url.to_string());
    }
    if image_url.starts_with("http://") || image_url.starts_with("https://") {
        let cl = reqwest::Client::builder()
            
            .build()
            .map_err(|e| e.to_string())?;
        let res = cl.get(image_url).send().await.map_err(|e| e.to_string())?;
        let buf = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
        return Ok(to_data_url(&buf));
    }
    // treat as raw base64
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(image_url.as_bytes())
        .map_err(|_| "Format URL tidak didukung".to_string())?;
    Ok(to_data_url(&decoded))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let params = merge_params(query, body);
    let url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    let scale = params.get("scale").and_then(|v| v.as_str()).unwrap_or("2").to_string();
    let model = params.get("model").and_then(|v| v.as_str()).unwrap_or("esrgan").to_string();
    let mode = params.get("mode").and_then(|v| v.as_str()).unwrap_or("photo").to_string();

    let image_data_url = match prepare_image(&url).await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let payload = json!({
        "image": image_data_url,
        "scale": scale,
        "model": model,
        "mode": mode
    });

    let cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match cl
        .post(API_URL)
                    .header("accept", "*/*")
                    .header("accept-language", "id-ID,id;q=0.9")
                    .header("cache-control", "no-cache")
                    .header("content-type", "application/json")
                    .header("origin", "https://www.webability.io")
                    .header("pragma", "no-cache")
                    .header("referer", "https://www.webability.io/tools/ai-image-upscaler")
                    .header("user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36")
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let data: Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if data.get("success").and_then(|s| s.as_bool()) == Some(false) {
        let err = data.get("error").and_then(|e| e.as_str()).unwrap_or("Upscale gagal");
        return jerr(StatusCode::INTERNAL_SERVER_ERROR, err);
    }

    Json(json!({ "status": true, "result": data })).into_response()
}

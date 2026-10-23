use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct XmzParams {
    pub url: Option<String>,
    pub link: Option<String>,
    pub pin: Option<String>,
    pub name: Option<String>,
}

fn is_valid_url(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<XmzParams>,
    body: Option<Json<XmzParams>>,
) -> impl IntoResponse {
    let url_opt = query.url
        .or(query.link)
        .or_else(|| body.as_ref().and_then(|b| b.url.clone().or_else(|| b.link.clone())));

    let target_url = match url_opt {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "[!] Masukkan parameter 'url' atau 'link'"
            }));
        }
    };

    if !is_valid_url(&target_url) {
        return Json(json!({
            "status": false,
            "message": "[!] Masukkan format URL yang valid (http:// atau https://)"
        }));
    }

    let input_pin = query.pin.or_else(|| body.as_ref().and_then(|b| b.pin.clone()));
    let pin = match input_pin {
        Some(p) if !p.trim().is_empty() => p.trim().to_string(),
        _ => {
            let mut rng = rand::thread_rng();
            let rand_code: u32 = rng.gen_range(1000..=9999);
            rand_code.to_string()
        }
    };

    if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Json(json!({
            "status": false,
            "message": "[!] PIN harus berupa 4 digit angka (misal: 1234)"
        }));
    }

    let input_name = query.name.or_else(|| body.as_ref().and_then(|b| b.name.clone()));
    let title = input_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Protected Link".to_string());

    let payload = json!({
        "type": "generate",
        "name": title,
        "url": target_url,
        "pin": pin
    });

    let client = &state.client;
    match client.post("https://xmz-unlock.zone.id/api")
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0")
        .json(&payload)
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if data.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let token = data.get("token").and_then(|t| t.as_str()).unwrap_or("");
                    let short_url = format!("https://xmz-unlock.zone.id/{}", token);
                    return Json(json!({
                        "status": true,
                        "result": short_url,
                        "data": {
                            "name": title,
                            "original_url": target_url,
                            "short_url": short_url,
                            "pin": pin,
                            "token": token
                        }
                    }));
                }

                let err = data.get("error").and_then(|e| e.as_str()).unwrap_or("Gagal membuat shortlink dari XMZ Unlock");
                Json(json!({
                    "status": false,
                    "message": err
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca respons XMZ"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Terjadi kesalahan koneksi ke XMZ: {}", e)
        })),
    }
}

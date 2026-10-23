use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;
use axum::response::Response;

const CUTTLY_KEYS: &[&str] = &[
    "4786cc6a0f19de9c67ea6a4282c494323c932",
    "2038c1a7754b408aa8f9055282638c00e668e",
    "127b09320337c7f855427601a74eddd8261ee",
    "89d73b3a07209177d0251e30d49d66bd669ac",
    "e841147455d0fdfbf50f74aefe63b6728adc0",
    "27f3aa3f45cb4460bcbac69b782ca470a4570",
    "31a8df09d5a9d8d009790df0b5642e3d76919",
    "09b4e764ff07b10eac1682e71aaf95a78f358",
    "75fe576ce040b619176af22f5a718b2f574f5",
    "e24ee36f9c1519c0a779667a5182a31fb7ccf",
    "903869065d29e23455ddca922071f4bbeb133",
    "e40a3b5f856026b0b42555a09dff20e0",
    "de3805d3b96674a142e054749a0f43f346815",
];

#[derive(Debug, Deserialize)]
pub struct CuttlyParams {
    pub link: Option<String>,
    pub url: Option<String>,
}

fn is_valid_url(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

fn get_cuttly_status_msg(code: i64) -> &'static str {
    match code {
        1 => "Link sudah pernah diperpendek sebelumnya",
        2 => "Link yang dimasukkan bukan URL valid",
        3 => "Nama alias sudah digunakan",
        4 => "API Key tidak valid",
        5 => "Link mengandung karakter yang tidak diizinkan",
        6 => "Domain link diblokir oleh Cutt.ly",
        7 => "Berhasil",
        _ => "Unknown error code",
    }
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<CuttlyParams>,
    body: Option<Json<CuttlyParams>>,
) -> Response {
    let link_opt = query.link
        .or(query.url)
        .or_else(|| body.as_ref().and_then(|b| b.link.clone().or_else(|| b.url.clone())));

    let link = match link_opt {
        Some(l) if !l.trim().is_empty() => l.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "[!] masukan parameter link"
            })).into_response();
        }
    };

    if !is_valid_url(&link) {
        return Json(json!({
            "status": false,
            "message": "[!] masukan parameter url sahaja"
        })).into_response();
    }

    let mut keys = CUTTLY_KEYS.to_vec();
    {
        let mut rng = rand::thread_rng();
        keys.shuffle(&mut rng);
    }

    let client = &state.client;
    let mut last_error = "Gagal memperpendek link melalui Cutt.ly".to_string();

    for key in keys {
        let endpoint = format!(
            "https://cutt.ly/api/api.php?key={}&short={}",
            key,
            urlencoding::encode(&link)
        );

        match client.get(&endpoint).send().await {
            Ok(resp) => {
                if let Ok(hasil) = resp.json::<serde_json::Value>().await {
                    if let Some(url_obj) = hasil.get("url") {
                        let status_code = url_obj.get("status").and_then(|s| s.as_i64()).unwrap_or(0);
                        if status_code == 7 || status_code == 1 {
                            let short_link = url_obj.get("shortLink").and_then(|s| s.as_str()).unwrap_or("");
                            return Json(json!({
                                "status": true,
                                "result": short_link,
                                "data": {
                                    "fullLink": url_obj.get("fullLink"),
                                    "shortLink": short_link,
                                    "title": url_obj.get("title"),
                                    "date": url_obj.get("date")
                                }
                            })).into_response();
                        } else if status_code == 4 {
                            last_error = get_cuttly_status_msg(4).to_string();
                            continue;
                        } else {
                            return Json(json!({
                                "status": false,
                                "message": get_cuttly_status_msg(status_code)
                            })).into_response();
                        }
                    }
                }
            }
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        }
    }

    Json(json!({
        "status": false,
        "message": last_error
    })).into_response()
}

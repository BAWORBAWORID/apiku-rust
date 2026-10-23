use crate::state::AppState;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const API_BASE: &str = "https://bmkg-restapi.vercel.app/v1";

#[derive(Debug, Deserialize)]
pub struct WeatherParams {
    pub search: Option<String>,
    pub q: Option<String>,
    pub adm4: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<WeatherParams>,
    body: Option<Json<WeatherParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let search_query = query.search.or(query.q).or_else(|| {
        body.as_ref()
            .and_then(|b| b.search.clone().or_else(|| b.q.clone()))
    });
    let adm4_code = query
        .adm4
        .or_else(|| body.as_ref().and_then(|b| b.adm4.clone()));

    if let Some(code) = adm4_code {
        let url = format!("{}/weather/{}", API_BASE, urlencoding::encode(&code));
        match client.get(&url).send().await {
            Ok(resp) => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    return Json(json!({
                        "status": true,
                        "result": data.get("data").unwrap_or(&data),
                    }));
                }
            }
            Err(e) => {
                return Json(json!({
                    "status": false,
                    "message": format!("Gagal mengambil cuaca BMKG: {}", e)
                }));
            }
        }
    }

    if let Some(q) = search_query {
        let url = format!("{}/wilayah/search?q={}", API_BASE, urlencoding::encode(&q));
        match client.get(&url).send().await {
            Ok(resp) => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    return Json(json!({
                        "status": true,
                        "result": data.get("data").unwrap_or(&data),
                    }));
                }
            }
            Err(e) => {
                return Json(json!({
                    "status": false,
                    "message": format!("Gagal mencari wilayah BMKG: {}", e)
                }));
            }
        }
    }

    // Default: list provinces
    let url = format!("{}/wilayah/provinces", API_BASE);
    match client.get(&url).send().await {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                Json(json!({
                    "status": true,
                    "result": data.get("data").unwrap_or(&data),
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal membaca response wilayah BMKG"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Request error: {}", e)
        })),
    }
}

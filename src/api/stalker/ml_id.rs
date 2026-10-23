use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MlIdParams {
    pub user_id: Option<String>,
    pub zone_id: Option<String>,
    pub id: Option<String>,
    pub zone: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<MlIdParams>,
    body: Option<Json<MlIdParams>>,
) -> impl IntoResponse {
    let b = body.as_ref().map(|x| &x.0);

    let uid_raw = query.user_id.or(query.id).or_else(|| b.and_then(|x| x.user_id.clone().or_else(|| x.id.clone()))).unwrap_or_default();
    let zid_raw = query.zone_id.or(query.zone).or_else(|| b.and_then(|x| x.zone_id.clone().or_else(|| x.zone.clone()))).unwrap_or_default();

    let user_id: String = uid_raw.chars().filter(|c| c.is_ascii_digit()).collect();
    let zone_id: String = zid_raw.chars().filter(|c| c.is_ascii_digit()).collect();

    if user_id.len() < 4 || zone_id.len() < 3 {
        return Json(json!({
            "status": "error",
            "message": "Parameter 'user_id' & 'zone_id' harus berupa angka valid"
        }));
    }

    let payload = json!({
        "code": "MOBILE_LEGENDS",
        "data": {
            "userId": user_id,
            "zoneId": zone_id
        }
    });

    let client = &state.client;
    match client.post("https://gopay.co.id/games/v1/order/user-account")
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .json(&payload)
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                let msg = data.get("message").and_then(|m| m.as_str()).unwrap_or("");
                let user_acc = data.get("data");

                if msg == "Success" && user_acc.and_then(|d| d.get("username")).is_some() {
                    let d = user_acc.unwrap();
                    let country = d.get("countryOrigin").and_then(|c| c.as_str()).unwrap_or("ID").to_uppercase();
                    return Json(json!({
                        "status": "success",
                        "account": {
                            "user_id": user_id,
                            "zone_id": zone_id,
                            "nickname": d.get("username"),
                            "country_code": country,
                            "country_name": match country.as_str() {
                                "ID" => "Indonesia",
                                "MY" => "Malaysia",
                                "PH" => "Philippines",
                                "SG" => "Singapore",
                                "TH" => "Thailand",
                                "VN" => "Vietnam",
                                _ => country.as_str(),
                            }
                        }
                    }));
                }

                return Json(json!({
                    "status": "not_found",
                    "message": "Akun MLBB tidak ditemukan atau kombinasi ID salah"
                }));
            }

            Json(json!({
                "status": "not_found",
                "message": "Gagal membaca respons server MLBB"
            }))
        }
        Err(e) => Json(json!({
            "status": "error",
            "message": format!("Error koneksi ke server verifikasi: {}", e)
        })),
    }
}

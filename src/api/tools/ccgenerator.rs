// CcGenerator — native conversion of api/tools/ccgenerator.js (Lambdatest API)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const SITE: &str = "https://backend.lambdatest.com";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str()
                    .map(|s| s.to_string())
                    .or_else(|| v.to_string().into())
            })
        })
    };

    let raw_type =
        match get("type") {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => return Json(
                json!({"status": false, "message": "Parameter 'type' and 'amount' wajib diisi"}),
            )
            .into_response(),
        };
    let amount_raw =
        match get("amount") {
            Some(a) if !a.is_empty() => a,
            _ => return Json(
                json!({"status": false, "message": "Parameter 'type' and 'amount' wajib diisi"}),
            )
            .into_response(),
        };

    let type_map: &[(&str, &str)] = &[
        ("visa", "Visa"),
        ("american express", "American Express"),
        ("amex", "American Express"),
        ("mastercard", "MasterCard"),
        ("master", "MasterCard"),
        ("jcb", "JCB"),
    ];
    let lower = raw_type.to_lowercase();
    let normalized_type = type_map
        .iter()
        .find(|(k, _)| *k == lower)
        .map(|(_, v)| v.to_string())
        .unwrap_or(raw_type.clone());

    let allowed = ["Visa", "American Express", "MasterCard", "JCB"];
    if !allowed.contains(&normalized_type.as_str()) {
        return Json(json!({
            "status": false,
            "message": format!("Invalid type '{}'. Yang tersedia: {}", raw_type, allowed.join(", "))
        }))
        .into_response();
    }

    let parsed_amount: i64 = match amount_raw.parse() {
        Ok(n) if (1..=100).contains(&n) => n,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Invalid amount. Kudu angka antara 1 hingga 100."
            }))
            .into_response()
        }
    };

    let url = format!(
        "{}/api/dev-tools/credit-card-generator?type={}&no-of-cards={}",
        SITE,
        urlencoding::encode(&normalized_type),
        parsed_amount
    );

    let resp = state
        .client
        .get(&url)
        .header("User-Agent", UA)
                    .header("Accept", "application/json")
        .header("sec-ch-ua-platform", "\"Android\"")
        .header(
            "sec-ch-ua",
            "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
        )
                    .header("content-type", "application/json")
                    .header("dnt", "1")
                    .header("sec-ch-ua-mobile", "?1")
                    .header("origin", "https://www.lambdatest.com")
                    .header("sec-fetch-site", "same-site")
                    .header("sec-fetch-mode", "cors")
                    .header("sec-fetch-dest", "empty")
        .header(
            "referer",
            "https://www.lambdatest.com/free-online-tools/credit-card-number-generator",
        )
                    .header("accept-language", "id,en-US;q=0.9,en;q=0.8,ja;q=0.7")
                    .header("priority", "u=1, i")
        .send()
        .await;

    match resp {
        Ok(r) => match r.json::<Value>().await {
            Ok(data) => Json(json!({"status": true, "result": data})).into_response(),
            Err(_) => Json(json!({"status": false, "message": "Gagal generate credit card"}))
                .into_response(),
        },
        Err(_) => {
            Json(json!({"status": false, "message": "Gagal generate credit card"})).into_response()
        }
    }
}

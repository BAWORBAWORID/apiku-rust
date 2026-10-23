use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;
use crate::state::AppState;

const BMKG_AUTOGEMPA_URL: &str = "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json";
const BMKG_DIRASAKAN_URL: &str = "https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    let client = &state.client;

    let autogempa_fut = client.get(BMKG_AUTOGEMPA_URL).header("User-Agent", UA).send();
    let dirasakan_fut = client.get(BMKG_DIRASAKAN_URL).header("User-Agent", UA).send();

    let (auto_res, dir_res) = tokio::join!(autogempa_fut, dirasakan_fut);

    let mut autogempa = serde_json::Value::Null;
    let mut dirasakan = serde_json::Value::Null;

    if let Ok(resp) = auto_res {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            autogempa = data.get("Infogempa").and_then(|i| i.get("gempa")).cloned().unwrap_or(data);
        }
    }

    if let Ok(resp) = dir_res {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            dirasakan = data.get("Infogempa").and_then(|i| i.get("gempa")).cloned().unwrap_or(data);
        }
    }

    Json(json!({
        "status": true,
        "result": {
            "terkini": autogempa,
            "dirasakan": dirasakan
        },
    })).into_response()
}

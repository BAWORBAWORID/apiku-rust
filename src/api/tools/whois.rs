use crate::state::AppState;
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct WhoisParams {
    pub domain: Option<String>,
    pub q: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(params): Query<WhoisParams>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let raw_domain = params
        .domain
        .or(params.q)
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    if raw_domain.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'domain' wajib diisi (contoh: zyvor.my.id)."
        }));
    }

    let clean_domain = raw_domain
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(&raw_domain);

    // RDAP query (PANDI for .id domains, or ICANN rdap.org for others)
    let rdap_url = if clean_domain.ends_with(".id") {
        format!("https://rdap.pandi.id/rdap/domain/{}", clean_domain)
    } else {
        format!("https://rdap.org/domain/{}", clean_domain)
    };

    match state
        .client
        .get(&rdap_url)
                    .header("User-Agent", "Mozilla/5.0")
                    .header("Accept", "application/rdap+json, application/json")
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(data) = res.json::<Value>().await {
                Json(json!({
                    "status": true,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "result": data,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                }))
            } else {
                Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": "Gagal mengurai respons RDAP/WHOIS dari registry.",
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": format!("Koneksi ke RDAP server gagal: {}", e),
        })),
    }
}

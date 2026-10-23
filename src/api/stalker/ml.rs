use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MlParams {
    pub user_id: Option<String>,
    pub zone_id: Option<String>,
}

fn extract_table_cell(html: &str, label: &str) -> Option<String> {
    let pattern = format!(r"(?i)<th[^>]*>{label}[\s\S]*?<\/th>[\s\S]*?<td>(.*?)<\/td>");
    if let Ok(re) = Regex::new(&pattern) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                let tag_re = Regex::new(r"<[^>]+>").unwrap();
                let clean = tag_re.replace_all(m.as_str(), "");
                return Some(clean.trim().to_string());
            }
        }
    }
    None
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<MlParams>,
    body: Option<Json<MlParams>>,
) -> impl IntoResponse {
    let b = body.as_ref().map(|x| &x.0);

    let uid = query.user_id.or_else(|| b.and_then(|x| x.user_id.clone())).unwrap_or_default().trim().to_string();
    let zid = query.zone_id.or_else(|| b.and_then(|x| x.zone_id.clone())).unwrap_or_default().trim().to_string();

    if uid.is_empty() || zid.is_empty() {
        return Json(json!({
            "status": false,
            "message": "Parameter 'user_id' dan 'zone_id' wajib diisi"
        }));
    }

    let form_body = format!("user_id={}&zone_id={}", uid, zid);

    let client = &state.client;
    match client.post("https://pizzoshop.com/mlchecker/check")
                    .header("content-type", "application/x-www-form-urlencoded")
                    .header("user-agent", "Mozilla/5.0 (Linux; Android 16)")
                    .header("x-requested-with", "com.xbrowser.play")
        .body(form_body)
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(html) = res.text().await {
                let nickname = extract_table_cell(&html, "Nickname");
                let region = extract_table_cell(&html, "Region ID");
                let last_login = extract_table_cell(&html, "Last Login from");
                let created_date = extract_table_cell(&html, "Created data date")
                    .or_else(|| extract_table_cell(&html, "Created date"));
                let found = html.contains("Account found");

                return Json(json!({
                    "status": found,
                    "result": {
                        "user_id": uid,
                        "zone_id": zid,
                        "nickname": nickname,
                        "region": region,
                        "last_login_country": last_login,
                        "created_date": created_date,
                        "found": found
                    }
                }));
            }

            Json(json!({
                "status": false,
                "message": "Gagal membaca respons dari server ML checker"
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error koneksi ke ML checker: {}", e)
        })),
    }
}

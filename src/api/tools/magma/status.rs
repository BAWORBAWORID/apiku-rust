// MagmaStatus — native conversion of api/tools/magma/status.js
// Realtime volcano status via magma.esdm.go.id (csrf + signature + cookie dance)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const BASE_URL: &str = "https://magma.esdm.go.id";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

struct Session {
    csrf: Option<String>,
    signature: Option<String>,
    cookies: String,
}

async fn bootstrap(client: &reqwest::Client) -> Session {
    let mut session = Session {
        csrf: None,
        signature: None,
        cookies: String::new(),
    };
    let resp = match client
        .get(BASE_URL)
        .header("User-Agent", UA)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        )
                    .header("Accept-Language", "id-ID,id;q=0.9,en;q=0.8")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return session,
    };
    for val in resp.headers().get_all("set-cookie") {
        if let Ok(c) = val.to_str() {
            let kv = c.split(';').next().unwrap_or("").trim();
            if !session.cookies.is_empty() {
                session.cookies.push_str("; ");
            }
            session.cookies.push_str(kv);
        }
    }
    if let Ok(html) = resp.text().await {
        let csrf_re = Regex::new(r#"name="csrf-token"\s+content="([^"]+)""#).unwrap();
        let sig_re = Regex::new(r"/v1/json/var\?signature=([a-f0-9]{64})").unwrap();
        session.csrf = csrf_re
            .captures(&html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        session.signature = sig_re
            .captures(&html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
    }
    session
}

async fn post_var(
    client: &reqwest::Client,
    session: &Session,
    volcano_code: &str,
) -> Result<Value, String> {
    let url = match &session.signature {
        Some(sig) => format!("{}/v1/json/var?signature={}", BASE_URL, sig),
        None => format!("{}/v1/json/var", BASE_URL),
    };
    let res = client
        .post(&url)
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded; charset=UTF-8",
        )
        .header("X-CSRF-TOKEN", session.csrf.clone().unwrap_or_default())
                    .header("X-Requested-With", "XMLHttpRequest")
        .header("Referer", format!("{}/", BASE_URL))
        .header("Cookie", &session.cookies)
        .header("User-Agent", UA)
        .body(format!("ga_code={}", urlencoding::encode(volcano_code)))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!(
            "HTTP {} - realtime {}",
            res.status().as_u16(),
            volcano_code
        ));
    }
    res.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    };

    let volcano_code = match get("volcanoCode") {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'volcanoCode' wajib diisi",
                "timestamp": chrono::Utc::now().timestamp_millis(),
            }))
            .into_response()
        }
    };

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| state.client.clone());

    // Warm POST -> server sets session cookie; then re-bootstrap; then real POST
    let s1 = bootstrap(&client).await;
    let _ = post_var(&client, &s1, &volcano_code).await;
    let s2 = bootstrap(&client).await;
    let data = match post_var(&client, &s2, &volcano_code).await {
        Ok(d) => d,
        Err(e) => {
            return Json(json!({
                "status": false,
                "message": e,
                "timestamp": chrono::Utc::now().timestamp_millis(),
            }))
            .into_response()
        }
    };

    let gunungapi = data
        .pointer("/data/gunungapi")
        .cloned()
        .unwrap_or(Value::Null);
    if gunungapi.is_null() {
        return Json(json!({
            "status": false,
            "message": "Tidak dapat mengambil status realtime",
            "timestamp": chrono::Utc::now().timestamp_millis(),
        }))
        .into_response();
    }

    let status_num = gunungapi
        .get("status")
        .and_then(|v| {
            v.as_str()
                .and_then(|s| s.parse::<i64>().ok())
                .or_else(|| v.as_i64())
        })
        .unwrap_or(0);
    let status_label = match status_num {
        1 => "Level I (Normal)",
        2 => "Level II (Waspada)",
        3 => "Level III (Siaga)",
        4 => "Level IV (Awas)",
        _ => "Unknown",
    };

    let coordinates = gunungapi
        .get("koordinat")
        .and_then(|v| v.as_array())
        .map(|arr| {
            Value::Array(
                arr.iter()
                    .filter_map(|x| {
                        x.as_str()
                            .and_then(|s| s.parse::<f64>().ok())
                            .or_else(|| x.as_f64())
                    })
                    .map(Value::from)
                    .collect(),
            )
        })
        .unwrap_or(Value::Null);

    let seismic = data
        .pointer("/data/gempa/deskripsi")
        .map(|d| if d.is_array() { d.clone() } else { json!([d]) })
        .unwrap_or(Value::Null);

    let status = json!({
        "code": volcano_code,
        "name": gunungapi.get("nama").cloned().unwrap_or(json!(volcano_code)),
        "status": if status_num == 0 { Value::Null } else { json!(status_num) },
        "statusLabel": status_label,
        "coordinates": coordinates,
        "hasVona": gunungapi.get("has_vona").and_then(|v| v.as_str()).map(|s| s == "1").unwrap_or(false),
        "reportPeriod": data.pointer("/data/laporan/tanggal").cloned().unwrap_or(Value::Null),
        "reportAuthor": data.pointer("/data/laporan/pembuat").cloned().unwrap_or(Value::Null),
        "visual": data.pointer("/data/visual/deskripsi").cloned().unwrap_or(Value::Null),
        "visualOther": data.pointer("/data/visual/lainnya").cloned().unwrap_or(Value::Null),
        "visualPhoto": data.pointer("/data/visual/foto").cloned().unwrap_or(Value::Null),
        "climatology": data.pointer("/data/klimatologi/deskripsi").cloned().unwrap_or(Value::Null),
        "seismic": seismic,
        "seismicChart": data.pointer("/data/gempa/grafik").cloned().unwrap_or(Value::Null),
        "recommendation": data.pointer("/data/rekomendasi").cloned().unwrap_or(Value::Null),
        "vona": data.pointer("/data/vona").cloned().unwrap_or(Value::Null),
        "scrapedAt": chrono::Utc::now().to_rfc3339(),
    });

    Json(json!({
        "status": true,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "data": status,
    })).into_response()

}

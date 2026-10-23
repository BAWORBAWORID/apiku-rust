// Livescore — native conversion of api/search/livescore.js
// Ambil __NEXT_DATA__ dari goal.com/{edisi}/live-scores dan rapikan liveScores.
use axum::{extract::Query, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn status_indo(status: &str) -> Value {
    match status {
        "FIXTURE" => json!("Belum Mulai"),
        "LIVE" => json!("Berlangsung"),
        "FINISHED" | "RESULT" => json!("Selesai"),
        "POSTPONED" => json!("Ditunda"),
        "CANCELLED" => json!("Dibatalkan"),
        "HALF_TIME" => json!("Turun Minum"),
        other => json!(other),
    }
}

fn rapikan(data: &Value) -> Vec<Value> {
    data.as_array()
        .map(|groups| {
            groups
                .iter()
                .map(|grup| {
                    let matches: Vec<Value> = grup
                        .get("matches")
                        .and_then(Value::as_array)
                        .map(|ms| {
                            ms.iter()
                                .map(|m| {
                                    json!({
                                        "id": m.get("id"),
                                        "status": m.get("status").and_then(Value::as_str).map(status_indo).unwrap_or(Value::Null),
                                        "statusMentah": m.get("status"),
                                        "waktu": m.get("startDate"),
                                        "venue": m.pointer("/venue/name").cloned().unwrap_or(Value::Null),
                                        "tuanRumah": m.pointer("/teamA/name").cloned().unwrap_or(Value::Null),
                                        "tandang": m.pointer("/teamB/name").cloned().unwrap_or(Value::Null),
                                        "skorTuanRumah": m.pointer("/score/teamA").cloned().unwrap_or(Value::Null),
                                        "skorTandang": m.pointer("/score/teamB").cloned().unwrap_or(Value::Null),
                                        "kartuMerahTuanRumah": m.pointer("/redCards/teamA").cloned().unwrap_or(json!(0)),
                                        "kartuMerahTandang": m.pointer("/redCards/teamB").cloned().unwrap_or(json!(0)),
                                        "periode": m.get("period").cloned().unwrap_or(Value::Null),
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    json!({
                        "kompetisi": grup.pointer("/competition/name").cloned().unwrap_or(json!("-")),
                        "kompetisiId": grup.pointer("/competition/id").cloned().unwrap_or(Value::Null),
                        "area": grup.pointer("/competition/area/name").cloned().unwrap_or(json!("-")),
                        "pertandingan": matches,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let edisi = get_param("edisi").unwrap_or_else(|| "id".to_string());
    let raw = get_param("raw").unwrap_or_default();

    let url = if edisi == "id" {
        "https://www.goal.com/id/livescore".to_string()
    } else {
        format!("https://www.goal.com/{}/live-scores", edisi)
    };

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return Json(json!({"status": false, "message": format!("Gagal ambil livescore: {e}")})).into_response(),
    };

    let html = match client
        .get(&url)
                    .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("accept-language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
                    .header("user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return Json(json!({"status": false, "message": format!("Gagal ambil livescore: {e}")})).into_response(),
        },
        Err(e) => return Json(json!({"status": false, "message": format!("Gagal ambil livescore: {e}")})).into_response(),
    };

    let next_data = match html.find("__NEXT_DATA__") {
        Some(pos) => {
            let rest = &html[pos..];
            match rest.find('>') {
                Some(gt) => {
                    let body = &rest[gt + 1..];
                    match body.find("</script>") {
                        Some(end) => body[..end].trim().to_string(),
                        None => return Json(json!({"status": false, "message": "Gagal nemu __NEXT_DATA__, mungkin struktur halaman berubah"})).into_response(),
                    }
                }
                None => return Json(json!({"status": false, "message": "Gagal nemu __NEXT_DATA__, mungkin struktur halaman berubah"})).into_response(),
            }
        }
        None => return Json(json!({"status": false, "message": "Gagal nemu __NEXT_DATA__, mungkin struktur halaman berubah"})).into_response(),
    };

    let parsed: Value = match serde_json::from_str(&next_data) {
        Ok(v) => v,
        Err(_) => return Json(json!({"status": false, "message": "Gagal nemu __NEXT_DATA__, mungkin struktur halaman berubah"})).into_response(),
    };

    let live_scores = match parsed.pointer("/props/pageProps/content/liveScores") {
        Some(v) => v.clone(),
        None => return Json(json!({"status": false, "message": "Gagal nemu data liveScores di __NEXT_DATA__"})).into_response(),
    };

    let result = if raw == "true" { live_scores } else { Value::Array(rapikan(&live_scores)) };
    Json(json!({"status": true, "result": result})).into_response()
}

use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
pub struct WikiParams {
    pub q: Option<String>,
    pub query: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<WikiParams>,
    body: Option<Json<WikiParams>>,
) -> Json<Value> {
    let start_time = std::time::Instant::now();
    let body_params = body.map(|b| b.0).unwrap_or_default();
    let search_query = body_params.q
        .or(body_params.query)
        .or(query.q)
        .or(query.query)
        .unwrap_or_default()
        .trim()
        .to_string();


    if search_query.is_empty() {
        return Json(json!({
            "status": false,
            "time": format!("{}ms", start_time.elapsed().as_millis()),
            "error": "Parameter 'q' atau 'query' wajib diisi (contoh: Indonesia)"
        }));
    }

    let url = "https://id.wikipedia.org/w/api.php";

    match state.client.get(url)
                    .header("User-Agent", "ZyyvorAPI/2.1 (https://api.zyvor.my.id; contact: @ZyyvorAPI)")
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", &search_query),
            ("srlimit", "5"),
            ("format", "json"),
        ])
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(val) = res.json::<Value>().await {
                let items = val.pointer("/query/search").and_then(Value::as_array);
                let results: Vec<Value> = items.map(|arr| {
                    arr.iter().map(|item| {
                        let title = item.get("title").and_then(Value::as_str).unwrap_or("");
                        let snippet = item.get("snippet").and_then(Value::as_str).unwrap_or("");
                        let clean_snippet = snippet
                            .replace("<span class=\"searchmatch\">", "")
                            .replace("</span>", "");
                        let page_url = format!("https://id.wikipedia.org/wiki/{}", urlencoding::encode(title));
                        
                        json!({
                            "title": title,
                            "snippet": clean_snippet,
                            "url": page_url,
                            "wordcount": item.get("wordcount")
                        })
                    }).collect()
                }).unwrap_or_default();

                Json(json!({
                    "status": true,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "result": results,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                }))
            } else {
                Json(json!({
                    "status": false,
                    "time": format!("{}ms", start_time.elapsed().as_millis()),
                    "error": "Gagal mengurai respons pencarian dari Wikipedia.",
                }))
            }
        }
        Err(e) => {
            Json(json!({
                "status": false,
                "time": format!("{}ms", start_time.elapsed().as_millis()),
                "error": format!("Gagal terhubung ke server Wikipedia: {}", e),
            }))
        }
    }
}

// NowSecure Search — native conversion of api/search/nowsecure.js
// Live search aplikasi via nowsecure.com wp-admin admin-ajax (action=live_search).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
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

    let search_query = match get_param("query").as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => q.to_string(),
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi"),
    };
    let platform = get_param("platform").unwrap_or_else(|| "android".to_string());

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari data: {e}")),
    };

    let res = client
        .get("https://www.nowsecure.com/wp-admin/admin-ajax.php")
        .query(&[
            ("action", "live_search"),
            ("query", search_query.as_str()),
            ("platform", platform.as_str()),
        ])
                    .header("Accept", "application/json, text/javascript, */*; q=0.01")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36")
                    .header("X-Requested-With", "XMLHttpRequest")
        .send()
        .await;

    let data: Value = match res {
        Ok(r) => match r.text().await {
            Ok(t) => serde_json::from_str::<Value>(&t).unwrap_or(Value::String(t)),
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari data: {e}")),
        },
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mencari data: {e}")),
    };

    let mut results: Vec<Value> = Vec::new();
    match &data {
        Value::Array(arr) => {
            for app in arr {
                results.push(json!({
                    "title": app.get("title").cloned().unwrap_or(Value::Null),
                    "developer": app.get("developer").cloned().unwrap_or(Value::Null),
                    "link": app.get("link").cloned().unwrap_or(Value::Null),
                    "logo": app.get("logo").cloned().unwrap_or(Value::Null),
                    "hasImage": !matches!(app.get("image"), Some(Value::Bool(false))),
                }));
            }
        }
        Value::String(s) if !s.trim().is_empty() => {
            results.push(json!({
                "title": s.trim(),
                "developer": "Unknown",
                "link": "#",
                "logo": Value::Null,
                "hasImage": false,
            }));
        }
        _ => {}
    }

    if results.is_empty() {
        return err(StatusCode::NOT_FOUND, &format!("No apps found for query: {}", search_query));
    }

    let items: Vec<Value> = results
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let mut o = item.clone();
            if let Some(obj) = o.as_object_mut() {
                let mut indexed = serde_json::Map::new();
                indexed.insert("index".into(), json!(i + 1));
                for (k, v) in obj {
                    indexed.insert(k.clone(), v.clone());
                }
                o = Value::Object(indexed);
            }
            o
        })
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "query": search_query,
            "platform": platform,
            "total": items.len(),
            "items": items,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

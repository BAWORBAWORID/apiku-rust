// Play Store Search — native conversion of api/search/playstore.js
// POST batchexecute ke play.google.com, parse nested JSON line untuk daftar app.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

fn safe_get<'a>(v: &'a Value, path: &[usize]) -> Option<&'a Value> {
    let mut cur = v;
    for &i in path {
        cur = cur.get(i)?;
    }
    Some(cur)
}

fn opt_str(v: Option<&Value>) -> Value {
    v.cloned().unwrap_or(Value::Null)
}

fn extract_apps(text: &str) -> Result<Vec<Value>, String> {
    let lines: Vec<&str> = text.split('\n').collect();
    let outer_raw = lines.get(2).ok_or("unexpected batchexecute response")?;
    let outer: Value = serde_json::from_str(outer_raw.trim()).map_err(|e| e.to_string())?;
    let inner_str = safe_get(&outer, &[0, 2]).and_then(Value::as_str).ok_or("missing inner payload")?;
    let inner: Value = serde_json::from_str(inner_str).map_err(|e| e.to_string())?;
    let apps = safe_get(&inner, &[0, 1, 0, 0, 0]).and_then(Value::as_array).ok_or("missing apps array")?;

    Ok(apps
        .iter()
        .enumerate()
        .map(|(i, app)| {
            let play_url = safe_get(app, &[9, 4, 2])
                .and_then(Value::as_str)
                .map(|s| format!("https://play.google.com{}", s));
            json!({
                "no": i + 1,
                "name": opt_str(safe_get(app, &[2])),
                "developer": opt_str(safe_get(app, &[4, 0, 0, 0])),
                "description": opt_str(safe_get(app, &[4, 1, 1, 1, 1])),
                "rating": opt_str(safe_get(app, &[6, 0, 2, 1, 0])),
                "rating_value": opt_str(safe_get(app, &[6, 0, 2, 1, 1])),
                "package_id": opt_str(safe_get(app, &[12, 0])),
                "play_store_url": play_url,
                "icon_url": opt_str(safe_get(app, &[1, 1, 0, 3, 2])),
            })
        })
        .collect())
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
        None => return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'query' wajib diisi"}))).into_response(),
    };
    let limit: usize = get_param("limit").and_then(|l| l.parse().ok()).unwrap_or(10);

    // Query di-embed di dalam payload batchexecute (dua posisi: escaped + label)
    let freq = format!(
        "[[[[\"lGYRle\",\"[[[],[[10,[10,50]],true,null,[96,27,4,8,57,30,110,11,16,49,1,9,12,104,55,56,51,10,34,31,145],[null,null,[[null,null,[[[]]]],[null,[[[]]]],[null,[[[]]]],[null,[[[]]]],null,null,null,null,[[[[]]]],[[[[]]]]],[[[[7,1],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[9,1],[[1,7,9,24,12,31,5,10,15,27,8]]],[[17,1],[[1,7,9,25,13,31,5,10,27,8]]],[[10,1],[[1,7,6,9]]],[[1,1],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[4,1],[[1,3,5,4,7,6,11,19]]],[[3,1],[[1,5,14,4,10,17]]],[[2,1],[[1,5,7,18,4,13,16,12]]]]]]],[\\\\\"{}\\\\\"],4,[null,1],null,null,[]]]\",null,\"SearchQueryBuilder@{}\"]]]",
        search_query.replace('\\', "\\\\").replace('"', "\\\""),
        search_query
    );

    let form = format!("f.req={}", urlencoding::encode(&freq));

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": format!("Failed to search Play Store: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response(),
    };

    let text = match client
        .post("https://play.google.com/_/PlayStoreUi/data/batchexecute?hl=en&gl=ID")
                    .header("User-Agent", "okhttp/5.3.2")
                    .header("content-type", "application/x-www-form-urlencoded;charset=utf-8")
                    .header("origin", "https://play.google.com")
        .body(form)
        .send()
        .await
    {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": format!("Failed to search Play Store: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response(),
        },
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": format!("Failed to search Play Store: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response(),
    };

    let all_apps = match extract_apps(&text) {
        Ok(a) => a,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status": false, "message": format!("Failed to search Play Store: {e}"), "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response(),
    };
    let apps: Vec<Value> = all_apps.into_iter().take(limit).collect();

    Json(json!({
        "status": true,
        "result": {
            "query": search_query,
            "total": apps.len(),
            "source": "Google Play Store",
            "apps": apps,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

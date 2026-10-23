// Sub4Unlock — native conversion of api/tools/sub4unlock.js
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

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

    let destination_url = match get("destinationUrl") {
        Some(d) if !d.trim().is_empty() => d,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'destinationUrl' wajib diisi"
            }))
            .into_response()
        }
    };

    let fields = [
        ("link-1", get("youtubeSub1")),
        ("link-2", get("youtubeSub2")),
        ("link-3", get("youtubeLikeSub")),
        ("link-4", get("youtubeSubBell")),
        ("link-5", get("youtubeLikeComment")),
        ("link-6", get("igLike")),
        ("link-7", get("igFollow")),
        ("link-8", get("fbFollow")),
        ("link-9", get("twFollow")),
        ("link-10", get("tgJoin")),
        ("link-11", get("tgJoin2")),
        ("link-12", get("discordJoin")),
    ];

    let mut form = String::new();
    for (k, v) in fields {
        if !form.is_empty() {
            form.push('&');
        }
        form.push_str(&format!(
            "{}={}",
            k,
            urlencoding::encode(v.as_deref().unwrap_or(""))
        ));
    }
    if !form.is_empty() {
        form.push('&');
    }
    form.push_str(&format!(
        "file-link={}",
        urlencoding::encode(&destination_url)
    ));
    form.push_str("&cf_auto_token=&cf_visible_token=");

    let resp = state
        .client
        .post("https://sub4unlock.io/gendo_ajax.php")
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    .header("X-Requested-With", "XMLHttpRequest")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        )
                    .header("Origin", "https://sub4unlock.io")
                    .header("Referer", "https://sub4unlock.io/")
        .body(form)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(link) => Json(json!({"status": true, "result": link})).into_response(),
            Err(e) => Json(json!({"status": false, "message": e.to_string()})).into_response(),
        },
        Ok(r) => Json(
            json!({"status": false, "message": format!("HTTP error: {}", r.status().as_u16())}),
        )
        .into_response(),
        Err(e) => Json(json!({"status": false, "message": e.to_string()})).into_response(),
    }
}

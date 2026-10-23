use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use rand::{seq::SliceRandom, Rng};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::state::AppState;

pub async fn handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let client = &state.client;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let random_num: u32 = {
        let mut rng = rand::thread_rng();
        rng.gen_range(0..10)
    };
    let random_cursor = format!("{}-{}", random_num, now_ms);

    let url = format!(
        "https://lahelu.com/api/post/get-recommendations?field=7&cursor={}",
        random_cursor
    );

    match client.get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(res) => {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(post_infos) = data.get("postInfos").and_then(|p| p.as_array()) {
                    let mut formatted: Vec<serde_json::Value> = post_infos.iter().map(|item| {
                        let post_id = item.get("postID").and_then(|x| x.as_str()).unwrap_or("");
                        let username = item.get("userUsername").and_then(|x| x.as_str()).unwrap_or("");
                        let media = item.get("media").and_then(|x| x.as_str()).unwrap_or("");
                        let thumb = item.get("mediaThumbnail").and_then(|x| x.as_str());
                        let avatar = item.get("userAvatar").and_then(|x| x.as_str());

                        let mut obj = item.clone();
                        if let Some(map) = obj.as_object_mut() {
                            map.insert("postURL".to_string(), json!(format!("https://lahelu.com/post/{}", post_id)));
                            map.insert("media".to_string(), json!(media));
                            map.insert("mediaThumbnail".to_string(), thumb.map(|t| json!(format!("https://cache.lahelu.com/{}", t))).unwrap_or(serde_json::Value::Null));
                            map.insert("userURL".to_string(), json!(format!("https://lahelu.com/user/{}", username)));
                            map.insert("userAvatar".to_string(), avatar.map(|a| json!(format!("https://cache.lahelu.com/{}", a))).unwrap_or(serde_json::Value::Null));
                        }
                        obj
                    }).collect();

                    let selected = {
                        let mut rng = rand::thread_rng();
                        formatted.shuffle(&mut rng);
                        let count = rng.gen_range(1..=3).min(formatted.len());
                        formatted[..count].to_vec()
                    };

                    return Json(json!({
                        "status": true,
                        "data": selected,
                        "total": selected.len(),
                        "timestamp": now_ms
                    }));
                }
            }

            Json(json!({
                "status": false,
                "message": "Failed to get random Lahelu posts",
                "timestamp": now_ms
            }))
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Error requesting Lahelu: {}", e),
            "timestamp": now_ms
        })),
    }
}

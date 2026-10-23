// 7REELS Movie & TV Search — native conversion of api/search/7reels.js
// API 7reels.cc (TMDB-backed): actions search, home/featured/trending, detail, episodes.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://7reels.cc";

fn err(status: StatusCode, msg: &str, started: std::time::Instant) -> Response {
    (
        status,
        Json(json!({
            "status": false,
            "message": msg,
            "metadata": {"processing_time": format!("{}ms", started.elapsed().as_millis())},
        })).into_response(),
    )
        .into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .default_headers(reqwest::header::HeaderMap::from_iter([
            ("Accept".parse().unwrap(), "application/json".parse().unwrap()),
        ]))
        .build()
        .map_err(|e| e.to_string())
}

async fn api_get(c: &reqwest::Client, path: &str, params: &[(&str, String)]) -> Result<Value, String> {
    let mut req = c.get(format!("{}{}", BASE_URL, path));
    for (k, v) in params {
        req = req.query(&[(k, v)]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

fn val_or(v: &Value, keys: &[&str], default: Value) -> Value {
    for k in keys {
        if let Some(x) = v.get(*k) {
            if !x.is_null() {
                return x.clone();
            }
        }
    }
    default
}

fn tmdb_img(path: &Value, size: &str) -> Value {
    path.as_str()
        .filter(|s| !s.is_empty())
        .map(|s| json!(format!("https://image.tmdb.org/t/p/{}{}", size, s)))
        .unwrap_or(Value::Null)
}

async fn get_homepage(c: &reqwest::Client) -> Result<Value, String> {
    let (featured, top_reels) = tokio::join!(api_get(c, "/api/featured", &[]), api_get(c, "/api/top-reels", &[]));
    let featured = featured?;
    let top_reels = top_reels?;
    Ok(json!({
        "featured": featured.get("featured").cloned().unwrap_or(json!({})),
        "topReels": {
            "trending": top_reels.get("trending").cloned().unwrap_or(json!([])),
            "topOverall": top_reels.get("topOverall").cloned().unwrap_or(json!([])),
            "country": top_reels.get("country").cloned().unwrap_or(json!("")),
        },
    }))
}

async fn search(c: &reqwest::Client, query: &str, page: i64) -> Result<Value, String> {
    let data = api_get(c, "/api/search/smart", &[("q", query.to_string()), ("page", page.to_string())]).await?;
    let empty = json!([]);
    let results = data.get("results").unwrap_or(&empty);
    let mapped: Vec<Value> = results
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|item| {
                    let title = item.get("title").cloned().unwrap_or(json!(""));
                    let name = item.get("name").cloned().unwrap_or(json!(""));
                    json!({
                        "id": item.get("id").cloned().unwrap_or(Value::Null),
                        "title": if title.as_str().map(|s| !s.is_empty()).unwrap_or(false) { title } else { name },
                        "originalTitle": val_or(item, &["original_title", "original_name"], json!("")),
                        "mediaType": item.get("media_type").cloned().unwrap_or_else(|| json!(if item.get("title").is_some() { "movie" } else { "tv" })),
                        "overview": item.get("overview").cloned().unwrap_or(json!("")),
                        "poster": tmdb_img(item.get("poster_path").unwrap_or(&Value::Null), "w500"),
                        "backdrop": tmdb_img(item.get("backdrop_path").unwrap_or(&Value::Null), "w1280"),
                        "rating": item.get("vote_average").cloned().unwrap_or(Value::Null),
                        "releaseDate": val_or(item, &["release_date", "first_air_date"], json!("")),
                        "popularity": item.get("popularity").cloned().unwrap_or(json!(0)),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({"query": query, "page": page, "total": mapped.len(), "results": mapped}))
}

async fn get_details(c: &reqwest::Client, id: &str, typ: &str) -> Result<Value, String> {
    let clean_type = if typ == "tv" { "tv" } else { "movie" };
    let f1 = format!("/api/tmdb/{}/{}", clean_type, id);
    let f2 = format!("/api/tmdb/{}/{}/credits", clean_type, id);
    let (details, credits) = tokio::join!(
        api_get(c, &f1, &[]),
        async { api_get(c, &f2, &[]).await.unwrap_or(json!({})) }
    );
    let details = details?;
    let credits = credits;

    let seasons: Vec<Value> = details
        .get("seasons")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|s| {
                    json!({
                        "id": s.get("id").cloned().unwrap_or(Value::Null),
                        "seasonNumber": s.get("season_number").cloned().unwrap_or(Value::Null),
                        "name": s.get("name").cloned().unwrap_or(Value::Null),
                        "episodeCount": s.get("episode_count").cloned().unwrap_or(Value::Null),
                        "poster": tmdb_img(s.get("poster_path").unwrap_or(&Value::Null), "w300"),
                        "airDate": s.get("air_date").cloned().unwrap_or(json!("")),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let cast: Vec<Value> = credits
        .get("cast")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter().take(15).map(|cc| {
                json!({
                    "id": cc.get("id").cloned().unwrap_or(Value::Null),
                    "name": cc.get("name").cloned().unwrap_or(Value::Null),
                    "character": cc.get("character").cloned().unwrap_or(json!("")),
                    "profile": tmdb_img(cc.get("profile_path").unwrap_or(&Value::Null), "w185"),
                })
            }).collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "id": id,
        "type": clean_type,
        "title": val_or(&details, &["title", "name"], json!("")),
        "originalTitle": val_or(&details, &["original_title", "original_name"], json!("")),
        "overview": details.get("overview").cloned().unwrap_or(json!("")),
        "poster": tmdb_img(details.get("poster_path").unwrap_or(&Value::Null), "w500"),
        "backdrop": tmdb_img(details.get("backdrop_path").unwrap_or(&Value::Null), "w1280"),
        "rating": details.get("vote_average").cloned().unwrap_or(Value::Null),
        "releaseDate": val_or(&details, &["release_date", "first_air_date"], json!("")),
        "genres": details.get("genres").cloned().unwrap_or(json!([])),
        "runtime": details.get("runtime").cloned().or_else(|| details.pointer("/episode_run_time/0").cloned()).unwrap_or(Value::Null),
        "status": details.get("status").cloned().unwrap_or(json!("")),
        "tagline": details.get("tagline").cloned().unwrap_or(Value::Null),
        "numberOfSeasons": details.get("number_of_seasons").cloned().unwrap_or(Value::Null),
        "numberOfEpisodes": details.get("number_of_episodes").cloned().unwrap_or(Value::Null),
        "seasons": seasons,
        "cast": cast,
    }))
}

async fn get_episodes(c: &reqwest::Client, tv_id: &str, season_num: i64) -> Result<Value, String> {
    let data = api_get(c, &format!("/api/tmdb/tv/{}/season/{}", tv_id, season_num), &[]).await?;
    let empty = json!([]);
    let episodes: Vec<Value> = data
        .get("episodes")
        .unwrap_or(&empty)
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|ep| {
                    json!({
                        "id": ep.get("id").cloned().unwrap_or(Value::Null),
                        "episodeNumber": ep.get("episode_number").cloned().unwrap_or(Value::Null),
                        "name": ep.get("name").cloned().unwrap_or(json!("")),
                        "overview": ep.get("overview").cloned().unwrap_or(json!("")),
                        "airDate": ep.get("air_date").cloned().unwrap_or(json!("")),
                        "rating": ep.get("vote_average").cloned().unwrap_or(Value::Null),
                        "stillPath": tmdb_img(ep.get("still_path").unwrap_or(&Value::Null), "w300"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({"tvId": tv_id, "seasonNumber": season_num, "episodes": episodes}))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if !v.is_empty() {
                    return Some(v.clone());
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(s) = v.get(*k).and_then(Value::as_str) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        None
    };

    let keyword = get_param(&["query", "q"]).map(|v| v.trim().to_string()).unwrap_or_default();
    let selected_action = get_param(&["action"]).map(|v| v.trim().to_lowercase()).unwrap_or_default();
    let id = get_param(&["id"]);
    let typ = get_param(&["type"]).unwrap_or_else(|| "movie".to_string());
    let season: i64 = get_param(&["season"]).and_then(|s| s.parse().ok()).unwrap_or(1);
    let page: i64 = get_param(&["page"]).and_then(|p| p.parse().ok()).unwrap_or(1).max(1);

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e, started),
    };

    let outcome = async {
        if ["home", "featured", "trending"].contains(&selected_action.as_str()) {
            Ok::<_, (StatusCode, String)>(("home", get_homepage(&c).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?))
        } else if selected_action == "detail"
            || (id.is_some() && keyword.is_empty() && selected_action != "episodes")
        {
            let Some(id) = id.clone() else {
                return Err((StatusCode::BAD_REQUEST, "Parameter 'id' (TMDB ID) wajib diisi untuk melihat detail film/series".to_string()));
            };
            Ok(("detail", get_details(&c, &id, &typ).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?))
        } else if selected_action == "episodes" {
            let Some(id) = id.clone() else {
                return Err((StatusCode::BAD_REQUEST, "Parameter 'id' (TMDB ID) wajib diisi untuk melihat daftar episode".to_string()));
            };
            Ok(("episodes", get_episodes(&c, &id, season).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?))
        } else if !keyword.is_empty() || selected_action == "search" {
            if keyword.is_empty() {
                return Err((StatusCode::BAD_REQUEST, "Parameter 'query' atau 'q' wajib diisi untuk pencarian".to_string()));
            }
            Ok(("search", search(&c, &keyword, page).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?))
        } else {
            Ok(("home", get_homepage(&c).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?))
        }
    }
    .await;

    match outcome {
        Ok((action, result)) => Json(json!({
            "status": true,
            "action": action,
            "result": result,
            "metadata": {"processing_time": format!("{}ms", started.elapsed().as_millis())},
        })).into_response(),
        Err((status, msg)) => err(status, &msg, started),
    }
}

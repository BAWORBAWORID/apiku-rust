// LK21 Stream v2 (TMDB + embed servers) — native conversion of api/downloader/lk21v2.js
// Pure TMDB API client (search multi / detail / credits / trending) + server embed URL builder.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const TMDB_API_KEY: &str = "82524e2faef91706a2d52d52496130ac";
const TMDB_BASE: &str = "https://api.themoviedb.org/3";
const TMDB_IMG: &str = "https://image.tmdb.org/t/p/w500";

async fn tmdb(client: &reqwest::Client, endpoint: &str, extra: &[(&str, String)]) -> Option<Value> {
    let mut url = format!("{TMDB_BASE}{endpoint}?api_key={TMDB_API_KEY}&language=id-ID");
    for (k, v) in extra {
        url.push_str(&format!("&{k}={}", urlencoding::encode(v)));
    }
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

fn media_items(data: Option<Value>) -> Vec<Value> {
    let results = match data.and_then(|d| d.get("results").cloned()) {
        Some(r) if r.is_array() => r,
        _ => return vec![],
    };
    results
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|r| matches!(r.get("media_type").and_then(|m| m.as_str()), Some("movie") | Some("tv")))
        .map(|r| {
            let title = r.get("title").or_else(|| r.get("name")).cloned().unwrap_or(Value::Null);
            let date = r.get("release_date").or_else(|| r.get("first_air_date")).and_then(|d| d.as_str()).unwrap_or("");
            let year = date.split('-').next().unwrap_or("").to_string();
            let rating = r.get("vote_average").and_then(|v| v.as_f64()).map(|v| format!("{v:.1}")).unwrap_or_else(|| "N/A".into());
            let poster = r.get("poster_path").and_then(|p| p.as_str()).map(|p| format!("{TMDB_IMG}{p}"));
            json!({
                "id": r.get("id"),
                "title": title,
                "year": year,
                "type": r.get("media_type"),
                "rating": rating,
                "poster": poster
            })
        })
        .collect()
}

fn servers_map(id: &str, kind: &str, season: u32, episode: u32) -> Value {
    json!({
        "vidsrc": if kind == "movie" {
            json!(format!("https://vidsrc.me/embed/movie?tmdb={id}"))
        } else {
            json!(format!("https://vidsrc.me/embed/tv?tmdb={id}&season={season}&episode={episode}"))
        },
        "embedsu": if kind == "movie" {
            json!(format!("https://embed.su/embed/movie/{id}"))
        } else {
            json!(format!("https://embed.su/embed/tv/{id}/{season}/{episode}"))
        },
        "vidsrcpro": if kind == "movie" {
            json!(format!("https://vidsrc.pro/embed/movie/{id}"))
        } else {
            json!(format!("https://vidsrc.pro/embed/tv/{id}/{season}/{episode}"))
        }
    })
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["action", "q", "id", "type", "server", "season", "episode"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let s = |k: &str| merged.get(k).map(|v| v.to_string()).unwrap_or_default();

    let action = s("action");
    if action.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter \"action\" wajib diisi (search|detail|stream|trending)"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    match action.as_str() {
        "search" => {
            let q = s("q");
            if q.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter \"q\" wajib diisi"
                }))).into_response();
            }
            let data = tmdb(&client, "/search/multi", &[("query", q)]).await;
            Json(json!({ "status": true, "result": media_items(data) })).into_response()
        }
        "trending" => {
            let data = tmdb(&client, "/trending/all/week", &[]).await;
            let items = media_items(data);
            Json(json!({ "status": true, "result": items.into_iter().take(20).collect::<Vec<_>>() })).into_response()
        }
        "detail" => {
            let id = s("id");
            if id.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter \"id\" wajib diisi"
                }))).into_response();
            }
            let kind = if s("type") == "tv" { "tv" } else { "movie" };
            let data = match tmdb(&client, &format!("/{kind}/{id}"), &[]).await {
                Some(d) if d.is_object() => d,
                _ => return (StatusCode::NOT_FOUND, Json(json!({
                    "status": false, "message": "Gagal mengambil data dari TMDB"
                }))).into_response(),
            };
            let credits = tmdb(&client, &format!("/{kind}/{id}/credits"), &[]).await.unwrap_or(Value::Null);

            let title = data.get("title").or_else(|| data.get("name")).cloned().unwrap_or(Value::Null);
            let release_date = data.get("release_date").or_else(|| data.get("first_air_date")).and_then(|d| d.as_str()).unwrap_or("");
            let year = release_date.split('-').next().unwrap_or("N/A").to_string();
            let runtime = if kind == "movie" {
                data.get("runtime").and_then(|r| r.as_u64()).unwrap_or(0)
            } else {
                data.pointer("/episode_run_time/0").and_then(|r| r.as_u64()).unwrap_or(0)
            };
            let genres: Vec<String> = data
                .get("genres")
                .and_then(|g| g.as_array())
                .map(|a| a.iter().filter_map(|g| g.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let cast: Vec<Value> = credits
                .pointer("/cast")
                .and_then(|c| c.as_array())
                .map(|a| {
                    a.iter().take(10).map(|c| json!({
                        "name": c.get("name"),
                        "character": c.get("character"),
                        "photo": c.get("profile_path").and_then(|p| p.as_str()).map(|p| format!("{TMDB_IMG}{p}"))
                    })).collect()
                })
                .unwrap_or_default();
            let rating = data.get("vote_average").and_then(|v| v.as_f64()).map(|v| format!("{v:.1}")).unwrap_or_else(|| "N/A".into());
            let servers = servers_map(&id, kind, 1, 1);

            Json(json!({
                "status": true,
                "result": {
                    "id": id.parse::<i64>().unwrap_or(0),
                    "title": title,
                    "type": kind,
                    "year": year,
                    "rating": rating,
                    "runtime": if runtime > 0 { json!(format!("{runtime} min")) } else { json!("N/A") },
                    "genres": genres,
                    "overview": data.get("overview").cloned().unwrap_or(json!("Sinopsis tidak tersedia.")),
                    "poster": data.get("poster_path").and_then(|p| p.as_str()).map(|p| format!("{TMDB_IMG}{p}")),
                    "backdrop": data.get("backdrop_path").and_then(|p| p.as_str()).map(|p| format!("{TMDB_IMG}{p}")),
                    "seasons": if kind == "tv" { data.get("number_of_seasons").cloned().unwrap_or(Value::Null) } else { Value::Null },
                    "episodes": if kind == "tv" { data.get("number_of_episodes").cloned().unwrap_or(Value::Null) } else { Value::Null },
                    "cast": cast,
                    "servers": servers,
                    "streamUrl": servers.get("vidsrc").cloned().unwrap_or(Value::Null)
                }
            }))
            .into_response()
        }
        "stream" => {
            let id = s("id");
            if id.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Parameter \"id\" wajib diisi"
                }))).into_response();
            }
            let kind = if s("type") == "tv" { "tv" } else { "movie" };
            let server = match s("server").as_str() {
                "embedsu" => "embedsu",
                "vidsrcpro" => "vidsrcpro",
                _ => "vidsrc",
            };
            let season: u32 = s("season").parse().unwrap_or(1);
            let episode: u32 = s("episode").parse().unwrap_or(1);
            let servers = servers_map(&id, kind, season, episode);
            match servers.get(server) {
                Some(u) => Json(json!({ "status": true, "result": u })).into_response(),
                None => (StatusCode::BAD_REQUEST, Json(json!({
                    "status": false, "message": "Server tidak dikenal"
                }))).into_response(),
            }
        }
        _ => (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Invalid action"
        }))).into_response(),
    }
}

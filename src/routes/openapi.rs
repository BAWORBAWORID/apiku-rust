use axum::{
    extract::State,
    http::{header, HeaderMap},
    response::{IntoResponse, Json},
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use crate::state::AppState;

pub fn discover_active_routes() -> Vec<String> {
    let mut routes = HashSet::new();
    let mod_candidates = [
        "./src/api/mod.rs",
        "./apiku-rs/src/api/mod.rs",
        "../src/api/mod.rs",
        "/home/agentuser/apiku/apiku-rs/src/api/mod.rs",
    ];

    for cand in &mod_candidates {
        let p = Path::new(cand);
        if p.exists() {
            if let Ok(content) = std::fs::read_to_string(p) {
                let mut cursor = 0;
                while let Some(pos) = content[cursor..].find(".route(") {
                    let abs_pos = cursor + pos + 7;
                    let rest = &content[abs_pos..];
                    if let Some(start) = rest.find('"') {
                        if let Some(end) = rest[start + 1..].find('"') {
                            let route_path = &rest[start + 1..start + 1 + end];
                            if route_path.starts_with('/') {
                                routes.insert(format!("/api{}", route_path));
                            }
                            cursor = abs_pos + start + 1 + end + 1;
                            continue;
                        }
                    }
                    cursor = abs_pos;
                }
                break;
            }
        }
    }

    let mut list: Vec<String> = routes.into_iter().collect();
    list.sort();
    list
}

pub async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("https");

    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("api.zyvor.my.id");

    let baseurl = format!("{}://{}", proto, host);
    let target_node_url = format!("{}/openapi.json", state.node_backend_url);

    // 1. Fetch live from Node.js backend (http://127.0.0.1:3000/openapi.json)
    let fetched = match state.client
        .get(&target_node_url)
        
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => {
            res.json::<Value>().await.ok()
        }
        _ => None,
    };

    let (mut endpoints, title, desc, version) = if let Some(mut data) = fetched {
        let title = data.get("title").and_then(|v| v.as_str()).unwrap_or("Zyyvor API").to_string();
        let desc = data.get("description").and_then(|v| v.as_str()).unwrap_or("API Documentation").to_string();
        let version = data.get("version").and_then(|v| v.as_str()).unwrap_or("2.1.2").to_string();
        let endpoints = data.get_mut("endpoints")
            .and_then(|v| v.as_array_mut())
            .map(|arr| std::mem::take(arr))
            .unwrap_or_default();

        // Update local catalog cache asynchronously in background
        if !endpoints.is_empty() {
            let eps_clone = endpoints.clone();
            tokio::spawn(async move {
                let cache_paths = [
                    "/home/agentuser/apiku/apiku-rs/data/endpoints-catalog.json",
                    "./data/endpoints-catalog.json",
                    "data/endpoints-catalog.json",
                ];
                for path in &cache_paths {
                    if let Ok(serialized) = serde_json::to_string_pretty(&eps_clone) {
                        let _ = std::fs::write(path, serialized);
                    }
                }
            });
        }

        (endpoints, title, desc, version)
    } else {
        // Fallback to offline catalog if Node.js backend is restarting
        let cache_paths = [
            "/home/agentuser/apiku/apiku-rs/data/endpoints-catalog.json",
            "./data/endpoints-catalog.json",
            "data/endpoints-catalog.json",
        ];

        let mut loaded = Vec::new();
        for path in &cache_paths {
            let p = Path::new(path);
            if p.exists() {
                if let Ok(content) = std::fs::read_to_string(p) {
                    if let Ok(arr) = serde_json::from_str::<Vec<Value>>(&content) {
                        loaded = arr;
                        break;
                    }
                }
            }
        }

        (
            loaded,
            state.config.name.as_deref().unwrap_or("Zyyvor API").to_string(),
            "API Documentation".to_string(),
            state.config.version.as_deref().unwrap_or("2.1.2").to_string(),
        )
    };

    // 2. Synchronize endpoint status & update URLs for client's host
    let endpoints_status = &state.config.endpoints_status;

    for ep in endpoints.iter_mut() {
        if let Some(obj) = ep.as_object_mut() {
            let route = obj.get("route").and_then(|v| v.as_str()).unwrap_or("").to_string();

            // Status from configuration.json
            let status = endpoints_status
                .get(&route)
                .cloned()
                .unwrap_or_else(|| "online".to_string());
            obj.insert("status".to_string(), json!(status));

            // Generate full example URL matching client baseurl
            let mut url = format!("{}{}", baseurl, route);
            if let Some(params) = obj.get("params").and_then(|p| p.as_array()) {
                if !params.is_empty() {
                    let query_parts: Vec<String> = params
                        .iter()
                        .filter_map(|p| p.as_str())
                        .map(|p| format!("{}=YOUR_{}", p, p.to_uppercase()))
                        .collect();
                    url.push('?');
                    url.push_str(&query_parts.join("&"));
                }
            }
            obj.insert("url".to_string(), json!(url));
        }
    }

    let total = endpoints.len();

    (
        [(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")],
        Json(json!({
            "title": title,
            "description": desc,
            "version": version,
            "lastUpdate": chrono::Utc::now().to_rfc3339(),
            "baseurl": baseurl,
            "endpoints": endpoints,
            "metadata": {
                "totalEndpoints": total,
                "totalBaseUrls": 1,
                "hotReload": true
            }
        })),
    )
}

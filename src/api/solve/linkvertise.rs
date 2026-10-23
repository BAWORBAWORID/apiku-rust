use base64::Engine as _;
// Linkvertise Bypass — native conversion of api/solve/linkvertise.js
// Pure GraphQL against publisher.linkvertise.com. No browser, no Node proxy.
use axum::{
    extract::{Query, State},
    response::Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::state::AppState;
use super::common::{err, merged_params, ok};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GRAPHQL_ENDPOINT: &str = "https://publisher.linkvertise.com/graphql";

enum ParsedUrl {
    Dynamic(String),
    Link { user_id: Option<String>, url_slug: String },
}

fn parse_linkvertise_url(input: &str) -> Result<ParsedUrl, String> {
    let mut target = input.trim().to_string();
    if !target.starts_with("http://") && !target.starts_with("https://") {
        target = format!("https://{target}");
    }
    let parsed = url::Url::parse(&target).map_err(|e| format!("Invalid URL: {e}"))?;

    for (k, v) in parsed.query_pairs() {
        if k == "r" {
            if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(v.as_bytes()) {
                let decoded = String::from_utf8_lossy(&decoded).to_string();
                if decoded.starts_with("http://") || decoded.starts_with("https://") {
                    return Ok(ParsedUrl::Dynamic(decoded));
                }
            }
        }
    }

    let mut segments: Vec<String> = parsed
        .path()
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if segments.first().map(|s| s == "access" || s == "download").unwrap_or(false) {
        segments.remove(0);
    }

    match segments.len() {
        0 => Err("Invalid Linkvertise URL: unable to extract user ID and url slug".into()),
        1 => Ok(ParsedUrl::Link { user_id: None, url_slug: segments[0].clone() }),
        _ => Ok(ParsedUrl::Link {
            user_id: Some(segments[0].clone()),
            url_slug: segments[1].clone(),
        }),
    }
}

async fn request_graphql(
    client: &reqwest::Client,
    query: &str,
    variables: Value,
    referer: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let res = client
        .post(GRAPHQL_ENDPOINT)
        .timeout(Duration::from_millis(timeout_ms))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Origin", "https://linkvertise.com")
        .header("Referer", referer)
        .header("cqreferrer", referer)
        .header("User-Agent", UA)
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| format!("Linkvertise GraphQL request failed: {e}"))?;

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Linkvertise GraphQL HTTP error {status}"));
    }
    Ok(body)
}

const INFO_QUERY: &str = r#"query getLinkByIdentifier($identifier: PublicLinkIdentificationInput!) {
    linkByIdentifier(linkIdentificationInput: $identifier) {
      id title url target_type target_host favicon_url description
      publisher { id name }
    }
  }"#;

const CONTENT_QUERY: &str = r#"query getContent($identifier: PublicLinkIdentificationInput!) {
    getContent(input: $identifier) {
      __typename
      ... on DetailPageTargetData { type url paste }
      ... on ContentAccessTaskSet {
        tasks {
          __typename id
          ... on WaitTask { status remainingWaitingTime }
          ... on AdTask { status adIndex adsTotal }
        }
      }
    }
  }"#;

const COMPLETE_MUTATION: &str = r#"mutation completeTask($identifier: PublicLinkIdentificationInput!, $task_id: String!, $task_args: TaskArgument) {
    completeTask(input: $identifier, task_id: $task_id, task_args: $task_args) {
      id __typename
      ... on AdTask { status adIndex adsTotal }
      ... on WaitTask { status remainingWaitingTime }
    }
  }"#;

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Json<Value> {
    let start_time = Instant::now();
    let params = merged_params(&query, body.map(|b| b.0));
    let _ = &state;

    let target = params
        .get("url")
        .or_else(|| params.get("link"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if target.is_empty() {
        return Json(err("Parameter 'url' wajib diisi"));
    }

    let client = match super::common::http_client(None, 30) {
        Ok(c) => c,
        Err(e) => return Json(err(&e)),
    };

    let parsed = match parse_linkvertise_url(&target) {
        Ok(p) => p,
        Err(e) => return Json(err(&e)),
    };

    let (user_id, url_slug) = match parsed {
        ParsedUrl::Dynamic(dynamic_url) => {
            return Json(ok(json!({
                "success": true,
                "original_url": target,
                "title": Value::Null,
                "target_type": "URL",
                "destination_url": dynamic_url,
                "publisher": Value::Null,
                "is_dynamic": true,
                "execution_time_ms": start_time.elapsed().as_millis() as u64,
            })));
        }
        ParsedUrl::Link { user_id, url_slug } => (user_id, url_slug),
    };

    let referer = match &user_id {
        Some(uid) => format!("https://linkvertise.com/access/{uid}/{url_slug}"),
        None => format!("https://linkvertise.com/{url_slug}"),
    };
    let identifier = json!({ "userIdAndUrl": {
        "user_id": user_id.clone().unwrap_or_else(|| "0".into()),
        "url": url_slug,
    }});
    let vars = json!({ "identifier": identifier });

    // 1. Link info
    let info_json = match request_graphql(&client, INFO_QUERY, vars.clone(), &referer, 30_000).await {
        Ok(j) => j,
        Err(e) => return Json(err(&e)),
    };
    let link_details = match info_json.pointer("/data/linkByIdentifier") {
        Some(d) if !d.is_null() => d.clone(),
        _ => return Json(err("Linkvertise target link not found or has been deleted")),
    };

    // 2. Task loop
    let max_attempts = 10u32;
    let step_delay = Duration::from_millis(600);
    let mut final_target: Option<Value> = None;
    let mut attempts = 0u32;

    while attempts < max_attempts {
        attempts += 1;

        let content_json = match request_graphql(&client, CONTENT_QUERY, vars.clone(), &referer, 30_000).await {
            Ok(j) => j,
            Err(e) => return Json(err(&e)),
        };
        let content_data = match content_json.pointer("/data/getContent") {
            Some(d) if !d.is_null() => d.clone(),
            _ => {
                if let Some(errors) = content_json.get("errors").and_then(Value::as_array) {
                    if let Some(first) = errors.first() {
                        let msg = first.get("message").and_then(Value::as_str).unwrap_or("unknown");
                        return Json(err(&format!("GraphQL error: {msg}")));
                    }
                }
                return Json(err("Unexpected empty content response from Linkvertise"));
            }
        };

        match content_data.get("__typename").and_then(Value::as_str) {
            Some("DetailPageTargetData") => {
                final_target = Some(content_data);
                break;
            }
            Some("ContentAccessTaskSet") => {
                if let Some(tasks) = content_data.get("tasks").and_then(Value::as_array) {
                    let mut did_act = false;
                    for task in tasks {
                        let status = task.get("status").and_then(Value::as_str).unwrap_or("");
                        let task_id = task.get("id").and_then(Value::as_str).unwrap_or("");
                        if status.is_empty() || status == "IN_PROGRESS" {
                            let tv = json!({ "identifier": identifier, "task_id": task_id, "task_args": Value::Null });
                            let _ = request_graphql(&client, COMPLETE_MUTATION, tv, &referer, 30_000).await;
                            did_act = true;
                        }
                    }
                    if !did_act && !tasks.is_empty() {
                        if let Some(first_id) = tasks[0].get("id").and_then(Value::as_str) {
                            let tv = json!({ "identifier": identifier, "task_id": first_id, "task_args": Value::Null });
                            let _ = request_graphql(&client, COMPLETE_MUTATION, tv, &referer, 30_000).await;
                        }
                    }
                }
            }
            _ => {}
        }

        tokio::time::sleep(step_delay).await;
    }

    let final_target = match final_target {
        Some(t) => t,
        None => {
            return Json(err(&format!(
                "Failed to bypass Linkvertise tasks within {max_attempts} attempts"
            )))
        }
    };

    let destination = final_target
        .get("url")
        .and_then(Value::as_str)
        .or_else(|| final_target.get("paste").and_then(Value::as_str));

    Json(ok(json!({
        "success": true,
        "original_url": target,
        "link_id": link_details.get("id"),
        "title": link_details.get("title"),
        "target_type": final_target.get("type").filter(|v| !v.is_null())
            .or_else(|| link_details.get("target_type")),
        "target_host": link_details.get("target_host"),
        "favicon_url": link_details.get("favicon_url"),
        "description": link_details.get("description"),
        "publisher": link_details.get("publisher"),
        "destination_url": destination,
        "attempts": attempts,
        "execution_time_ms": start_time.elapsed().as_millis() as u64,
    })))
}

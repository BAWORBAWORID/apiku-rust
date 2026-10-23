use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

const BASE_URL: &str = "https://www.turboseek.io/api";

#[derive(Debug, Deserialize)]
pub struct TurboSeekParams {
    pub text: Option<String>,
}

pub async fn handler(
    Query(query): Query<TurboSeekParams>,
    body: Option<Json<TurboSeekParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let query_str = params.text.unwrap_or_default().trim().to_string();

    if query_str.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter 'text' wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let user_agent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36";

    // 1. Get Sources
    let sources_res = client
        .post(format!("{}/getSources", BASE_URL))
                    .header("Content-Type", "application/json")
        .header("User-Agent", user_agent)
                    .header("Origin", "https://www.turboseek.io")
                    .header("Referer", "https://www.turboseek.io/")
        .json(&json!({ "question": &query_str }))
        .send()
        .await;

    let sources: Vec<serde_json::Value> = match sources_res {
        Ok(resp) => resp.json().await.unwrap_or_default(),
        Err(_) => vec![],
    };

    if sources.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "status": false,
                "message": "No sources found for the given query"
            })),
        );
    }

    // 2. Parallel getAnswer & getSimilarQuestions
    let answer_req = client
        .post(format!("{}/getAnswer", BASE_URL))
                    .header("Content-Type", "application/json")
        .header("User-Agent", user_agent)
                    .header("Origin", "https://www.turboseek.io")
                    .header("Referer", "https://www.turboseek.io/")
        .json(&json!({ "question": &query_str, "sources": &sources }))
        .send();

    let similar_req = client
        .post(format!("{}/getSimilarQuestions", BASE_URL))
                    .header("Content-Type", "application/json")
        .header("User-Agent", user_agent)
                    .header("Origin", "https://www.turboseek.io")
                    .header("Referer", "https://www.turboseek.io/")
        .json(&json!({ "question": &query_str, "sources": &sources }))
        .send();

    let (answer_res, similar_res) = tokio::join!(answer_req, similar_req);

    let raw_answer = match answer_res {
        Ok(resp) => resp.text().await.unwrap_or_default(),
        Err(_) => String::new(),
    };

    let similar_questions: Vec<serde_json::Value> = match similar_res {
        Ok(resp) => resp.json().await.unwrap_or_default(),
        Err(_) => vec![],
    };

    // Clean answer (strip html tags)
    let re = regex::Regex::new(r"<[^>]*>").unwrap();
    let clean_answer = re.replace_all(&raw_answer, "").replace('\n', " ").trim().to_string();

    let formatted_sources: Vec<serde_json::Value> = sources
        .into_iter()
        .map(|s| {
            json!({
                "title": s.get("title").cloned().unwrap_or(json!("")),
                "url": s.get("url").cloned().unwrap_or(json!(""))
            })
        })
        .collect();

    (
        StatusCode::OK,
        Json(json!({
            "status": true,
            "result": {
                "answer": clean_answer,
                "sources": formatted_sources,
                "similarQuestions": similar_questions
            }
        })),
    )
}

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const KAHOOT_REST_API: &str = "https://create.kahoot.it/rest/kahoots";
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct KahootParams {
    pub action: Option<String>,
    pub query: Option<String>,
    pub name: Option<String>,
    pub q: Option<String>,
    pub url: Option<String>,
    pub id: Option<String>,
    pub link: Option<String>,
    pub code: Option<String>,
    pub pin: Option<String>,
    #[serde(rename = "quizId")]
    pub quiz_id: Option<String>,
    pub limit: Option<usize>,
}

fn clean_text(text: &str) -> String {
    let re = Regex::new(r"<[^>]+>").unwrap();
    re.replace_all(text, "").trim().to_string()
}

fn extract_quiz_uuid(input: &str) -> String {
    let trimmed = input.trim();
    let re = Regex::new(r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap();
    if let Some(mat) = re.find(trimmed) {
        mat.as_str().to_string()
    } else {
        trimmed.to_string()
    }
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<KahootParams>,
    body: Option<Json<KahootParams>>,
) -> impl IntoResponse {
    let b = body.map(|Json(x)| x);

    let action = query.action
        .or_else(|| b.as_ref().and_then(|x| x.action.clone()))
        .unwrap_or_default()
        .to_lowercase();

    let search_key = query.query
        .or(query.name)
        .or(query.q)
        .or_else(|| b.as_ref().and_then(|x| x.query.clone().or_else(|| x.name.clone()).or_else(|| x.q.clone())));

    let target_input = query.url
        .or(query.id)
        .or(query.link)
        .or(query.code)
        .or(query.pin)
        .or(query.quiz_id)
        .or_else(|| {
            b.as_ref().and_then(|x| {
                x.url.clone()
                    .or_else(|| x.id.clone())
                    .or_else(|| x.link.clone())
                    .or_else(|| x.code.clone())
                    .or_else(|| x.pin.clone())
                    .or_else(|| x.quiz_id.clone())
            })
        });

    let limit = query.limit
        .or_else(|| b.as_ref().and_then(|x| x.limit))
        .unwrap_or(10);

    let client = &state.client;

    // Mode 1: Answers mode
    if action == "answers" || (action.is_empty() && target_input.is_some()) || (target_input.is_some() && search_key.is_none()) {
        let input_to_resolve = target_input.or(search_key).unwrap_or_default();
        if input_to_resolve.trim().is_empty() {
            return Json(json!({
                "status": false,
                "message": "Parameter 'url', 'id', atau 'link' kuis Kahoot wajib diisi untuk mengambil kunci jawaban."
            }));
        }

        let uuid = extract_quiz_uuid(&input_to_resolve);
        let pin_re = Regex::new(r"^[0-9]{5,9}$").unwrap();
        if pin_re.is_match(&uuid) {
            return Json(json!({
                "status": false,
                "message": "Game PIN live game (angka) adalah sesi live sementara dan tidak menyediakan API publik langsung untuk kuis. Silakan cari kuis berdasarkan nama/judul (action=search&query=...) atau gunakan link URL kuis host."
            }));
        }

        let url = format!("{}/{}", KAHOOT_REST_API, uuid);
        match client.get(&url)
            .header("User-Agent", DEFAULT_USER_AGENT)
                        .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(res) => {
                let status = res.status();
                if status == 404 {
                    return Json(json!({
                        "status": false,
                        "message": "Kuis Kahoot tidak ditemukan atau berstatus Private (HTTP 404)"
                    }));
                }
                if !status.is_success() {
                    return Json(json!({
                        "status": false,
                        "message": format!("Gagal mengambil data kuis Kahoot (HTTP {})", status)
                    }));
                }

                if let Ok(data) = res.json::<serde_json::Value>().await {
                    let questions = data.get("questions")
                        .and_then(|q| q.as_array())
                        .map(|arr| {
                            arr.iter().enumerate().map(|(idx, q)| {
                                let choices = q.get("choices")
                                    .and_then(|c| c.as_array())
                                    .map(|c_arr| {
                                        c_arr.iter().map(|item| {
                                            json!({
                                                "answer": clean_text(item.get("answer").and_then(|a| a.as_str()).unwrap_or("")),
                                                "correct": item.get("correct").and_then(|c| c.as_bool()).unwrap_or(false)
                                            })
                                        }).collect::<Vec<_>>()
                                    })
                                    .unwrap_or_default();

                                let correct_answers: Vec<String> = choices.iter()
                                    .filter(|c| c.get("correct").and_then(|b| b.as_bool()).unwrap_or(false))
                                    .filter_map(|c| c.get("answer").and_then(|a| a.as_str()).map(|s| s.to_string()))
                                    .collect();

                                json!({
                                    "number": idx + 1,
                                    "question": clean_text(q.get("question").and_then(|x| x.as_str()).unwrap_or("")),
                                    "type": q.get("type").and_then(|t| t.as_str()).unwrap_or("quiz"),
                                    "time_limit_ms": q.get("time").and_then(|t| t.as_u64()).unwrap_or(20000),
                                    "points": q.get("points").and_then(|p| p.as_bool()).unwrap_or(true),
                                    "image_url": q.get("image").and_then(|i| i.as_str()),
                                    "choices": choices,
                                    "correct_answers": correct_answers
                                })
                            }).collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    return Json(json!({
                        "status": true,
                        "action": "answers",
                        "result": {
                            "uuid": data.get("uuid").and_then(|u| u.as_str()).unwrap_or(&uuid),
                            "title": data.get("title").and_then(|t| t.as_str()).unwrap_or(""),
                            "description": data.get("description").and_then(|d| d.as_str()).unwrap_or(""),
                            "creator_username": data.get("creator_username").and_then(|c| c.as_str()).unwrap_or(""),
                            "total_questions": questions.len(),
                            "cover_image": data.get("cover").and_then(|c| c.as_str()),
                            "questions": questions
                        }
                    }));
                }

                Json(json!({
                    "status": false,
                    "message": "Gagal parsing respons kuis Kahoot"
                }))
            }
            Err(e) => Json(json!({
                "status": false,
                "message": format!("Gagal memproses request Kahoot: {}", e)
            })),
        }
    } else {
        // Mode 2: Search mode
        let query_str = search_key.or(target_input).unwrap_or_default();
        if query_str.trim().is_empty() {
            return Json(json!({
                "status": false,
                "message": "Parameter 'query' atau 'name' wajib diisi untuk mencari kuis Kahoot.",
                "usage": {
                    "search_by_name": "/api/fun/kahoot?action=search&query=matematika",
                    "answers_by_url": "/api/fun/kahoot?action=answers&url=https://create.kahoot.it/details/UUID",
                    "answers_by_id": "/api/fun/kahoot?action=answers&id=UUID"
                }
            }));
        }

        let possible_uuid = extract_quiz_uuid(&query_str);
        if possible_uuid.len() == 36 && possible_uuid.contains('-') {
            let url = format!("{}/{}", KAHOOT_REST_API, possible_uuid);
            match client.get(&url)
                .header("User-Agent", DEFAULT_USER_AGENT)
                            .header("Accept", "application/json")
                .send()
                .await
            {
                Ok(res) if res.status().is_success() => {
                    if let Ok(data) = res.json::<serde_json::Value>().await {
                        return Json(json!({
                            "status": true,
                            "action": "answers",
                            "result": data
                        }));
                    }
                }
                _ => {}
            }
        }

        let search_url = format!("{}/?query={}&limit={}", KAHOOT_REST_API, urlencoding::encode(&query_str), limit);
        match client.get(&search_url)
            .header("User-Agent", DEFAULT_USER_AGENT)
                        .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(res) => {
                if !res.status().is_success() {
                    return Json(json!({
                        "status": false,
                        "message": format!("Gagal mencari kuis Kahoot (HTTP {})", res.status())
                    }));
                }

                if let Ok(data) = res.json::<serde_json::Value>().await {
                    let entities = data.get("entities").and_then(|e| e.as_array()).cloned().unwrap_or_default();
                    let results: Vec<serde_json::Value> = entities.iter().map(|item| {
                        let card = item.get("card").cloned().unwrap_or_else(|| json!({}));
                        let uuid = card.get("uuid").and_then(|u| u.as_str()).unwrap_or("");
                        json!({
                            "uuid": uuid,
                            "title": card.get("title").and_then(|t| t.as_str()).unwrap_or(""),
                            "description": card.get("description").and_then(|d| d.as_str()).unwrap_or(""),
                            "creator_username": card.get("creator_username").and_then(|c| c.as_str()).unwrap_or(""),
                            "number_of_questions": card.get("number_of_questions").and_then(|n| n.as_u64()).unwrap_or(0),
                            "cover_image": card.get("cover"),
                            "details_url": format!("https://create.kahoot.it/details/{}", uuid)
                        })
                    }).collect();

                    return Json(json!({
                        "status": true,
                        "action": "search",
                        "result": {
                            "query": query_str,
                            "total_results": results.len(),
                            "results": results
                        }
                    }));
                }

                Json(json!({
                    "status": false,
                    "message": "Gagal membaca hasil pencarian Kahoot"
                }))
            }
            Err(e) => Json(json!({
                "status": false,
                "message": format!("Gagal mencari kuis Kahoot: {}", e)
            })),
        }
    }
}

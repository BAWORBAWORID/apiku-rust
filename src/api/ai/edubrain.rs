use axum::{
    extract::Query,
    response::IntoResponse,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct EduBrainParams {
    pub text: Option<String>,
}

pub async fn handler(
    Query(query): Query<EduBrainParams>,
    body: Option<Json<EduBrainParams>>,
) -> impl IntoResponse {
    let params = body.map(|Json(b)| b).unwrap_or(query);
    let text = params.text.unwrap_or_default().trim().to_string();

    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "Parameter text wajib diisi"
            })),
        );
    }

    let client = reqwest::Client::builder()
        
        .build()
        .unwrap_or_default();

    let query_gql = r#"mutation BrainToolsHomeworkHelperFirst($clientHash: String!, $clientUserId: String!, $sessionSourceUrl: String!, $gaCid: String!, $requestType: String!, $subject: String, $instructions: String!, $instructionsFromFiles: [String]) {
  brainToolsHomeworkHelperFirst(
    clientHash: $clientHash
    clientUserId: $clientUserId
    sessionSourceUrl: $sessionSourceUrl
    gaCid: $gaCid
    requestType: $requestType
    subject: $subject
    instructions: $instructions
    instructionsFromFiles: $instructionsFromFiles
  ) {
    status {
      code
      message
    }
    generatedText
    responseGenIdHash
    chatIdHash
    textSubjectGroup
  }
}"#;

    let payload = json!({
        "query": query_gql,
        "variables": {
            "clientHash": "9c8d4c3959694ca",
            "clientUserId": "",
            "sessionSourceUrl": "https://edubrain.ai/",
            "gaCid": "GA1.1.1373185759.1784942259",
            "requestType": "simple",
            "subject": "-Any Subject-",
            "instructions": &text,
            "instructionsFromFiles": null
        }
    });

    let res = client
        .post("https://wrtools-api.es-tech.co/graphql/ai_call")
                    .header("Content-Type", "application/json")
                    .header("Origin", "https://edubrain.ai")
                    .header("Referer", "https://edubrain.ai/")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .json(&payload)
        .send()
        .await;

    match res {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let helper = data.pointer("/data/brainToolsHomeworkHelperFirst");
                let generated_text = helper
                    .and_then(|h| h.get("generatedText"))
                    .and_then(|t| t.as_str())
                    .unwrap_or_default();

                let clean_text = generated_text
                    .replace("$$", "")
                    .replace('$', "")
                    .trim()
                    .to_string();

                (
                    StatusCode::OK,
                    Json(json!({
                        "status": true,
                        "result": {
                            "response": clean_text,
                            "raw": helper
                        }
                    })),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "status": false,
                        "message": "Gagal membaca response EduBrain"
                    })),
                )
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": false,
                "message": e.to_string()
            })),
        ),
    }
}

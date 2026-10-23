use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub status: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub timestamp: String,
    pub attribution: String,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(result: T, message: Option<String>, elapsed_ms: u128, attribution: &str) -> Self {
        Self {
            status: true,
            time: Some(format!("{}ms", elapsed_ms)),
            message,
            result: Some(result),
            error: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            attribution: attribution.to_string(),
        }
    }

    pub fn error(error: String, elapsed_ms: u128, attribution: &str) -> Self {
        Self {
            status: false,
            time: Some(format!("{}ms", elapsed_ms)),
            message: None,
            result: None,
            error: Some(error),
            timestamp: chrono::Utc::now().to_rfc3339(),
            attribution: attribution.to_string(),
        }
    }
}

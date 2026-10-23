use crate::utils::config::AppConfig;
use dashmap::DashMap;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyInfo {
    pub key: String,
    pub name: Option<String>,
    pub role: Option<String>,
    pub enabled: bool,
    #[serde(rename = "allowedStatuses")]
    pub allowed_statuses: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiKeysFile {
    pub keys: Vec<ApiKeyInfo>,
}

use std::sync::atomic::{AtomicU32, AtomicU64};
use std::time::Instant;

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub http_client: Client,
    pub config: Arc<AppConfig>,
    pub api_keys: Arc<DashMap<String, ApiKeyInfo>>,
    pub node_backend_url: String,
    pub start_time: Instant,
    pub total_requests: Arc<AtomicU64>,
    pub rpm: Arc<AtomicU32>,
    pub endpoints_catalog: Arc<Vec<serde_json::Value>>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let client = Client::builder()
            
            .pool_max_idle_per_host(50)
            .build()
            .expect("Failed to build HTTP client");
        let http_client = client.clone();
        let start_time = Instant::now();
        let total_requests = Arc::new(AtomicU64::new(0));
        let rpm = Arc::new(AtomicU32::new(0));

        let endpoints_catalog = Arc::new(config.endpoints.clone());

        let api_keys_map = DashMap::new();
        let key_candidates = [
            "/home/agentuser/apiku/apiku-rs/data/api-keys.json",
            "./data/api-keys.json",
            "./apiku-rs/data/api-keys.json",
            "../data/api-keys.json",
            "/home/agentuser/apiku/data/api-keys.json",
        ];

        for path in &key_candidates {
            if Path::new(path).exists() {
                if let Ok(content) = fs::read_to_string(path) {
                    if let Ok(parsed) = serde_json::from_str::<ApiKeysFile>(&content) {
                        for k in parsed.keys {
                            api_keys_map.insert(k.key.clone(), k);
                        }
                    }
                }
                break;
            }
        }

        let node_backend = std::env::var("NODE_BACKEND_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());

        Self {
            client,
            http_client,
            config: Arc::new(config),
            api_keys: Arc::new(api_keys_map),
            node_backend_url: node_backend,
            start_time,
            total_requests,
            rpm,
            endpoints_catalog,
        }
    }
}

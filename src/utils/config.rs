use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub name: Option<String>,
    pub version: Option<String>,
    pub attribution: Option<String>,
    #[serde(rename = "endpointsStatus", default)]
    pub endpoints_status: HashMap<String, String>,
    #[serde(default)]
    pub endpoints: Vec<serde_json::Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
    #[serde(skip)]
    pub config_path: Option<PathBuf>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            name: Some("Apiku Rust Core".to_string()),
            version: Some("2.1.2".to_string()),
            attribution: Some("@zyvorapi".to_string()),
            endpoints_status: HashMap::new(),
            endpoints: Vec::new(),
            extra: HashMap::new(),
            config_path: None,
        }
    }
}

pub fn find_config_path() -> Option<PathBuf> {
    let candidates = [
        "/home/agentuser/apiku/apiku-rs/configuration.json",
        "./apiku-rs/configuration.json",
        "configuration.json",
        "./configuration.json",
        "../configuration.json",
        "/home/agentuser/apiku/configuration.json",
    ];

    for path in &candidates {
        let p = Path::new(path);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }
    None
}

pub fn load_config() -> AppConfig {
    if let Some(path) = find_config_path() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                config.config_path = Some(path);
                return config;
            }
        }
    }

    AppConfig::default()
}

pub fn sync_endpoints_status(config: &mut AppConfig, active_routes: &[&str]) -> bool {
    let mut updated = false;

    for &route in active_routes {
        if !config.endpoints_status.contains_key(route) {
            config.endpoints_status.insert(route.to_string(), "online".to_string());
            updated = true;
        }
    }

    if updated {
        if let Some(ref path) = config.config_path {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(status_obj) = json_val.get_mut("endpointsStatus").and_then(|v| v.as_object_mut()) {
                        for &route in active_routes {
                            if !status_obj.contains_key(route) {
                                status_obj.insert(route.to_string(), serde_json::json!("online"));
                            }
                        }
                    }
                    if let Ok(pretty) = serde_json::to_string_pretty(&json_val) {
                        if fs::write(path, pretty).is_ok() {
                            info!("✅ configuration.json automatically updated with new Rust endpoints!");
                        }
                    }
                }
            }
        } else {
            warn!("No configuration.json path found to update endpoints status");
        }
    }

    updated
}

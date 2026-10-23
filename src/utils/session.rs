use std::path::{Path, PathBuf};
use serde_json::Value;

pub const SESSION_MAX_AGE_SECS: u64 = 24 * 3600; // 24 hours

pub fn get_session_dir() -> PathBuf {
    let candidates = [
        "/home/agentuser/apiku/apiku-rs/data/session",
        "./data/session",
        "../data/session",
        "/home/agentuser/apiku/data/session",
    ];
    for c in &candidates {
        let p = Path::new(c);
        if p.exists() {
            return p.to_path_buf();
        }
    }
    PathBuf::from("/home/agentuser/apiku/apiku-rs/data/session")
}

pub async fn load_session(filename: &str, defaults: Value) -> Value {
    let dir = get_session_dir();
    let file_path = dir.join(filename);
    if let Ok(raw) = tokio::fs::read_to_string(&file_path).await {
        if let Ok(val) = serde_json::from_str(&raw) {
            return val;
        }
    }
    defaults
}

pub async fn save_session(filename: &str, data: &Value) -> Result<(), std::io::Error> {
    let dir = get_session_dir();
    let _ = tokio::fs::create_dir_all(&dir).await;
    let file_path = dir.join(filename);
    let json_str = serde_json::to_string_pretty(data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    tokio::fs::write(&file_path, json_str).await
}

pub async fn cleanup_expired_sessions() -> usize {
    let dir = get_session_dir();
    let mut deleted = 0;
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        let now = std::time::SystemTime::now();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(metadata) = entry.metadata().await {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(elapsed) = now.duration_since(modified) {
                            if elapsed.as_secs() > SESSION_MAX_AGE_SECS {
                                if tokio::fs::remove_file(&path).await.is_ok() {
                                    deleted += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    deleted
}

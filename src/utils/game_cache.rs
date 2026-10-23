use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use serde_json::Value;
use rand::Rng;

struct CacheEntry {
    data: Value,
    timestamp: Instant,
}

pub struct GameCache {
    client: reqwest::Client,
    cache: RwLock<HashMap<String, CacheEntry>>,
    ttl: Duration,
}

impl Default for GameCache {
    fn default() -> Self {
        Self::new(Duration::from_secs(600))
    }
}

impl GameCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
            cache: RwLock::new(HashMap::new()),
            ttl,
        }
    }

    pub async fn fetch_cached(&self, url: &str) -> Result<Value, String> {
        // Read lock check
        {
            let map = self.cache.read().unwrap();
            if let Some(entry) = map.get(url) {
                if entry.timestamp.elapsed() < self.ttl {
                    return Ok(entry.data.clone());
                }
            }
        }

        // Fetch fresh
        let res = self.client.get(url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await;

        match res {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<Value>().await {
                    let mut map = self.cache.write().unwrap();
                    map.insert(url.to_string(), CacheEntry {
                        data: data.clone(),
                        timestamp: Instant::now(),
                    });
                    Ok(data)
                } else {
                    // Fallback to stale if available
                    let map = self.cache.read().unwrap();
                    if let Some(entry) = map.get(url) {
                        return Ok(entry.data.clone());
                    }
                    Err("Failed parsing JSON response".to_string())
                }
            }
            _ => {
                // Return stale if available
                let map = self.cache.read().unwrap();
                if let Some(entry) = map.get(url) {
                    return Ok(entry.data.clone());
                }
                Err("Failed fetching game data".to_string())
            }
        }
    }

    pub fn pick_random(val: &Value) -> Option<(Value, usize, usize)> {
        let arr = val.as_array()?;
        if arr.is_empty() {
            return None;
        }
        let mut rng = rand::thread_rng();
        let idx = rng.gen_range(0..arr.len());
        Some((arr[idx].clone(), idx, arr.len()))
    }

    pub fn clear(&self) {
        let mut map = self.cache.write().unwrap();
        map.clear();
    }
}

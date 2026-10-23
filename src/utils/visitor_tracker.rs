use std::collections::HashSet;
use std::sync::RwLock;
use sha2::{Digest, Sha256};
use chrono::Utc;

pub struct VisitorTracker {
    salt: String,
    today_date: RwLock<String>,
    today_ips: RwLock<HashSet<String>>,
    today_count: RwLock<usize>,
    total_count: RwLock<usize>,
}

impl Default for VisitorTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl VisitorTracker {
    pub fn new() -> Self {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        Self {
            salt: "zyvorapi-visitor-2026".to_string(),
            today_date: RwLock::new(today),
            today_ips: RwLock::new(HashSet::new()),
            today_count: RwLock::new(0),
            total_count: RwLock::new(0),
        }
    }

    fn hash_ip(&self, ip: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.salt.as_bytes());
        hasher.update(ip.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..8]) // 16 hex chars
    }

    pub fn track_visitor(&self, ip: &str) -> bool {
        let current_date = Utc::now().format("%Y-%m-%d").to_string();
        let hashed = self.hash_ip(ip);

        // Check date rollover
        {
            let mut date_lock = self.today_date.write().unwrap();
            if *date_lock != current_date {
                *date_lock = current_date;
                let mut ips_lock = self.today_ips.write().unwrap();
                ips_lock.clear();
                let mut count_lock = self.today_count.write().unwrap();
                *count_lock = 0;
            }
        }

        let mut ips_lock = self.today_ips.write().unwrap();
        if ips_lock.contains(&hashed) {
            return false;
        }

        ips_lock.insert(hashed);
        let mut count_lock = self.today_count.write().unwrap();
        *count_lock += 1;
        let mut total_lock = self.total_count.write().unwrap();
        *total_lock += 1;
        true
    }

    pub fn get_stats(&self) -> (usize, usize) {
        let today = *self.today_count.read().unwrap();
        let total = *self.total_count.read().unwrap();
        (today, total)
    }
}

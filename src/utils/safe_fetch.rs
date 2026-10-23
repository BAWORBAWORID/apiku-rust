use std::net::IpAddr;
use reqwest::{Client, Response};

pub const BLOCKED_HOSTNAMES: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "local",
    "ip6-localhost",
    "ip6-local",
    "broadcasthost",
    "0.0.0.0",
    "metadata.google.internal",
    "instance-metadata",
    "[fd00::]",
];

pub fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // Unique local (fc00::/7)
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // Link-local (fe80::/10)
        }
    }
}

pub fn validate_ssrf_url(url_str: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(url_str).map_err(|e| format!("Invalid URL: {}", e))?;

    let scheme = url.scheme().to_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!("Blocked protocol: {} (only http/https allowed)", scheme));
    }

    if let Some(host) = url.host_str() {
        let host_lower = host.to_lowercase();
        if BLOCKED_HOSTNAMES.iter().any(|&b| b == host_lower) {
            return Err(format!("Blocked hostname: {}", host_lower));
        }

        // If direct IP in URL
        if let Ok(ip) = host_lower.parse::<IpAddr>() {
            if is_private_ip(&ip) {
                return Err(format!("Blocked private/reserved IP: {}", ip));
            }
        }
    } else {
        return Err("URL has no host".to_string());
    }

    Ok(url)
}

pub async fn safe_fetch(client: &Client, url_str: &str) -> Result<Response, String> {
    let url = validate_ssrf_url(url_str)?;
    client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))
}

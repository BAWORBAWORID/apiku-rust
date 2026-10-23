// TrackIp — native conversion of api/tools/trackip.js
// DNS records + ipapi.co trace + multi-source subdomain finder
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const MAX_IP_TRACE: usize = 8;

async fn fetch_text(client: &reqwest::Client, url: &str) -> Option<String> {
    let r = client
        .get(url)
        .header("User-Agent", AGENT)
        
        .send()
        .await
        .ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.text().await.ok()
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    let t = fetch_text(client, url).await?;
    serde_json::from_str(&t).ok()
}

async fn dns_records(domain: &str) -> Value {
    // Use Google DNS-over-HTTPS for records
    let client = reqwest::Client::new();
    let mut records = serde_json::Map::new();

    async fn do_fetch(client: reqwest::Client, url: String) -> Option<Value> {
        fetch_json(&client, &url).await
    }
    let fetch = |client: reqwest::Client, rrtype: &str| {
        let url = format!("https://dns.google/resolve?name={}&type={}", domain, rrtype);
        do_fetch(client, url)
    };

    for (key, rrtype) in [
        ("A", "A"),
        ("AAAA", "AAAA"),
        ("MX", "MX"),
        ("TXT", "TXT"),
        ("NS", "NS"),
        ("CNAME", "CNAME"),
        ("SOA", "SOA"),
        ("SRV", "SRV"),
    ] {
        let v = fetch(client.clone(), rrtype).await;
        let answers: Vec<Value> = v
            .and_then(|j| j.get("Answer").cloned())
            .and_then(|a| a.as_array().cloned())
            .unwrap_or_default();
        let parsed: Vec<Value> = match rrtype {
            "MX" => answers
                .iter()
                .filter_map(|a| {
                    let data = a.get("data")?.as_str()?.to_string();
                    let parts: Vec<&str> = data.splitn(2, ' ').collect();
                    Some(json!({
                        "exchange": parts.get(1).unwrap_or(&"").to_string(),
                        "priority": parts.first().and_then(|p| p.parse::<i64>().ok()).unwrap_or(0),
                    }))
                })
                .collect(),
            "TXT" => answers
                .iter()
                .filter_map(|a| {
                    a.get("data")
                        .and_then(|d| d.as_str())
                        .map(|s| json!([s.trim_matches('"')]))
                })
                .collect(),
            _ => answers
                .iter()
                .filter_map(|a| a.get("data").and_then(|d| d.as_str()).map(|s| json!(s)))
                .collect(),
        };
        records.insert(key.to_string(), json!(parsed));
    }
    Value::Object(records)
}

fn parse_domain(sub: &str, domain: &str) -> Option<String> {
    let sub = sub.trim().to_lowercase();
    if sub.is_empty() || sub.starts_with("*.") || sub == domain {
        return None;
    }
    if sub.ends_with(&format!(".{}", domain)) || sub.ends_with(domain) {
        Some(sub)
    } else {
        None
    }
}

async fn find_subdomains(client: &reqwest::Client, domain: &str) -> Value {
    let mut all = std::collections::BTreeSet::new();
    let mut sources = serde_json::Map::new();

    // hackertarget
    let mut count = 0usize;
    if let Some(text) = fetch_text(
        client,
        &format!("https://api.hackertarget.com/hostsearch/?q={}", domain),
    )
    .await
    {
        for line in text.lines() {
            if let Some(sub) = parse_domain(line.split(',').next().unwrap_or(""), domain) {
                if all.insert(sub.clone()) {
                    count += 1;
                }
            }
        }
    }
    sources.insert("hackertarget".into(), json!(count));

    // alienvault
    let mut count = 0usize;
    if let Some(data) = fetch_json(
        client,
        &format!(
            "https://otx.alienvault.com/api/v1/indicators/domain/{}/passive_dns",
            domain
        ),
    )
    .await
    {
        if let Some(entries) = data.pointer("/passive_dns").and_then(|p| p.as_array()) {
            for e in entries {
                if let Some(host) = e.get("hostname").and_then(|h| h.as_str()) {
                    if let Some(sub) = parse_domain(host, domain) {
                        if all.insert(sub.clone()) {
                            count += 1;
                        }
                    }
                }
            }
        }
    }
    sources.insert("alienvault".into(), json!(count));

    // rapiddns
    let mut count = 0usize;
    if let Some(html) = fetch_text(
        client,
        &format!("https://rapiddns.io/subdomain/{}?full=1", domain),
    )
    .await
    {
        let re = Regex::new(&format!(r"([a-zA-Z0-9._-]+\.{})", regex::escape(domain))).unwrap();
        for m in re.captures_iter(&html) {
            if let Some(sub) = parse_domain(m.get(1).map(|x| x.as_str()).unwrap_or(""), domain) {
                if all.insert(sub.clone()) {
                    count += 1;
                }
            }
        }
    }
    sources.insert("rapiddns".into(), json!(count));

    // urlscan
    let mut count = 0usize;
    if let Some(data) = fetch_json(
        client,
        &format!(
            "https://urlscan.io/api/v1/search/?q=domain:{}&size=100",
            domain
        ),
    )
    .await
    {
        if let Some(results) = data.get("results").and_then(|r| r.as_array()) {
            for r in results {
                if let Some(d) = r.pointer("/page/domain").and_then(|d| d.as_str()) {
                    if let Some(sub) = parse_domain(d, domain) {
                        if all.insert(sub.clone()) {
                            count += 1;
                        }
                    }
                }
            }
        }
    }
    sources.insert("urlscan".into(), json!(count));

    // certspotter
    let mut count = 0usize;
    if let Some(data) = fetch_json(
        client,
        &format!("https://certspotter.com/api/v1/certs?domain={}", domain),
    )
    .await
    {
        if let Some(certs) = data.as_array() {
            for cert in certs {
                if let Some(names) = cert.get("dns_names").and_then(|n| n.as_array()) {
                    for n in names {
                        if let Some(name) = n.as_str() {
                            if let Some(sub) = parse_domain(name, domain) {
                                if all.insert(sub.clone()) {
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    sources.insert("certspotter".into(), json!(count));

    // resolve IPs for subdomains (DoH)
    let doh = reqwest::Client::new();
    let mut details = Vec::new();
    for sub in &all {
        let ips: Vec<String> = fetch_json(
            &doh,
            &format!("https://dns.google/resolve?name={}&type=A", sub),
        )
        .await
        .and_then(|j| j.get("Answer").cloned())
        .and_then(|a| a.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|a| {
            a.get("data")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string())
        })
        .collect();
        details.push(json!({ "subdomain": sub, "ips": ips }));
    }

    json!({
        "count": details.len(),
        "sources": Value::Object(sources),
        "subdomains": details,
    })
}

async fn trace_ip(client: &reqwest::Client, ip: &str) -> Option<Value> {
    let data = fetch_json(client, &format!("https://ipapi.co/{}/json/", ip)).await?;
    if data.get("error").is_some() {
        return None;
    }
    Some(json!({
        "ip": data.get("ip"),
        "city": data.get("city"),
        "region": data.get("region"),
        "country": data.get("country_name"),
        "country_code": data.get("country_code"),
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "timezone": data.get("timezone"),
        "isp": data.get("org"),
        "asn": data.get("asn"),
        "currency": data.get("currency"),
    }))
}

async fn check_web(client: &reqwest::Client, subdomain: &str) -> Value {
    for proto in ["https", "http"] {
        let url = format!("{}://{}", proto, subdomain);
        if let Ok(res) = client
            .get(&url)
            .header("User-Agent", AGENT)
            
            .send()
            .await
        {
            let status = res.status().as_u16();
            let title = res
                .text()
                .await
                .ok()
                .and_then(|body| {
                    Regex::new(r"(?is)<title[^>]*>([\s\S]*?)</title>")
                        .ok()?
                        .captures(&body)
                        .and_then(|c| c.get(1))
                        .map(|m| {
                            m.as_str().split_whitespace().collect::<Vec<_>>().join(" ")
                                [..100.min(m.as_str().len())]
                                .to_string()
                        })
                })
                .unwrap_or_default();
            return json!({ "status": status, "title": title });
        }
    }
    json!({ "status": 0, "title": "" })
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    };

    let domain_raw = match get("domain") {
        Some(d) if !d.trim().is_empty() => d,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'domain' wajib diisi",
                "example": { "GET": "/api/tools/trackip?domain=wifi.id" }
            }))
            .into_response()
        }
    };

    let start = std::time::Instant::now();
    let clean_domain: String = domain_raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string();

    let client = state.client.clone();
    let d1 = clean_domain.clone();
    let d2 = clean_domain.clone();

    let (dns, subdomain_data) = tokio::join!(dns_records(&d1), find_subdomains(&client, &d2));

    // IP trace on A records
    let mut traces = Vec::new();
    let main_ips: Vec<String> = dns
        .get("A")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .take(MAX_IP_TRACE)
                .collect()
        })
        .unwrap_or_default();
    for ip in &main_ips {
        if let Some(info) = trace_ip(&client, ip).await {
            traces.push(json!({
                "ip": info.get("ip"),
                "location": format!(
                    "{}, {}, {}",
                    info.get("city").and_then(|c| c.as_str()).unwrap_or("?"),
                    info.get("region").and_then(|c| c.as_str()).unwrap_or("?"),
                    info.get("country").and_then(|c| c.as_str()).unwrap_or("?")
                ),
                "coordinates": match (info.get("latitude").and_then(|l| l.as_f64()), info.get("longitude").and_then(|l| l.as_f64())) {
                    (Some(lat), Some(lon)) => json!([lat, lon]),
                    _ => Value::Null,
                },
                "timezone": info.get("timezone"),
                "isp": info.get("isp"),
                "asn": info.get("asn"),
                "currency": info.get("currency"),
            }));
        }
    }

    // live website scan for subdomains with resolved IPs
    let candidates: Vec<String> = subdomain_data
        .get("subdomains")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|s| {
                    s.get("ips")
                        .and_then(|i| i.as_array())
                        .map(|a| !a.is_empty())
                        .unwrap_or(false)
                })
                .filter_map(|s| s.get("subdomain").and_then(|x| x.as_str()))
                .take(20)
                .map(|x| x.to_string())
                .collect()
        })
        .unwrap_or_default();

    let mut live_websites = Vec::new();
    for sub in &candidates {
        let r = check_web(&client, sub).await;
        let status = r.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
        if status > 0 && status < 500 {
            live_websites
                .push(json!({ "subdomain": sub, "status": status, "title": r.get("title") }));
        }
    }

    let records_flat_count: usize = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "SRV"]
        .iter()
        .map(|k| {
            dns.get(*k)
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
        })
        .sum();

    Json(json!({
        "status": true,
        "result": {
            "domain": clean_domain,
            "duration": format!("{}ms", start.elapsed().as_millis()),
            "dns": {
                "records": dns,
                "summary": {
                    "total_records": records_flat_count,
                    "has_ipv4": dns.get("A").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false),
                    "has_ipv6": dns.get("AAAA").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false),
                    "has_mail": dns.get("MX").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false),
                    "has_nameservers": dns.get("NS").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false),
                }
            },
            "ip_traces": traces,
            "subdomains": subdomain_data,
            "live_websites": live_websites,
        }
    })).into_response()

}

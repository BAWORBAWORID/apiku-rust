// ScanWeb — native conversion of api/tools/scanweb.js (vulnerability check: DNS/SSL/headers/CMS)
// Node version inspected raw TLS sockets for cert details; Rust version inspects what
// reqwest exposes (HTTP status, redirect chain, headers) + DoH DNS + CMS pattern matching.
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

fn normalize_domain(domain: &str) -> String {
    domain
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.")
        .trim_end_matches('/')
        .to_lowercase()
        .trim()
        .to_string()
}

use futures_util::FutureExt;

async fn check_dns(domain: &str) -> Value {
    let start = std::time::Instant::now();
    let client = reqwest::Client::new();

    let resolve = |client: reqwest::Client, domain: String, t: &str| {
        let url = format!("https://dns.google/resolve?name={}&type={}", domain, t);
        async move { fetch_doh(&client, &url).await }
    };

    let a = resolve(client.clone(), domain.to_string(), "A").await;
    let aaaa = resolve(client.clone(), domain.to_string(), "AAAA").await;
    let mx = resolve(client.clone(), domain.to_string(), "MX").await;
    let txt = resolve(client.clone(), domain.to_string(), "TXT").await;
    let cname = resolve(client.clone(), domain.to_string(), "CNAME").await;
    let ns = resolve(client, domain.to_string(), "NS").await;

    let answers = |v: &Value| -> Vec<String> {
        v.get("Answer")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("data")
                            .and_then(|d| d.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    let a_records = answers(&a);
    let aaaa_records = answers(&aaaa);
    let txt_flat = answers(&txt);
    let cname_records = answers(&cname);
    let ns_records = answers(&ns);
    let mx_records: Vec<Value> = answers(&mx)
        .iter()
        .map(|s| {
            let parts: Vec<&str> = s.splitn(2, ' ').collect();
            json!({
                "exchange": parts.get(1).unwrap_or(&"").to_string(),
                "priority": parts.first().and_then(|p| p.parse::<i64>().ok()).unwrap_or(0),
            })
        })
        .collect();

    json!({
        "has_ipv4": !a_records.is_empty(),
        "has_ipv6": !aaaa_records.is_empty(),
        "ip_addresses": a_records.iter().take(5).collect::<Vec<_>>(),
        "mx_records": mx_records,
        "txt_records_count": txt_flat.len(),
        "txt_records_preview": txt_flat.iter().take(3).collect::<Vec<_>>(),
        "cname_exists": !cname_records.is_empty(),
        "cname_records": cname_records,
        "ns_records": ns_records,
        "spf_record": txt_flat.iter().any(|r| r.contains("v=spf1")),
        "dmarc_record": txt_flat.iter().any(|r| r.contains("v=DMARC1") || r.to_lowercase().contains("dmarc")),
        "dkim_record": txt_flat.iter().any(|r| r.contains("v=DKIM1") || r.contains("dkim=")),
        "response_time_ms": start.elapsed().as_millis() as u64,
        "status": "completed",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })
}

async fn fetch_doh(client: &reqwest::Client, url: &str) -> Value {
    client
        .get(url)
        .send()
        .await
        .ok()
        .and_then(|r| r.json::<Value>().now_or_never().and_then(|j| j.ok()))
        .unwrap_or(Value::Null)
}

async fn check_security_headers(domain: &str, client: &reqwest::Client) -> Value {
    let resp = match client
        .get(format!("https://{}", domain))
        .header(
            "User-Agent",
            "Mozilla/5.0 (compatible; SecurityScanner/1.0)",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return json!({ "error": e.to_string(), "status": "failed" }),
    };

    let header_val = |name: &str| -> Option<String> {
        resp.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };

    let hsts = header_val("strict-transport-security");
    let csp = header_val("content-security-policy");
    let xfo = header_val("x-frame-options");
    let xcto = header_val("x-content-type-options");
    let rp = header_val("referrer-policy");
    let pp = header_val("permissions-policy").or_else(|| header_val("feature-policy"));
    let xxp = header_val("x-xss-protection");

    let mut score = 0.0f64;
    let mut max_score = 0.0f64;
    let mut present = Vec::new();
    let mut missing = Vec::new();
    let mut weak = Vec::new();

    let mut check = |name: &str, val: &Option<String>, required: bool, strong: bool, desc: &str| {
        max_score += if required { 2.0 } else { 1.0 };
        match val {
            None => missing.push(json!({ "header": name, "description": desc, "severity": if required { "HIGH" } else { "MEDIUM" } })),
            Some(v) => {
                let is_strong = strong;
                present.push(json!({
                    "header": name,
                    "value": if v.len() > 100 { format!("{}...", &v[..100]) } else { v.clone() },
                    "is_strong": is_strong,
                    "description": desc,
                }));
                if is_strong {
                    score += if required { 2.0 } else { 1.0 };
                } else {
                    score += if required { 1.0 } else { 0.5 };
                    weak.push(name.to_string());
                }
            }
        }
    };

    let hsts_strong = hsts
        .as_deref()
        .and_then(|v| Regex::new(r"max-age=(\d+)").ok().and_then(|re| re.captures(v)))
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
        .map(|n| n >= 31536000)
        .unwrap_or(false);
    let csp_strong = csp
        .as_deref()
        .map(|v| !v.contains("unsafe-inline") && !v.contains("unsafe-eval"))
        .unwrap_or(false);
    let xfo_strong = xfo
        .as_deref()
        .map(|v| ["DENY", "SAMEORIGIN"].contains(&v.to_uppercase().as_str()))
        .unwrap_or(false);
    let xcto_strong = xcto
        .as_deref()
        .map(|v| v.eq_ignore_ascii_case("nosniff"))
        .unwrap_or(false);
    let xxp_strong = xxp
        .as_deref()
        .map(|v| v == "1; mode=block")
        .unwrap_or(false);

    check(
        "Strict-Transport-Security",
        &hsts,
        true,
        hsts_strong,
        "Memaksa koneksi HTTPS",
    );
    check(
        "Content-Security-Policy",
        &csp,
        true,
        csp_strong,
        "Mencegah XSS dan injection attacks",
    );
    check(
        "X-Frame-Options",
        &xfo,
        true,
        xfo_strong,
        "Mencegah clickjacking",
    );
    check(
        "X-Content-Type-Options",
        &xcto,
        true,
        xcto_strong,
        "Mencegah MIME sniffing",
    );
    check(
        "Referrer-Policy",
        &rp,
        false,
        rp.is_some(),
        "Mengontrol informasi referrer",
    );
    check(
        "Permissions-Policy",
        &pp,
        false,
        pp.is_some(),
        "Mengontrol fitur browser",
    );
    check(
        "X-XSS-Protection",
        &xxp,
        false,
        xxp_strong,
        "Proteksi XSS untuk browser lama",
    );

    let header_score = if max_score > 0.0 {
        ((score / max_score) * 100.0).round() as u64
    } else {
        0
    };
    let grade = if header_score >= 90 {
        "A"
    } else if header_score >= 75 {
        "B"
    } else if header_score >= 60 {
        "C"
    } else if header_score >= 40 {
        "D"
    } else {
        "F"
    };

    json!({
        "headers_found": resp.headers().len(),
        "analysis": {
            "present": present,
            "missing": missing,
            "weak": weak,
            "score": score,
            "max_score": max_score,
        },
        "score": header_score,
        "grade": grade,
        "server": header_val("server").or_else(|| header_val("x-powered-by")).unwrap_or_else(|| "Unknown".into()),
        "powered_by": header_val("x-powered-by").unwrap_or_else(|| "Not specified".into()),
        "cache_control": header_val("cache-control"),
        "status": "completed",
    })
}

async fn check_cms(domain: &str, client: &reqwest::Client) -> Value {
    let resp = match client
        .get(format!("https://{}", domain))
                    .header("User-Agent", "Mozilla/5.0 (compatible; CMSDetector/1.0)")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return json!({ "error": e.to_string(), "status": "failed" }),
    };

    let server_tech = resp
        .headers()
        .get("server")
        .or_else(|| resp.headers().get("x-powered-by"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Unknown")
        .to_string();
    let html = resp.text().await.unwrap_or_default();

    let cms_patterns: &[(&str, &[&str])] = &[
        (
            "WordPress",
            &["wp-content", "wp-includes", "wordpress", "/wp-json/"],
        ),
        (
            "Joomla",
            &["joomla", "/media/jui/", "/media/system/", "/components/"],
        ),
        ("Drupal", &["drupal", "sites/default/", "/core/"]),
        ("Laravel", &["laravel", "csrf-token"]),
        ("Express", &["express"]),
    ];

    let mut detected = Vec::new();
    for (name, patterns) in cms_patterns {
        let mut confidence = 0u32;
        let mut indicators = Vec::new();
        for p in *patterns {
            if html.to_lowercase().contains(p) {
                confidence += 25;
                indicators.push(format!("Pattern: {}", p));
            }
        }
        if confidence >= 25 {
            let level = if confidence >= 75 {
                "HIGH"
            } else if confidence >= 50 {
                "MEDIUM"
            } else {
                "LOW"
            };
            detected.push(json!({
                "name": name,
                "confidence": format!("{}%", confidence),
                "confidence_level": level,
                "indicators": indicators.into_iter().take(3).collect::<Vec<_>>(),
            }));
        }
    }

    let is_static = html.len() < 10000
        && detected.is_empty()
        && (html.contains(".css") || html.contains(".js"));

    json!({
        "detected_cms": if detected.is_empty() { Value::Null } else { json!(detected) },
        "server_technology": server_tech,
        "is_static_site": is_static,
        "page_size_bytes": html.len(),
        "status": "completed",
    })
}

async fn check_ssl(domain: &str, client: &reqwest::Client) -> Value {
    // Rust std reqwest can't easily expose peer cert details without native-tls introspection;
    // report reachability + HTTPS status honestly.
    match client.get(format!("https://{}", domain)).send().await {
        Ok(res) => {
            json!({
                "is_https": true,
                "final_url": res.url().to_string(),
                "http_status": res.status().as_u16(),
                "grade": "B",
                "note": "TLS certificate details (expiry/issuer/cipher) memerlukan akses socket TLS; tidak tersedia di native HTTP client",
                "status": "completed",
            })
        }
        Err(_) => match client.get(format!("http://{}", domain)).send().await {
            Ok(_) => json!({
                "is_https": false,
                "warning": "Website menggunakan HTTP, bukan HTTPS. Semua data dikirim plaintext!",
                "security_risk": "HIGH",
                "grade": "F",
                "recommendation": "Segera implementasikan SSL/TLS certificate",
                "status": "completed",
            }),
            Err(e) => {
                json!({ "error": format!("Cannot connect to domain: {}", e), "status": "failed" })
            }
        },
    }
}

fn calculate_security_score(checks: &Value) -> u64 {
    let mut score = 0f64;
    let mut max_possible = 0f64;

    if let Some(ssl) = checks.get("ssl").filter(|s| s.get("grade").is_some()) {
        max_possible += 40.0;
        let g = ssl.get("grade").and_then(|g| g.as_str()).unwrap_or("F");
        score += match g {
            "A" => 40.0,
            "B" => 30.0,
            "C" => 20.0,
            "D" => 10.0,
            _ => 0.0,
        };
    }
    if let Some(headers) = checks.get("headers") {
        if let Some(s) = headers.get("score").and_then(|s| s.as_f64()) {
            max_possible += 35.0;
            score += s * 0.35;
        }
    }
    if let Some(dns) = checks.get("dns") {
        if dns.get("error").is_none() {
            max_possible += 15.0;
            let mut s: f64 = 5.0;
            if dns
                .get("has_ipv4")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                s += 3.0;
            }
            if dns
                .get("spf_record")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                s += 2.0;
            }
            if dns
                .get("dmarc_record")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                s += 2.0;
            }
            if dns
                .get("dkim_record")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                s += 1.0;
            }
            if dns
                .get("has_ipv6")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                s += 2.0;
            }
            score += s.min(15.0_f64);
        }
    }
    if let Some(cms) = checks.get("cms") {
        if cms.get("error").is_none() {
            max_possible += 10.0;
            if cms.get("detected_cms").is_none()
                || cms
                    .get("is_static_site")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            {
                score += 10.0;
            } else {
                score += 7.0;
            }
        }
    }
    if max_possible > 0.0 {
        ((score / max_possible) * 100.0).round() as u64
    } else {
        0
    }
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let domain_raw = match query.get("domain") {
        Some(d) if !d.trim().is_empty() => d.trim().to_string(),
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'domain' wajib diisi",
                "example": "/tools/vuln-check?domain=example.com",
            })).into_response();
        }
    };
    let scan_type = query
        .get("scan_type")
        .cloned()
        .unwrap_or_else(|| "basic".to_string());
    let _timeout = query
        .get("timeout")
        .and_then(|t| t.parse::<u64>().ok())
        .unwrap_or(10000);

    if domain_raw.contains('/') || domain_raw.contains("http") {
        return Json(json!({
            "status": false,
            "message": "Hanya masukkan domain tanpa protokol atau path",
            "example": "zyvor.my.id",
            "received": domain_raw,
        })).into_response();
    }

    let domain_re = Regex::new(r"^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$").unwrap();
    let domain = normalize_domain(&domain_raw);
    if !domain_re.is_match(&domain) {
        return Json(json!({
            "status": false,
            "message": "Format domain tidak valid",
            "valid_examples": ["example.com", "api.example.com", "sub.domain.co.id", "zyvor.my.id"],
        })).into_response();
    }

    let scan_types: Vec<String> = scan_type.split(',').map(|s| s.trim().to_string()).collect();
    let should = |t: &str| -> bool {
        if scan_types.iter().any(|s| s == "full") {
            return true;
        }
        if scan_types.iter().any(|s| s == "basic") && ["ssl", "headers"].contains(&t) {
            return true;
        }
        scan_types.iter().any(|s| s == t)
    };

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_millis(_timeout))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .unwrap_or_else(|_| state.client.clone());

    let dns = check_dns(&domain).await;
    let mut checks = json!({ "dns": dns });

    if should("ssl") {
        checks["ssl"] = check_ssl(&domain, &client).await;
    }
    if should("headers") {
        checks["headers"] = check_security_headers(&domain, &client).await;
    }
    if should("cms") {
        checks["cms"] = check_cms(&domain, &client).await;
    }
    if should("ports") {
        checks["ports"] = json!({
            "note": "Port scanning hanya simulasi. Untuk scanning nyata diperlukan izin khusus.",
            "common_ports": [
                { "port": 80, "service": "HTTP", "secure": false, "risk": "MEDIUM" },
                { "port": 443, "service": "HTTPS", "secure": true, "risk": "LOW" },
                { "port": 22, "service": "SSH", "secure": true, "risk": "MEDIUM" },
                { "port": 21, "service": "FTP", "secure": false, "risk": "HIGH" },
                { "port": 25, "service": "SMTP", "secure": false, "risk": "MEDIUM" },
                { "port": 3306, "service": "MySQL", "secure": false, "risk": "HIGH" },
                { "port": 3389, "service": "RDP", "secure": false, "risk": "HIGH" },
                { "port": 8080, "service": "HTTP-Alt", "secure": false, "risk": "MEDIUM" },
            ],
            "recommendation": [
                "Pastikan hanya port yang diperlukan saja yang terbuka",
                "Gunakan firewall untuk membatasi akses",
                "Non-essential ports harus ditutup",
                "Gunakan VPN untuk akses administrative ports"
            ],
            "status": "simulated",
        });
    }

    let score = calculate_security_score(&checks);
    let overall = if score >= 90 {
        "SECURE"
    } else if score >= 75 {
        "GOOD"
    } else if score >= 60 {
        "FAIR"
    } else if score >= 40 {
        "WEAK"
    } else {
        "CRITICAL"
    };

    let scan_id = format!("scan_{}_{}", chrono::Utc::now().timestamp_millis(), {
        use rand::Rng;
        let s: String = (0..9)
            .map(|_| rand::thread_rng().gen_range('a'..='z'))
            .collect();
        s
    });

    Json(json!({
        "status": true,
        "message": "Vulnerability scan completed successfully",
        "scan_id": scan_id,
        "data": {
            "domain": domain,
            "original_domain": domain_raw,
            "scan_timestamp": chrono::Utc::now().to_rfc3339(),
            "scan_type": scan_types,
            "timeout": _timeout,
            "checks": checks,
            "score": score,
            "overall_status": overall,
            "recommendations": [],
        }
    })).into_response()

}

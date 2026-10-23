// Murotal Quran — native conversion of api/search/murotal-quran.js
// Fuzzy-match qari + surat dari daftar GitHub, lalu stream audio mp3quran.net.
// Hasil audio dikirim langsung sebagai body respons (Content-Type audio/*).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

const MUROTAL_TXT: &str = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/murotal-list.txt";
const SURAT_TXT: &str = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/surat-list-sds.txt";
const BASE: &str = "https://www.mp3quran.net";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

type MurotalList = Vec<(String, String)>;
type SuratList = Vec<(String, String, String, Option<String>, String)>; // (number, name, clean, meaning, download)

fn normalize(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ('\u{0300}'..='\u{036f}').contains(&ch) {
            continue;
        }
        out.push(ch);
    }
    let lowered = out.to_lowercase().replace(['\'', '\u{2018}', '\u{2019}', '`', '\u{00b4}'], "").replace('&', "and");
    lowered
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || ('\u{0600}'..='\u{06ff}').contains(c))
        .collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = normalize(a).chars().collect();
    let b: Vec<char> = normalize(b).chars().collect();
    let mut dp: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = dp[0];
        dp[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            let cur = (dp[j] + 1).min(dp[j - 1] + 1).min(prev + cost);
            prev = dp[j];
            dp[j] = cur;
        }
    }
    dp[b.len()]
}

fn score(input: &str, target: &str) -> f64 {
    let a = normalize(input);
    let b = normalize(target);
    if a.is_empty() || b.is_empty() {
        return 999999.0;
    }
    if a == b {
        return 0.0;
    }
    if b.contains(&a) || a.contains(&b) {
        return 1.0;
    }
    levenshtein(input, target) as f64 / a.len().max(b.len()).max(1) as f64
}

fn parse_murotal_list(text: &str) -> MurotalList {
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let mut name: Option<String> = None;
        let mut slug: Option<String> = None;
        for line in block.lines() {
            let l = line.trim();
            if let Some(rest) = l.strip_prefix("Slug:") {
                slug = Some(rest.trim().to_string());
            } else if let Some(idx) = l.find(". ") {
                if l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                    name = Some(l[idx + 2..].trim().to_string());
                }
            }
        }
        if let (Some(n), Some(s)) = (name, slug) {
            out.push((n, s));
        }
    }
    out
}

fn extract_paren_name(name: &str) -> (String, Option<String>) {
    if name.ends_with(')') {
        if let Some(p) = name.rfind('(') {
            let clean = name[..p].trim().to_string();
            let meaning = name[p + 1..name.len() - 1].trim().to_string();
            return (clean, Some(meaning));
        }
    }
    (name.to_string(), None)
}

fn parse_surat_list(text: &str) -> SuratList {
    let mut out: SuratList = Vec::new();
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    for (i, line) in lines.iter().enumerate() {
        let num: String = line.chars().take_while(|c| c.is_ascii_digit()).collect();
        if num.len() != 3 || !line[num.len()..].starts_with(". ") {
            continue;
        }
        let number = num.clone();
        let name = line[num.len() + 2..].trim().to_string();

        let mut download: Option<String> = None;
        if let Some(idx) = line.rfind('|') {
            let tail = line[idx + 1..].trim();
            if tail.starts_with("http") {
                download = Some(tail.to_string());
            }
        }
        if download.is_none() {
            for nxt in lines.iter().skip(i + 1).take(4) {
                for prefix in ["Download:", "Audio:", "download:", "audio:"] {
                    if let Some(rest) = nxt.strip_prefix(prefix) {
                        let d = rest.trim().to_string();
                        if d.starts_with("http") {
                            download = Some(d);
                        }
                        break;
                    }
                }
                if download.is_some() {
                    break;
                }
            }
        }
        if let Some(d) = download {
            let (clean, meaning) = extract_paren_name(&name);
            out.push((number, name.clone(), clean, meaning, d));
        }
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|(n, _, _, _, _)| seen.insert(n.clone()));
    out
}

async fn load_lists() -> Result<(MurotalList, SuratList), String> {
    static CACHE: OnceLock<(MurotalList, SuratList)> = OnceLock::new();
    if let Some(c) = CACHE.get() {
        return Ok(c.clone());
    }
    let client = reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let (m, s) = tokio::join!(client.get(MUROTAL_TXT).send(), client.get(SURAT_TXT).send());
    let mtext = m.and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let stext = s.and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let murotal = parse_murotal_list(&mtext);
    let surat = parse_surat_list(&stext);
    if murotal.is_empty() {
        return Err("Gagal memuat daftar murotal".into());
    }
    if surat.is_empty() {
        return Err("Gagal memuat daftar surat".into());
    }
    let _ = CACHE.set((murotal.clone(), surat.clone()));
    Ok((murotal, surat))
}

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k).cloned() {
                if !v.is_empty() {
                    return Some(v);
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(s) = v.get(*k).and_then(Value::as_str) {
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
        None
    };

    let murotal_input = match get_param(&["murotal", "qari", "reciter"]) {
        Some(v) => v,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'murotal' dan 'surat' wajib diisi"),
    };
    let surat_input = match get_param(&["surat", "surah", "ayat"]) {
        Some(v) => v,
        None => return err(StatusCode::BAD_REQUEST, "Parameter 'murotal' dan 'surat' wajib diisi"),
    };

    let (murotals, surats) = match load_lists().await {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let mut best_q: Option<(f64, &(String, String))> = None;
    for item in &murotals {
        let s = score(&murotal_input, &item.0).min(score(&murotal_input, &item.1));
        if best_q.map(|(bs, _)| s < bs).unwrap_or(true) {
            best_q = Some((s, item));
        }
    }
    let qari = match best_q {
        Some((_, it)) => it,
        None => return err(StatusCode::NOT_FOUND, "Qari tidak ditemukan"),
    };

    let surah = if !surat_input.is_empty() && surat_input.chars().all(|c| c.is_ascii_digit()) {
        surats.iter().find(|(n, _, _, _, _)| *n == surat_input)
    } else {
        let mut best_s: Option<(f64, usize)> = None;
        for (idx, item) in surats.iter().enumerate() {
            let s = score(&surat_input, &item.1)
                .min(score(&surat_input, &item.2))
                .min(item.3.as_deref().map(|m| score(&surat_input, m)).unwrap_or(999999.0))
                .min(score(&surat_input, &item.0));
            if best_s.map(|(bs, _)| s < bs).unwrap_or(true) {
                best_s = Some((s, idx));
            }
        }
        best_s.map(|(_, idx)| &surats[idx])
    };
    let surah = match surah {
        Some(s) => s,
        None => return err(StatusCode::NOT_FOUND, "Surat tidak ditemukan"),
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let audio = match client
        .get(&surah.4)
        .header("referer", BASE)
                    .header("range", "bytes=0-")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mengambil data murotal: {e}")),
    };

    if !audio.status().is_success() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Gagal memuat audio dari upstream");
    }

    let content_type = audio
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();

    let bytes = match audio.bytes().await {
        Ok(b) => b,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal memuat audio dari upstream: {e}")),
    };

    (
        [
            ("Content-Type", content_type),
            ("X-Generated-In", format!("{}ms", started.elapsed().as_millis())),
            ("X-Qari", urlencoding::encode(&qari.0).to_string()),
            ("X-Surat", urlencoding::encode(&surah.1).to_string()),
        ],
        bytes,
    )
        .into_response()
}

// MediaFire Downloader — native conversion of api/downloader/mediafire.js
// Node version used Playwright (headless browser) to extract from DOM selectors.
// Rust version uses pure HTTP: the key data (download button href, filename, size)
// lives in the HTML itself, so regex extraction on the fetched page is equivalent
// for link/size; filename falls back to the URL path segment like mediafirev2.
//
// Response format (v1, sama seperti Node):
// { "status": true, "data": { filename, filesize, mimetype, link, ext } }
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "zip" => "application/zip",
        "rar" => "application/x-rar-compressed",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "apk" => "application/vnd.android.package-archive",
        "exe" => "application/x-msdownload",
        "msi" => "application/x-msi",
        "deb" => "application/x-deb",
        "rpm" => "application/x-rpm",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "txt" => "text/plain",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn unescape_html(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .trim()
        .to_string()
}

/// Find text between a literal marker and the next '<' (mimics simple DOM text extraction).
fn find_one<'a>(html: &'a str, patterns: &[&str]) -> Option<String> {
    for p in patterns {
        if let Some(idx) = html.find(p) {
            let start = idx + p.len();
            if let Some(end_rel) = html[start..].find('<') {
                let candidate = html[start..start + end_rel].trim();
                if !candidate.is_empty() {
                    return Some(unescape_html(candidate));
                }
            }
        }
    }
    None
}

/// Extract href of the download button (`#downloadButton` in the served HTML).
fn extract_download_link(html: &str) -> Option<String> {
    // Collect (pos, href) for all href="..." occurrences.
    let hrefs = |html: &str| -> Vec<(usize, String)> {
        let mut out = Vec::new();
        let bytes = html.as_bytes();
        let mut i = 0;
        while i + 6 <= bytes.len() {
            if &html[i..i + 6] == "href=\"" {
                let start = i + 6;
                if let Some(end) = html[start..].find('"') {
                    out.push((i, html[start..start + end].to_string()));
                    i = start + end + 1;
                    continue;
                }
            }
            i += 1;
        }
        out
    };

    let valid = |h: &str| h.starts_with("http") && !h.contains("javascript:");

    // Primary: href ... id="downloadButton" (attribute order as in Node v2)
    if let Some(idx) = html.find("id=\"downloadButton\"") {
        for (pos, href) in hrefs(&html[..idx]).into_iter().rev() {
            let _ = pos;
            if valid(&href) {
                return Some(unescape_html(&href));
            }
        }
    }
    // Alternative: aria-label download anchor
    if let Some(idx) = html.find("aria-label=\"Download") {
        for (pos, href) in hrefs(&html[..idx]).into_iter().rev() {
            let _ = pos;
            if valid(&href) {
                return Some(unescape_html(&href));
            }
        }
    }
    // Fallback: any downloadNNN.mediafire.com direct link
    for (pos, href) in hrefs(html) {
        if href.contains("mediafire.com") && href.contains("/download") || href.starts_with("https://download") {
            let _ = pos;
            return Some(unescape_html(&href));
        }
    }
    None
}

fn filename_from_url(url: &str) -> Option<String> {
    // path = /file/<key>/<name>(/file)?
    let path = url.split("mediafire.com").nth(1)?;
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    // parts: ["file", key, name, ...]
    if parts.len() >= 3 && parts[0] == "file" && parts[2] != "file" {
        return Some(urldecode(parts[2]).unwrap_or_else(|| parts[2].to_string()));
    }
    None
}

fn urldecode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                let b = u8::from_str_radix(hex, 16).ok()?;
                out.push(b);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Scan raw HTML for a "NN.NN (KB|MB|GB)" filesize mention (Node v1 fallback behaviour).
fn scan_filesize(html: &str) -> Option<String> {
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let rest = &html[i..];
            let unit_pos = [" KB", " MB", " GB", "KB", "MB", "GB"]
                .iter()
                .filter_map(|u| rest.find(u))
                .min()?;
            // take up to ~12 chars before unit, trim to the number start
            let seg = &rest[..unit_pos + 3];
            let num_start = seg
                .char_indices()
                .rev()
                .take(14)
                .find(|(_, c)| !c.is_ascii_digit() && *c != '.' && *c != ' ' && *c != '(')
                .map(|(idx, _)| idx + 1)
                .unwrap_or(0);
            let candidate = seg[num_start..].trim().trim_start_matches('(').trim();
            if candidate.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                && candidate.len() <= 14
            {
                return Some(candidate.to_string());
            }
            i += unit_pos + 3;
        } else {
            i += 1;
        }
    }
    None
}

fn scrape(html: &str, source_url: &str) -> Value {
    let link = extract_download_link(html);

    // Filename: HTML markers first, then URL segment (v2-style fallback)
    let filename = find_one(
        html,
        &[
            "class=\"filename\">",
            "\"filename\">",
            "class=\"dl-filename\">",
            "class=\"file-title\">",
        ],
    )
    .filter(|s| !s.is_empty() && s != "Unknown")
    .or_else(|| filename_from_url(source_url))
    .unwrap_or_else(|| "Unknown File".to_string());

    let filesize = find_one(
        html,
        &["File size:</dt><dd>", "File size: <span>", "File size:<span>"],
    )
    .or_else(|| scan_filesize(html))
    .unwrap_or_else(|| "Unknown Size".to_string());

    let ext = filename
        .rsplit('.')
        .next()
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    json!({
        "filename": filename,
        "filesize": filesize,
        "mimetype": mime_for_ext(&ext),
        "link": link,
        "ext": ext,
    })
}

fn err_response(message: &str, started: &std::time::Instant) -> Response {
    Json(json!({
        "status": false,
        "duration": format!("{}ms", started.elapsed().as_millis()),
        "message": message,
    })).into_response()

}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();

    // Merge query + JSON body (mirrors `{ ...req.query, ...req.body }`)
    let url_param = query
        .get("url")
        .cloned()
        .or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
        });

    let url = match url_param {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'url' is required"
            }))).into_response()
        }
    };

    if !url.contains("mediafire.com") {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Invalid MediaFire URL"
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return err_response(&format!("MediaFire Scrape Failed: client error {e}"), &started),
    };

    let res = client
        .get(&url)
                    .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("accept-language", "en-US,en;q=0.9")
                    .header("sec-fetch-dest", "document")
                    .header("sec-fetch-mode", "navigate")
                    .header("sec-fetch-site", "none")
                    .header("sec-fetch-user", "?1")
                    .header("upgrade-insecure-requests", "1")
        .send()
        .await;

    let html = match res {
        Ok(r) => match r.text().await {
            Ok(t) => t,
            Err(e) => return err_response(&format!("MediaFire Scrape Failed: read error {e}"), &started),
        },
        Err(e) => return err_response(&format!("MediaFire Scrape Failed: request error {e}"), &started),
    };

    let result = scrape(&html, &url);
    let has_link = result
        .get("link")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if !has_link {
        return err_response(
            "Failed to extract download link (File might be deleted or premium only)",
            &started,
        );
    }

    Json(json!({ "status": true, "data": result })).into_response()
}

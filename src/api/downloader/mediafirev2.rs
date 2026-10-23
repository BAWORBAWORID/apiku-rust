// MediaFire Downloader v2 — native conversion of api/downloader/mediafirev2.js
// Both versions are pure HTTP (Node v2 already used fetch, no browser).
// Response format (v2, sama seperti Node):
// { "status": true, "result": { filename, filesize, mimetype, link, ext,
//   uploaded, filetype, title, description, status }, "provider": "MediaFire",
//   "input": ..., "note": ... }
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
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt" => "text/plain",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "webm" => "video/webm",
        "apk" => "application/vnd.android.package-archive",
        "exe" => "application/x-msdownload",
        "msi" => "application/x-msi",
        "deb" => "application/x-deb",
        "rpm" => "application/x-rpm",
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

/// First match: literal `open` then text until `close`.
fn between<'a>(html: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = html.find(open)? + open.len();
    let end_rel = html[start..].find(close)?;
    Some(&html[start..start + end_rel])
}

fn extract_download_link(html: &str) -> Option<String> {
    // Primary: href="(.+?)" id="downloadButton"
    if let Some(idx) = html.find("id=\"downloadButton\"") {
        if let Some(hidx) = html[..idx].rfind("href=\"") {
            let start = hidx + 6;
            if let Some(end) = html[start..].find('"') {
                let href = &html[start..start + end];
                if href.starts_with("http") {
                    return Some(unescape_html(href));
                }
            }
        }
    }
    // Alternative: href="(https://download...mediafire...)"
    if let Some(idx) = html.find("https://download") {
        let rest = &html[idx..];
        if let Some(end) = rest.find('"') {
            let href = &rest[..end];
            if href.contains("mediafire") {
                return Some(unescape_html(href));
            }
        }
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

fn filename_from_url(url: &str) -> Option<String> {
    let path = url.split("mediafire.com").nth(1)?;
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() >= 3 && parts[0] == "file" && parts[2] != "file" {
        return Some(urldecode(parts[2]).unwrap_or_else(|| parts[2].to_string()));
    }
    if let Some(last) = parts.last() {
        return Some(urldecode(last).unwrap_or_else(|| last.to_string()));
    }
    None
}

fn scrape(html: &str, source_url: &str) -> Value {
    let download_url = extract_download_link(html).unwrap_or_default();

    // filetype: class="filetype"><span>TYPE</span> (SIZE)
    let span = between(html, "class=\"filetype\"><span>", "<").map(unescape_html);
    let size_in_paren = between(html, "class=\"filetype\">", "(")
        .and_then(|s| s.rsplit('<').next().map(|x| x.to_string()));
    let file_type = match (span, size_in_paren) {
        (Some(a), Some(b)) => format!("{a} {}", b.trim()),
        (Some(a), None) => a,
        _ => "Unknown".to_string(),
    };

    // description block
    let desc_block = between(html, "<div class=\"description\">", "</div>");
    let mut title_ext = "No title".to_string();
    let mut description_ext = "No description".to_string();
    if let Some(block) = desc_block {
        if let Some(t) = between(block, "subheading\">", "<") {
            title_ext = unescape_html(t);
        }
        if let Some(d) = between(block, "<p>", "</p>") {
            description_ext = unescape_html(d);
        }
    }

    let file_size = between(html, "File size:</dt><dd>", "</dd>")
        .or_else(|| between(html, "File size: <span>", "</span>"))
        .or_else(|| between(html, "File size:<span>", "</span>"))
        .map(unescape_html)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown".to_string());

    let uploaded = between(html, "Uploaded:</dt><dd>", "</dd>")
        .or_else(|| between(html, "Uploaded: <span>", "</span>"))
        .map(unescape_html)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown".to_string());

    let clean_file_name = between(html, "class=\"filename\">", "</div>")
        .map(unescape_html)
        .filter(|s| !s.is_empty() && *s != "Unknown")
        .or_else(|| filename_from_url(source_url))
        .unwrap_or_else(|| "Unknown".to_string());

    let file_extension = clean_file_name
        .rsplit('.')
        .next()
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    json!({
        "filename": clean_file_name,
        "filesize": file_size,
        "mimetype": mime_for_ext(&file_extension),
        "link": download_url,
        "ext": file_extension,
        "uploaded": uploaded,
        "filetype": file_type,
        "title": title_ext,
        "description": description_ext,
        "status": "active"
    })
}

fn err_response(message: &str, provider: &str, input: &str, started: &std::time::Instant) -> Response {
    Json(json!({
        "status": false,
        "provider": provider,
        "input": input,
        "duration": format!("{}ms", started.elapsed().as_millis()),
        "suggestion": "Check if the URL is correct and the file is still available",
        "message": message,
    })).into_response()

}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let started = std::time::Instant::now();

    let url_param = query.get("url").cloned().or_else(|| {
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

    let client = match reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return err_response(&format!("MediaFire Download Failed: {e}"), "MediaFire", &url, &started),
    };

    let res = client
        .get(&url)
                    .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("accept-language", "en-US,en;q=0.9")
                    .header("cache-control", "no-cache")
                    .header("pragma", "no-cache")
        .header("sec-ch-ua", "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"122\"")
                    .header("sec-ch-ua-mobile", "?0")
        .header("sec-ch-ua-platform", "\"Windows\"")
                    .header("sec-fetch-dest", "document")
                    .header("sec-fetch-mode", "navigate")
                    .header("sec-fetch-site", "none")
                    .header("sec-fetch-user", "?1")
                    .header("upgrade-insecure-requests", "1")
        .send()
        .await;

    let html = match res {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(t) => t,
            Err(e) => return err_response(&format!("MediaFire Download Failed: {e}"), "MediaFire", &url, &started),
        },
        Ok(r) => {
            return err_response(
                &format!("MediaFire page not found or access denied (HTTP {})", r.status().as_u16()),
                "MediaFire",
                &url,
                &started,
            )
        }
        Err(e) => return err_response(&format!("MediaFire Download Failed: {e}"), "MediaFire", &url, &started),
    };

    // No download link at all → page removed/private (Node behaviour)
    if extract_download_link(&html).is_none() {
        return err_response("Download link not found - file may be removed or private", "MediaFire", &url, &started);
    }

    let result = scrape(&html, &url);

    Json(json!({
        "status": true,
        "result": result,
        "provider": "MediaFire",
        "input": url,
        "note": "Use the 'link' field for direct download",
    })).into_response()

}

// YouTube Channel Stalker — native conversion of api/stalker/youtube.js
// Scrapes youtube.com/@<user>, extracts ytInitialData, maps channel metadata
// + latest videos. 10-minute in-memory cache.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

static CACHE: Mutex<Option<HashMap<String, (Value, Instant, u64)>>> = Mutex::new(None);

static EMPTY_VEC: Vec<serde_json::Value> = Vec::new();

fn get_from_cache(username: &str) -> Option<Value> {
    let mut guard = CACHE.lock().ok()?;
    let map = guard.get_or_insert_with(HashMap::new);
    map.retain(|_, v| v.1.elapsed() < CACHE_TTL);
    let key = username.to_lowercase();
    if let Some(entry) = map.get_mut(&key) {
        entry.2 += 1;
        return Some(entry.0.clone());
    }
    None
}

fn save_to_cache(username: &str, data: &Value) {
    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(
            username.to_lowercase(),
            (data.clone(), Instant::now(), 1),
        );
    }
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}

fn extract_yt_initial_data(html: &str) -> Option<Value> {
    let patterns = [
        "var ytInitialData = ",
        "window[\"ytInitialData\"] = ",
        "ytInitialData = ",
    ];
    let mut start_idx = None;
    for p in patterns {
        if let Some(idx) = html.find(p) {
            start_idx = Some(idx + p.len());
            break;
        }
    }
    let start_idx = start_idx?;
    let json_start = html[start_idx..].find('{')? + start_idx;
    let bytes = html.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape = false;
    for i in json_start..bytes.len() {
        let c = bytes[i] as char;
        if escape {
            escape = false;
            continue;
        }
        if c == '\\' && in_string {
            escape = true;
            continue;
        }
        if c == '"' {
            in_string = !in_string;
            continue;
        }
        if !in_string {
            if c == '{' {
                depth += 1;
            } else if c == '}' {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_str(&html[json_start..=i]).ok();
                }
            }
        }
    }
    None
}

fn fmt_sub(t: &str) -> String {
    let re = regex::Regex::new(r"(?i)subscribers?").unwrap();
    re.replace_all(t, "").trim().to_string()
}
fn fmt_vid(t: &str) -> String {
    let re = regex::Regex::new(r"(?i)videos?").unwrap();
    re.replace_all(t, "").trim().to_string()
}

fn walk_paths<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = v;
    for seg in path.split('.') {
        let seg = seg.trim_end_matches("[]");
        cur = cur.get(seg)?;
    }
    Some(cur)
}

fn extract_channel_data(data: &Value, clean_username: &str) -> Value {
    let mut meta = json!({
        "username": Value::Null,
        "name": Value::Null,
        "subscriberCount": "0",
        "videoCount": "0",
        "avatarUrl": Value::Null,
        "channelUrl": Value::Null,
        "description": Value::Null,
        "isVerified": false,
        "joinDate": Value::Null,
    });

    let page_header = walk_paths(data, "header.pageHeaderRenderer.content.pageHeaderViewModel");

    if let Some(ph) = page_header {
        let name = walk_paths(ph, "title.dynamicTextViewModel.text.content")
            .or_else(|| walk_paths(ph, "title.content"))
            .and_then(|v| v.as_str());
        if let Some(n) = name {
            meta["name"] = json!(n);
        }
        let title_str = ph.get("title").map(|t| t.to_string()).unwrap_or_default();
        if title_str.contains("CHECK_CIRCLE_FILLED") || title_str.contains("VERIFIED") {
            meta["isVerified"] = json!(true);
        }
        if let Some(rows) = walk_paths(ph, "metadata.contentMetadataViewModel.metadataRows")
            .and_then(|r| r.as_array())
        {
            for row in rows {
                for part in row
                    .get("metadataParts")
                    .and_then(|p| p.as_array())
                    .unwrap_or(&EMPTY_VEC)
                {
                    let text = part
                        .get("text")
                        .and_then(|t| t.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("");
                    let label = part
                        .get("accessibilityLabel")
                        .and_then(|l| l.as_str())
                        .unwrap_or("");
                    let tl = text.to_lowercase();
                    let ll = label.to_lowercase();
                    if text.starts_with('@') {
                        meta["username"] = json!(text.trim_start_matches('@'));
                    } else if tl.contains("subscriber") || ll.contains("subscriber") {
                        meta["subscriberCount"] = json!(fmt_sub(if text.is_empty() { label } else { text }));
                    } else if tl.contains("video") || ll.contains("video") {
                        meta["videoCount"] = json!(fmt_vid(if text.is_empty() { label } else { text }));
                    }
                }
            }
        }
        if let Some(sources) = walk_paths(
            ph,
            "image.decoratedAvatarViewModel.avatar.avatarViewModel.image.sources",
        )
        .and_then(|s| s.as_array())
        {
            if let Some(last) = sources.last() {
                if let Some(url) = last.get("url").and_then(|u| u.as_str()) {
                    meta["avatarUrl"] = json!(url);
                }
            }
        }
    }

    if let Some(cm) = walk_paths(data, "metadata.channelMetadataRenderer") {
        if meta["name"].is_null() {
            if let Some(t) = cm.get("title").and_then(|t| t.as_str()) {
                meta["name"] = json!(t);
            }
        }
        if meta["username"].is_null() {
            if let Some(vanity) = cm.get("vanityChannelUrl").and_then(|v| v.as_str()) {
                let re = regex::Regex::new(r"@([^/?#]+)").unwrap();
                if let Some(m) = re.captures(vanity).and_then(|c| c.get(1)) {
                    meta["username"] = json!(m.as_str());
                }
            }
        }
        if meta["description"].is_null() {
            meta["description"] = cm.get("description").cloned().unwrap_or(Value::Null);
        }
        if meta["channelUrl"].is_null() {
            meta["channelUrl"] = cm.get("channelUrl").cloned().unwrap_or(Value::Null);
        }
        let title = cm.get("title").and_then(|t| t.as_str()).unwrap_or("");
        let desc = cm.get("description").and_then(|d| d.as_str()).unwrap_or("");
        if title.contains('✓') || desc.contains("verified") {
            meta["isVerified"] = json!(true);
        }
        if meta["avatarUrl"].is_null() {
            if let Some(thumbs) = cm
                .get("avatar")
                .and_then(|a| a.get("thumbnails"))
                .and_then(|t| t.as_array())
            {
                if let Some(last) = thumbs.last() {
                    if let Some(url) = last.get("url").and_then(|u| u.as_str()) {
                        meta["avatarUrl"] = json!(url);
                    }
                }
            }
        }
    }

    if let Some(tabs) = walk_paths(data, "contents.twoColumnBrowseResultsRenderer.tabs")
        .and_then(|t| t.as_array())
    {
        for tab in tabs {
            if let Some(joined) = walk_paths(
                tab,
                "tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].channelAboutFullMetadataRenderer.joinedDateText.content",
            )
            .and_then(|j| j.as_str())
            {
                meta["joinDate"] = json!(joined);
                break;
            }
        }
    }

    if meta["username"].is_null() {
        meta["username"] = json!(clean_username);
    }
    meta
}

fn extract_latest_videos(data: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let Some(tabs) = walk_paths(data, "contents.twoColumnBrowseResultsRenderer.tabs")
        .and_then(|t| t.as_array())
    else {
        return out;
    };
    'outer: for tab in tabs {
        let sections = walk_paths(tab, "tabRenderer.content.sectionListRenderer.contents")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default();
        for section in sections {
            if out.len() >= 5 {
                break 'outer;
            }
            let item_section = walk_paths(&section, "itemSectionRenderer.contents")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default();
            // shelf items or fallback to itemSection contents
            let shelf = item_section.first().and_then(|c| c.get("shelfRenderer"));
            let items: Vec<Value> = shelf
                .and_then(|s| {
                    s.pointer("/content/horizontalListRenderer/items")
                        .or_else(|| s.pointer("/content/gridRenderer/items"))
                })
                .and_then(|i| i.as_array())
                .cloned()
                .unwrap_or(item_section);

            for item in items {
                if out.len() >= 5 {
                    break 'outer;
                }
                // lockupViewModel
                if let Some(lockup) = item.get("lockupViewModel") {
                    if lockup.get("contentType").and_then(|c| c.as_str())
                        != Some("LOCKUP_CONTENT_TYPE_VIDEO")
                    {
                        continue;
                    }
                    let video_id = lockup.get("contentId").cloned().unwrap_or(Value::Null);
                    let title = walk_paths(lockup, "metadata.lockupMetadataViewModel.title.content")
                        .and_then(|t| t.as_str())
                        .unwrap_or("No title");
                    let thumbs = walk_paths(lockup, "contentImage.thumbnailViewModel.image.sources")
                        .and_then(|s| s.as_array());
                    let thumbnail = thumbs
                        .and_then(|s| s.last())
                        .and_then(|t| t.get("url"))
                        .cloned()
                        .unwrap_or(Value::Null);

                    let mut duration = Value::Null;
                    if let Some(overlays) = walk_paths(lockup, "contentImage.thumbnailViewModel.overlays")
                        .and_then(|o| o.as_array())
                    {
                        for o in overlays {
                            if let Some(text) = walk_paths(
                                o,
                                "thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel.text",
                            )
                            .and_then(|t| t.as_str())
                            {
                                duration = json!(text);
                                break;
                            }
                            if let Some(text) = walk_paths(
                                o,
                                "thumbnailOverlayTimeStatusRenderer.text.simpleText",
                            )
                            .and_then(|t| t.as_str())
                            {
                                duration = json!(text);
                                break;
                            }
                        }
                    }

                    let mut view_count = "0 views";
                    let mut view_owned = false;
                    let mut published_time = "Unknown".to_string();
                    if let Some(rows) = walk_paths(
                        lockup,
                        "metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows",
                    )
                    .and_then(|r| r.as_array())
                    {
                        for r in rows {
                            for p in r
                                .get("metadataParts")
                                .and_then(|pp| pp.as_array())
                                .unwrap_or(&EMPTY_VEC)
                            {
                                let text = p
                                    .get("text")
                                    .and_then(|t| t.get("content"))
                                    .and_then(|c| c.as_str())
                                    .unwrap_or("");
                                let label = p
                                    .get("accessibilityLabel")
                                    .and_then(|l| l.as_str())
                                    .unwrap_or("");
                                let tl = text.to_lowercase();
                                let ll = label.to_lowercase();
                                let icon_play = p
                                    .get("leadingIcon")
                                    .and_then(|i| i.get("name"))
                                    .and_then(|n| n.as_str())
                                    .map(|n| n.contains("PLAY"))
                                    .unwrap_or(false);
                                if ll.contains("view") || tl.contains("view") || icon_play {
                                    if !view_owned {
                                        view_count = if label.is_empty() { text } else { label };
                                        view_owned = true;
                                    }
                                } else if ll.contains("ago") || tl.contains("ago") || tl.contains("streamed") {
                                    published_time = if text.is_empty() {
                                        label.to_string()
                                    } else {
                                        text.to_string()
                                    };
                                }
                            }
                        }
                    }

                    let vid = video_id.as_str().unwrap_or("");
                    out.push(json!({
                        "videoId": video_id,
                        "title": title,
                        "thumbnail": thumbnail,
                        "publishedTime": published_time,
                        "viewCount": view_count,
                        "duration": duration,
                        "videoUrl": format!("https://www.youtube.com/watch?v={}", vid),
                        "shortUrl": format!("https://youtu.be/{}", vid),
                    }));
                }
                // gridVideoRenderer
                else if let Some(vr) = item.get("gridVideoRenderer") {
                    let video_id = vr.get("videoId").cloned().unwrap_or(Value::Null);
                    let thumbs = vr
                        .get("thumbnail")
                        .and_then(|t| t.get("thumbnails"))
                        .and_then(|t| t.as_array());
                    let title = vr
                        .pointer("/title/simpleText")
                        .or_else(|| vr.pointer("/title/runs/0/text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("No title");
                    let duration = vr
                        .get("thumbnailOverlays")
                        .and_then(|o| o.as_array())
                        .and_then(|arr| {
                            arr.iter()
                                .find_map(|o| {
                                    o.pointer("/thumbnailOverlayTimeStatusRenderer/text/simpleText")
                                        .and_then(|t| t.as_str())
                                })
                        })
                        .map(|s| json!(s))
                        .unwrap_or(Value::Null);
                    let vid = video_id.as_str().unwrap_or("");
                    out.push(json!({
                        "videoId": video_id,
                        "title": title,
                        "thumbnail": thumbs.and_then(|s| s.last()).and_then(|t| t.get("url")).cloned().unwrap_or(Value::Null),
                        "publishedTime": vr.pointer("/publishedTimeText/simpleText").and_then(|t| t.as_str()).unwrap_or("Unknown"),
                        "viewCount": vr.pointer("/viewCountText/simpleText").and_then(|t| t.as_str()).unwrap_or("0 views"),
                        "duration": duration,
                        "videoUrl": format!("https://www.youtube.com/watch?v={}", vid),
                        "shortUrl": format!("https://youtu.be/{}", vid),
                    }));
                }
                // videoRenderer
                else if let Some(vr) = item.get("videoRenderer") {
                    let video_id = vr.get("videoId").cloned().unwrap_or(Value::Null);
                    let thumbs = vr
                        .get("thumbnail")
                        .and_then(|t| t.get("thumbnails"))
                        .and_then(|t| t.as_array());
                    let title = vr
                        .pointer("/title/runs/0/text")
                        .or_else(|| vr.pointer("/title/simpleText"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("No title");
                    let duration = vr
                        .get("thumbnailOverlays")
                        .and_then(|o| o.as_array())
                        .and_then(|arr| {
                            arr.iter().find_map(|o| {
                                o.pointer("/thumbnailOverlayTimeStatusRenderer/text/simpleText")
                                    .and_then(|t| t.as_str())
                            })
                        })
                        .map(|s| json!(s))
                        .unwrap_or(Value::Null);
                    let vid = video_id.as_str().unwrap_or("");
                    out.push(json!({
                        "videoId": video_id,
                        "title": title,
                        "thumbnail": thumbs.and_then(|s| s.last()).and_then(|t| t.get("url")).cloned().unwrap_or(Value::Null),
                        "publishedTime": vr.pointer("/publishedTimeText/simpleText").and_then(|t| t.as_str()).unwrap_or("Unknown"),
                        "viewCount": vr.pointer("/viewCountText/simpleText").and_then(|t| t.as_str()).unwrap_or("0 views"),
                        "duration": duration,
                        "videoUrl": format!("https://www.youtube.com/watch?v={}", vid),
                        "shortUrl": format!("https://youtu.be/{}", vid),
                    }));
                }
            }
        }
    }
    out
}

async fn stalk_youtube(username: &str) -> Result<Value, String> {
    let clean = username.replace('@', "").trim().to_string();
    let url = format!("https://www.youtube.com/@{}", clean);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("DNT", "1")
                    .header("Upgrade-Insecure-Requests", "1")
                    .header("Sec-Fetch-Dest", "document")
                    .header("Sec-Fetch-Mode", "navigate")
                    .header("Sec-Fetch-Site", "none")
                    .header("Cache-Control", "max-age=0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    if status == 404 {
        return Err(format!("YouTube channel '{}' not found", username));
    }
    if status != 200 {
        return Err(format!("YouTube returned status {}", status));
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;
    let data = extract_yt_initial_data(&html)
        .ok_or("Could not parse YouTube initial data.")?;

    let channel = extract_channel_data(&data, &clean);
    let videos = extract_latest_videos(&data);

    let name = channel.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let ch_user = channel.get("username").and_then(|u| u.as_str()).unwrap_or("");
    if name.is_empty() && ch_user.is_empty() {
        return Err("Channel not found or data unavailable.".to_string());
    }

    Ok(json!({
        "id": ch_user,
        "username": ch_user,
        "name": if name.is_empty() { ch_user } else { name },
        "description": channel.get("description").cloned().unwrap_or(json!("No description")),
        "verified": channel.get("isVerified").cloned().unwrap_or(json!(false)),
        "subscriberCount": channel.get("subscriberCount").cloned().unwrap_or(json!("0")),
        "videoCount": channel.get("videoCount").cloned().unwrap_or(json!("0")),
        "joinDate": channel.get("joinDate").cloned().unwrap_or(Value::Null),
        "avatar": { "url": channel.get("avatarUrl").cloned().unwrap_or(Value::Null) },
        "stats": {
            "subscribers": channel.get("subscriberCount").cloned().unwrap_or(json!("0")),
            "videos": channel.get("videoCount").cloned().unwrap_or(json!("0")),
        },
        "latestVideos": videos,
        "profileUrl": format!("https://www.youtube.com/@{}", clean),
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let start = Instant::now();
    let username = query
        .get("username")
        .cloned()
        .or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get("username").and_then(|u| u.as_str()).map(|s| s.to_string()))
        });
    let username = match username {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": "Parameter 'username' is required",
                "example": {
                    "GET": "/api/stalk/youtube?username=mrbeast",
                    "POST": { "username": "mrbeast" }
                }
            })))
            .into_response()
        }
    };
    let clean = username.trim_start_matches('@').trim().to_string();

    let (data, cached) = match get_from_cache(&clean) {
        Some(d) => (d, true),
        None => match stalk_youtube(&clean).await {
            Ok(d) => {
                save_to_cache(&clean, &d);
                (d, false)
            }
            Err(e) => {
                let status = if e.contains("not found")
                    || e.contains("not exist")
                    || e.contains("Channel not found")
                {
                    StatusCode::NOT_FOUND
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                };
                return (status, Json(json!({
                    "status": false,
                    "message": e,
                    "duration": format!("{}ms", start.elapsed().as_millis()),
                })))
                .into_response();
            }
        },
    };

    Json(json!({
        "status": true,
        "user": data,
        "metadata": {
            "cached": cached,
            "source": "youtube.com",
            "processing_time": format!("{}ms", start.elapsed().as_millis()),
            "timestamp": now_iso(),
        }
    })).into_response()

}

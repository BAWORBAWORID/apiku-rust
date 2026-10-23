// X (Twitter) Downloader — native conversion of api/downloader/xdl.js
// Guest-token GraphQL flow: activate.json → UserByScreenName / UserTweets →
// media variants. Guest token cached in tmp file xGst-guest.json (2h).
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BEARER: &str = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const ACTIVATE: &str = "https://api.twitter.com/1.1/guest/activate.json";
const GQL: &str = "https://twitter.com/i/api/graphql";
const QID_USER: &str = "pVrmNaXcxPjisIvKtLDMEA";
const QID_TWEETS: &str = "E3opETHurmVJflFsUBVuUQ";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const QUALITIES: [&str; 5] = ["4k", "2k", "1080p", "720p", "480p"];

fn cache_path() -> String {
    format!("{}/xGst-guest.json", std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into()))
}

fn feats() -> Value {
    json!({
        "hidden_profile_subscriptions_enabled": true,
        "rweb_tipjar_consumption_enabled": true,
        "responsive_web_graphql_exclude_directive_enabled": true,
        "verified_phone_label_enabled": false,
        "highlights_tweets_tab_ui_enabled": true,
        "responsive_web_graphql_timeline_navigation_enabled": true,
        "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false
    })
}

fn hdrs() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    let mk = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
    h.insert("user-agent", mk(UA));
    h.insert("accept", mk("application/json, text/plain, */*"));
    h.insert("accept-language", mk("en-US,en;q=0.9"));
    h.insert("x-twitter-active-user", mk("yes"));
    h.insert("x-twitter-client-language", mk("en"));
    h.insert("referer", mk("https://x.com/"));
    h
}

async fn guest(client: &reqwest::Client, force: bool) -> Result<String, String> {
    if !force {
        if let Ok(text) = std::fs::read_to_string(cache_path()) {
            if let Ok(c) = serde_json::from_str::<Value>(&text) {
                let when = c.get("when").and_then(|w| w.as_i64()).unwrap_or(0);
                let token = c.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string();
                let now_ms = chrono::Utc::now().timestamp_millis();
                if now_ms - when < 7200_000 && !token.is_empty() {
                    return Ok(token);
                }
            }
        }
    }
    let resp = client
        .post(ACTIVATE)
        .header("authorization", format!("Bearer {BEARER}"))
        .headers(hdrs())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("guest token gagal ({})", resp.status().as_u16()));
    }
    let j: Value = resp.json().await.map_err(|e| e.to_string())?;
    let token = j.get("guest_token").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let _ = std::fs::write(cache_path(), json!({ "token": token, "when": chrono::Utc::now().timestamp_millis() }).to_string());
    Ok(token)
}

async fn gql(client: &reqwest::Client, qid: &str, op: &str, vars: Value, use_feats: bool, retry: bool) -> Result<Value, String> {
    let tok = guest(client, !retry).await?;
    let mut url = format!("{GQL}/{qid}/{op}?variables={}", urlencoding::encode(&vars.to_string()));
    if use_feats {
        url.push_str(&format!("&features={}", urlencoding::encode(&feats().to_string())));
    }
    let resp = client
        .get(&url)
        .header("authorization", format!("Bearer {BEARER}"))
        .header("x-guest-token", tok)
        .headers(hdrs())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    if (status == 401 || status == 403) && retry {
        let _ = std::fs::remove_file(cache_path());
        return Box::pin(gql(client, qid, op, vars, use_feats, false)).await;
    }
    if status == 404 {
        return Err(format!("queryId X dirotasi ({op} → 404). Perlu update QID di file."));
    }
    if !(200..300).contains(&status) {
        return Err(format!("{op} HTTP {status}"));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn get_user(client: &reqwest::Client, screen_name: &str) -> Result<Value, String> {
    let j = gql(client, QID_USER, "UserByScreenName",
        json!({ "screen_name": screen_name, "withSafetyModeUserFields": true }), true, true).await?;
    let r = j.pointer("/data/user/result").cloned().ok_or_else(|| format!("user @{screen_name} tidak ditemukan"))?;
    if r.get("__typename").and_then(|t| t.as_str()) == Some("UserUnavailable") {
        return Err(format!("user @{screen_name} suspended/private"));
    }
    let l = r.get("legacy").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "id": r.get("rest_id").cloned().unwrap_or(json!("")),
        "name": l.get("name").cloned().unwrap_or(json!("")),
        "username": l.get("screen_name").cloned().unwrap_or(json!(screen_name)),
        "bio": l.get("description").cloned().unwrap_or(json!("")),
        "location": l.get("location").cloned().unwrap_or(json!("")),
        "verified": r.get("is_blue_verified").cloned().unwrap_or(json!(false)),
        "followers": l.get("followers_count").cloned().unwrap_or(Value::Null),
        "following": l.get("friends_count").cloned().unwrap_or(Value::Null),
        "statuses": l.get("statuses_count").cloned().unwrap_or(Value::Null),
        "createdAt": l.get("created_at").cloned().unwrap_or(Value::Null),
        "avatar": l.get("profile_image_url_https").cloned().unwrap_or(json!("")),
        "url": format!("https://x.com/{}", l.get("screen_name").and_then(|s| s.as_str()).unwrap_or(screen_name))
    }))
}

fn media_item(m: &Value) -> Value {
    let oi = m.get("original_info").cloned().unwrap_or(Value::Null);
    let typ = m.get("type").and_then(|t| t.as_str()).unwrap_or("photo");
    let mut base = json!({
        "id": m.get("id_str").cloned().unwrap_or(json!("")),
        "type": typ,
        "width": oi.get("width").cloned().unwrap_or(Value::Null),
        "height": oi.get("height").cloned().unwrap_or(Value::Null),
        "image": m.get("media_url_https").or_else(|| m.get("media_url")).cloned().unwrap_or(json!(""))
    });
    if typ == "video" || typ == "animated_gif" {
        let vi = m.get("video_info").cloned().unwrap_or(Value::Null);
        let mut variants: Vec<(u64, Value)> = vi
            .get("variants")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|v| v.get("url").and_then(|u| u.as_str()).is_some() && v.get("bitrate").and_then(|b| b.as_u64()).is_some())
            .map(|v| (v.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0), v))
            .collect();
        variants.sort_by(|a, b| b.0.cmp(&a.0));
        variants.dedup_by_key(|v| v.0);
        let hls = vi.get("variants").and_then(|v| v.as_array()).and_then(|arr| {
            arr.iter().find(|v| v.get("url").and_then(|u| u.as_str()).map(|u| u.contains(".m3u8")).unwrap_or(false))
        }).and_then(|v| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()));
        let width = oi.get("width").and_then(|w| w.as_f64()).unwrap_or(0.0);
        let height = oi.get("height").and_then(|h| h.as_f64()).unwrap_or(0.0);
        base["durationMs"] = vi.get("duration_millis").cloned().unwrap_or(Value::Null);
        base["aspectRatio"] = if width > 0.0 && height > 0.0 { json!((width / height * 10000.0).round() / 10000.0) } else { Value::Null };
        base["variants"] = json!(variants.into_iter().map(|(_, v)| json!({
            "url": v.get("url"), "bitrate": v.get("bitrate"),
            "type": v.get("content_type").cloned().unwrap_or(json!("video/mp4"))
        })).collect::<Vec<_>>());
        base["hls"] = hls.map(Value::String).unwrap_or(Value::Null);
    }
    base
}

async fn get_timeline(client: &reqwest::Client, screen_name: &str, count: u32) -> Result<(Value, Vec<Value>), String> {
    let user = get_user(client, screen_name).await?;
    let user_id = user.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
    let j = gql(client, QID_TWEETS, "UserTweets",
        json!({
            "userId": user_id, "count": count,
            "includePromotedContent": false,
            "withQuickPromoteEligibilityTweetFields": false,
            "withVoice": false
        }), true, true).await?;

    let mut out: Vec<Value> = Vec::new();
    fn walk(o: &Value, out: &mut Vec<Value>) {
        match o {
            Value::Array(a) => {
                for v in a {
                    walk(v, out);
                }
            }
            Value::Object(_) => {
                if let Some(l) = o.get("legacy") {
                    if let Some(full_text) = l.get("full_text").and_then(|t| t.as_str()) {
                        let mut media: Vec<Value> = Vec::new();
                        for src in ["extended_entities", "entities"] {
                            if let Some(items) = l.pointer(&format!("/{src}/media")).and_then(|m| m.as_array()) {
                                for m in items {
                                    media.push(m.clone());
                                }
                            }
                        }
                        let mut seen = std::collections::HashSet::new();
                        let mut items = Vec::new();
                        for m in media {
                            let key = m.get("id_str").and_then(|i| i.as_str())
                                .or_else(|| m.get("media_url_https").and_then(|i| i.as_str()))
                                .or_else(|| m.get("media_url").and_then(|i| i.as_str()))
                                .unwrap_or("").to_string();
                            if key.is_empty() || !seen.insert(key) {
                                continue;
                            }
                            items.push(media_item(&m));
                        }
                        if !items.is_empty() {
                            let l = l.clone();
                            let is_rt = l.get("retweeted_status_result").is_some() || full_text.starts_with("RT @");
                            out.push(json!({
                                "id": l.get("id_str").cloned().or_else(|| o.get("rest_id").cloned()).unwrap_or(json!("")),
                                "text": full_text,
                                "lang": l.get("lang").cloned().unwrap_or(json!("")),
                                "createdAt": l.get("created_at").cloned().unwrap_or(json!("")),
                                "isRetweet": is_rt,
                                "engagement": {
                                    "likes": l.get("favorite_count").cloned().unwrap_or(Value::Null),
                                    "retweets": l.get("retweet_count").cloned().unwrap_or(Value::Null),
                                    "replies": l.get("reply_count").cloned().unwrap_or(Value::Null),
                                    "quotes": l.get("quote_count").cloned().unwrap_or(Value::Null),
                                    "bookmarks": l.get("bookmark_count").cloned().unwrap_or(Value::Null)
                                },
                                "media": items
                            }));
                        }
                    }
                }
                if let Value::Object(map) = o {
                    for (_, v) in map {
                        walk(v, out);
                    }
                }
            }
            _ => {}
        }
    }
    walk(&j, &mut out);
    Ok((user, out))
}

fn variant_height(url: &str) -> u64 {
    // /avc1/NNNxBBB/
    if let Some(i) = url.find("/avc1/") {
        let seg = &url[i + 6..];
        let dims: String = seg.chars().take_while(|c| c.is_ascii_digit() || *c == 'x').collect();
        if let Some(x) = dims.find('x') {
            return dims[x + 1..].parse().unwrap_or(0);
        }
    }
    0
}

fn pick_variant<'a>(item: &'a Value, want: &str) -> Option<&'a Value> {
    let variants = item.get("variants")?.as_array()?;
    if variants.is_empty() {
        return None;
    }
    if want == "best" {
        return variants.iter().max_by_key(|v| v.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0));
    }
    let target: u64 = if let Some(stripped) = want.strip_suffix('k') {
        stripped.parse::<u64>().ok()? * 540
    } else {
        want.trim_end_matches('p').parse().ok()?
    };
    variants
        .iter()
        .min_by_key(|v| {
            let h = v.get("url").and_then(|u| u.as_str()).map(variant_height).unwrap_or(0);
            let diff = (h as i64 - target as i64).abs();
            (diff, -(v.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0) as i64))
        })
}

fn fmt_variants(variants: &Value) -> Vec<Value> {
    variants
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|v| {
            let url = v.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let h = variant_height(url);
            let resolution: Value = if h > 0 { json!(format!("{h}p")) } else { Value::Null };
            let width: Value = match url.find("/avc1/") {
                Some(i) => {
                    let seg = &url[i + 6..];
                    let dims: String = seg.chars().take_while(|c| c.is_ascii_digit() || *c == 'x').collect();
                    dims.split('x').next().and_then(|w| w.parse::<u64>().ok()).map(Value::from).unwrap_or(Value::Null)
                }
                None => Value::Null
            };
            json!({
                "resolution": resolution,
                "width": width,
                "bitrate": v.get("bitrate"),
                "type": v.get("type"),
                "url": v.get("url")
            })
        })
        .collect()
}

fn slim_author(a: &Value) -> Value {
    if a.is_null() {
        return Value::Null;
    }
    json!({
        "name": a.get("name"),
        "username": a.get("username"),
        "verified": a.get("verified"),
        "followers": a.get("followers")
    })
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "mode"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let input = merged.get("url").map(|s| s.trim().to_string()).unwrap_or_default();
    if input.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Parameter 'url' wajib diisi (URL tweet atau username)"
        }))).into_response();
    }
    let mode = merged.get("mode").map(|s| s.to_lowercase()).unwrap_or_else(|| "info".into());
    let mut valid_modes: Vec<&str> = vec!["info", "profile", "best", "photo", "gif"];
    valid_modes.extend(QUALITIES.iter());
    if !valid_modes.contains(&mode.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": format!("Mode tidak valid. Pilih: {}", valid_modes.join(", "))
        }))).into_response();
    }

    let client = match reqwest::Client::builder()
        
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false, "message": e.to_string()
        }))).into_response(),
    };

    let has_status = input.contains("/status/");
    let bare_id = input.len() >= 10 && input.len() <= 25 && input.chars().all(|c| c.is_ascii_digit());
    let is_tweet_target = has_status || bare_id;

    if !is_tweet_target {
        let username = input.trim_start_matches('@').to_string();
        if mode == "profile" {
            return match get_user(&client, &username).await {
                Ok(u) => Json(json!({ "status": true, "result": { "mode": "profile", "user": u } })).into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e }))).into_response(),
            };
        }
        match get_timeline(&client, &username, 40).await {
            Ok((user, tweets)) => {
                if tweets.is_empty() {
                    return (StatusCode::NOT_FOUND, Json(json!({
                        "status": false, "message": format!("@{username} tidak punya tweet ber-media dalam 40 tweet terbaru.")
                    }))).into_response();
                }
                let u_username = user.get("username").and_then(|u| u.as_str()).unwrap_or(&username).to_string();
                let mapped: Vec<Value> = tweets.iter().map(|t| {
                    json!({
                        "id": t.get("id"),
                        "url": format!("https://x.com/{u_username}/status/{}", t.get("id").and_then(|i| i.as_str()).unwrap_or("")),
                        "text": t.get("text"),
                        "createdAt": t.get("createdAt"),
                        "isRetweet": t.get("isRetweet"),
                        "engagement": t.get("engagement"),
                        "media": t.get("media").and_then(|m| m.as_array()).map(|arr| arr.iter().map(|m| json!({
                            "type": m.get("type"), "width": m.get("width"), "height": m.get("height"),
                            "durationMs": m.get("durationMs"),
                            "variants": m.get("variants").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
                            "image": m.get("image")
                        })).collect::<Vec<_>>()).unwrap_or(vec![])
                    })
                }).collect();
                Json(json!({
                    "status": true,
                    "result": { "mode": "timeline", "user": user, "count": tweets.len(), "tweets": mapped }
                }))
                .into_response()
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e }))).into_response(),
        }
    } else {
        // tweet URL/ID — parse (x|twitter).com/<user>/status/<id>
        let mut tweet_id: Option<String> = None;
        let mut who: Option<String> = None;
        let lower = input.to_lowercase();
        if let Some(i) = lower.find("/status/") {
            let before = &input[..i];
            let user = before.rsplit('/').next().unwrap_or("");
            if !user.is_empty() && user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                who = Some(user.to_string());
                tweet_id = Some(input[i + 8..].chars().take_while(|c| c.is_ascii_digit()).collect());
            }
        } else if bare_id {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "Gunakan URL tweet lengkap (dengan username), bukan ID polos."
            }))).into_response();
        }
        let (tweet_id, who) = match (tweet_id, who) {
            (Some(t), Some(w)) if !t.is_empty() => (t, w),
            _ => return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "Bukan URL tweet valid. Format: https://x.com/<user>/status/<id>"
            }))).into_response(),
        };
        if mode == "profile" {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "Mode 'profile' hanya untuk input username."
            }))).into_response();
        }

        // findTweet: timeline scan
        let (user, tweets) = match get_timeline(&client, &who, 40).await {
            Ok(v) => v,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e }))).into_response(),
        };
        let t = match tweets.iter().find(|tw| tw.get("id").and_then(|i| i.as_str()) == Some(tweet_id.as_str())) {
            Some(t) => t.clone(),
            None => return (StatusCode::NOT_FOUND, Json(json!({
                "status": false, "message": format!("Tweet {tweet_id} tidak ada di 40 tweet terbaru @{who}. Tweet lama memerlukan login.")
            }))).into_response(),
        };
        let u_username = user.get("username").and_then(|u| u.as_str()).unwrap_or(&who).to_string();
        let tweet_url = format!("https://x.com/{u_username}/status/{tweet_id}");
        let media_arr: Vec<Value> = t.get("media").and_then(|m| m.as_array()).cloned().unwrap_or_default();

        match mode.as_str() {
            "info" => {
                let media: Vec<Value> = media_arr.iter().map(|m| {
                    json!({
                        "type": m.get("type"), "width": m.get("width"), "height": m.get("height"),
                        "durationMs": m.get("durationMs"), "aspectRatio": m.get("aspectRatio"),
                        "image": m.get("image"), "hls": m.get("hls"),
                        "variants": fmt_variants(m.get("variants").unwrap_or(&Value::Null))
                    })
                }).collect();
                let has_video = media.iter().any(|m| matches!(m.get("type").and_then(|t| t.as_str()), Some("video") | Some("animated_gif")));
                let has_photo = media.iter().any(|m| m.get("type").and_then(|t| t.as_str()) == Some("photo"));
                Json(json!({
                    "status": true,
                    "result": {
                        "id": tweet_id, "url": tweet_url, "text": t.get("text"),
                        "author": slim_author(&user), "engagement": t.get("engagement"),
                        "createdAt": t.get("createdAt"), "lang": t.get("lang"), "isRetweet": t.get("isRetweet"),
                        "mode": "info", "mediaCount": media.len(),
                        "hasVideo": has_video, "hasPhoto": has_photo, "media": media
                    }
                }))
                .into_response()
            }
            "photo" => {
                let pics: Vec<&Value> = media_arr.iter().filter(|m| m.get("type").and_then(|t| t.as_str()) == Some("photo")).collect();
                if pics.is_empty() {
                    return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "message": "Tweet ini tidak ada foto." }))).into_response();
                }
                Json(json!({
                    "status": true,
                    "result": {
                        "id": tweet_id, "url": tweet_url, "text": t.get("text"),
                        "author": slim_author(&user), "mode": "photo", "count": pics.len(),
                        "photos": pics.iter().map(|p| json!({
                            "width": p.get("width"), "height": p.get("height"), "url": p.get("image")
                        })).collect::<Vec<_>>()
                    }
                }))
                .into_response()
            }
            "gif" => {
                let gif = media_arr.iter().find(|m| m.get("type").and_then(|t| t.as_str()) == Some("animated_gif") && m.get("variants").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false));
                let gif = match gif {
                    Some(g) => g,
                    None => return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "message": "Tweet ini tidak ada GIF." }))).into_response(),
                };
                let v = match pick_variant(gif, "best") {
                    Some(v) => v,
                    None => return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "message": "Tidak ada variant GIF." }))).into_response(),
                };
                Json(json!({
                    "status": true,
                    "result": {
                        "id": tweet_id, "url": tweet_url, "text": t.get("text"),
                        "author": slim_author(&user), "mode": "gif",
                        "download_url": v.get("url"), "bitrate": v.get("bitrate"),
                        "width": gif.get("width"), "height": gif.get("height")
                    }
                }))
                .into_response()
            }
            _ => {
                // best / 4k / 2k / 1080p / 720p / 480p
                let vid = media_arr.iter().find(|m| matches!(m.get("type").and_then(|t| t.as_str()), Some("video") | Some("animated_gif")) && m.get("variants").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false));
                let vid = match vid {
                    Some(v) => v,
                    None => return (StatusCode::NOT_FOUND, Json(json!({ "status": false, "message": "Tweet ini tidak ada video." }))).into_response(),
                };
                let v = match pick_variant(vid, &mode) {
                    Some(v) => v,
                    None => return (StatusCode::NOT_FOUND, Json(json!({
                        "status": false, "message": format!("Tidak ada variant video untuk mode '{mode}'.")
                    }))).into_response(),
                };
                let v_url = v.get("url").and_then(|u| u.as_str()).unwrap_or("");
                let height = if variant_height(v_url) > 0 { variant_height(v_url) } else { vid.get("height").and_then(|h| h.as_u64()).unwrap_or(0) };
                Json(json!({
                    "status": true,
                    "result": {
                        "id": tweet_id, "url": tweet_url, "text": t.get("text"),
                        "author": slim_author(&user), "engagement": t.get("engagement"),
                        "createdAt": t.get("createdAt"), "mode": "video",
                        "quality": format!("{height}p"),
                        "download_url": v.get("url"), "bitrate": v.get("bitrate"),
                        "width": vid.get("width"), "height": vid.get("height"),
                        "durationMs": vid.get("durationMs"),
                        "thumbnail": vid.get("image")
                    }
                }))
                .into_response()
            }
        }
    }
}

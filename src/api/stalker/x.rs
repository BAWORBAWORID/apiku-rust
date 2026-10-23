
fn truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => !s.is_empty() && s != "0" && s != "false",
        serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        serde_json::Value::Null => false,
        _ => true,
    }
}
// X (Twitter) Tweet Stalker — native conversion of api/stalker/x.js
// SSR extraction of x.com/i/status/<id> flight data ($R graph), fallback to
// cdn.syndication.twimg.com. Resolves __ref/__refs graph like the JS resolver.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0";

fn client(timeout: u64) -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .user_agent(UA)
        .build()
        .ok()
}

fn id_of(s: &str) -> Option<String> {
    let re = regex::Regex::new(r"(\d{15,20})").unwrap();
    re.captures(s).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

/// Extract `$R[<id>]={...}` balanced-brace chunks from the SSR payload.
fn extract_recs(s: &str) -> Vec<(String, String)> {
    let re = regex::Regex::new(r"\$R\[(\d+)\]=\{").unwrap();
    let mut recs = Vec::new();
    for cap in re.captures_iter(s) {
        let id = cap.get(1).unwrap().as_str().to_string();
        let m = cap.get(0).unwrap();
        let start = m.end() - 1; // position of '{'
        let bytes = s.as_bytes();
        let mut depth = 0usize;
        let mut in_str = false;
        let mut esc = false;
        let mut end = None;
        let mut i = start;
        while i < bytes.len() {
            let c = bytes[i] as char;
            if esc {
                esc = false;
                i += 1;
                continue;
            }
            match c {
                '\\' => esc = true,
                '"' => in_str = !in_str,
                '{' if !in_str => depth += 1,
                '}' if !in_str => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i + 1);
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        if let Some(e) = end {
            recs.push((id, s[start..e].to_string()));
        }
    }
    recs
}

/// Clean a $R chunk into JSON-ish text (references become nulls, JS literals fixed).
fn resolve_graph(raw: &str) -> String {
    let re_assign = regex::Regex::new(r"\$R\[\d+\]=").unwrap();
    let re_ref = regex::Regex::new(r"\$R\[\d+\]").unwrap();
    let s = re_assign.replace_all(raw, "");
    let s = re_ref.replace_all(&s, "null");
    s.replace("void 0", "null")
        .replace("!0", "true")
        .replace("!1", "false")
}

fn make_resolver(map: &HashMap<String, Value>) -> impl Fn(&Value, u32) -> Value + '_ {
    move |node: &Value, depth: u32| -> Value {
        fn r(
            node: &Value,
            map: &HashMap<String, Value>,
            depth: u32,
            memo: &mut HashMap<Vec<u8>, Value>,
        ) -> Value {
            if depth > 12 {
                return Value::Null;
            }
            if let Value::Object(obj) = node {
                if let Some(Value::String(rf)) = obj.get("__ref") {
                    let key = serde_json::to_vec(node).unwrap_or_default();
                    if let Some(v) = memo.get(&key) {
                        return v.clone();
                    }
                    memo.insert(key.clone(), Value::Null);
                    let res = map
                        .get(rf)
                        .map(|v| r(v, map, depth + 1, memo))
                        .unwrap_or(Value::Null);
                    memo.insert(key, res.clone());
                    return res;
                }
                if let Some(Value::Object(res_obj)) = obj.get("result") {
                    if let Some(Value::String(rf)) = res_obj.get("__ref") {
                        if let Some(v) = map.get(rf) {
                            return r(v, map, depth + 1, memo);
                        }
                    }
                }
            }
            node.clone()
        }
        let mut memo = HashMap::new();
        r(node, map, depth, &mut memo)
    }
}

fn resolve_refs_list(map: &HashMap<String, Value>, rr: &impl Fn(&Value, u32) -> Value, node: &Value) -> Vec<Value> {
    let n = rr(node, 0);
    let mut out = Vec::new();
    if let Some(refs) = n.get("__refs").and_then(|r| r.as_array()) {
        for ref_v in refs {
            if let Some(key) = ref_v.as_str() {
                if let Some(v) = map.get(key) {
                    let rv = rr(v, 0);
                    if rv.is_object() {
                        out.push(rv);
                    }
                }
            }
        }
    }
    out
}

fn pick(x: Option<&Value>) -> Value {
    match x {
        Some(v) if v.is_object() => v.clone(),
        _ => json!({}),
    }
}

fn read_tweet(t: &Value, rr: &impl Fn(&Value, u32) -> Value, map: &HashMap<String, Value>) -> Value {
    let details = {
        let d = rr(t.get("details").unwrap_or(&Value::Null), 0);
        if d.is_null() {
            t.get("details").cloned().unwrap_or(json!({}))
        } else {
            d
        }
    };
    let core = rr(t.get("core").unwrap_or(&Value::Null), 0);
    let user_results = rr(core.get("user_results").unwrap_or(&Value::Null), 0);
    let uc = pick(user_results.get("core"));
    let legacy = {
        let l = rr(user_results.get("legacy").unwrap_or(&Value::Null), 0);
        if l.is_null() {
            user_results.get("legacy").cloned().unwrap_or(json!({}))
        } else {
            l
        }
    };
    let avatar = rr(user_results.get("avatar").unwrap_or(&Value::Null), 0);
    let counts = rr(t.get("counts").unwrap_or(&Value::Null), 0);
    let views = rr(t.get("views").unwrap_or(&Value::Null), 0);

    // media
    let mut media: Vec<Value> = Vec::new();
    let me2 = rr(t.get("media_entities2").unwrap_or(&Value::Null), 0);
    if let Some(refs) = me2.get("__refs").and_then(|r| r.as_array()) {
        for ref_v in refs {
            let mm = ref_v
                .as_str()
                .and_then(|k| map.get(k))
                .map(|v| rr(v, 0))
                .unwrap_or(json!({}));
            let vi = rr(mm.get("video_info").unwrap_or(&Value::Null), 0);
            let oi = rr(mm.get("original_info").unwrap_or(&Value::Null), 0);
            let mut vdefs: Vec<(String, i64)> = Vec::new();
            let variants = vi.get("variants");
            if let Some(refs2) = variants.and_then(|v| v.get("__refs")).and_then(|r| r.as_array()) {
                for r2 in refs2 {
                    let vv = r2
                        .as_str()
                        .and_then(|k| map.get(k))
                        .map(|v| rr(v, 0))
                        .unwrap_or(json!({}));
                    let url = vv
                        .get("url")
                        .or_else(|| vv.get("src"))
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string();
                    vdefs.push((url, vv.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0)));
                }
            } else if let Some(arr) = variants.and_then(|v| v.as_array()) {
                for x in arr {
                    let url = x
                        .get("url")
                        .or_else(|| x.get("src"))
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string();
                    vdefs.push((url, x.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0)));
                }
            }
            vdefs.retain(|(u, _)| u.contains(".mp4"));
            vdefs.sort_by(|a, b| b.1.cmp(&a.1));
            media.push(json!({
                "type": mm.get("type").cloned().unwrap_or(Value::Null),
                "thumbnail": mm.get("media_url_https").or_else(|| mm.get("media_url")).cloned().unwrap_or(Value::Null),
                "video": vdefs.first().map(|(u, _)| Value::String(u.clone())).unwrap_or(Value::Null),
                "size": {
                    "width": oi.get("width").cloned().unwrap_or(Value::Null),
                    "height": oi.get("height").cloned().unwrap_or(Value::Null),
                },
            }));
        }
    }

    // entities
    let urls: Vec<Value> = resolve_refs_list(map, rr, t.get("url_entities").unwrap_or(&Value::Null))
        .iter()
        .map(|x| {
            json!({ "short": x.get("url").or_else(|| x.get("expanded_url_storage")).or_else(|| x.get("expanded_url")).cloned().unwrap_or(Value::Null), "expanded": Value::Null })
        })
        .collect();
    let mentions: Vec<Value> = resolve_refs_list(map, rr, t.get("mention_entities").unwrap_or(&Value::Null))
        .iter()
        .map(|x| {
            json!({ "username": x.get("mention_input").or_else(|| x.get("screen_name")).cloned().unwrap_or(Value::Null) })
        })
        .collect();
    let hashtags: Vec<Value> = resolve_refs_list(
        map,
        rr,
        details
            .get("hashtag_entities")
            .or_else(|| t.get("hashtag_entities"))
            .unwrap_or(&Value::Null),
    )
    .iter()
    .map(|x| json!({ "hashtag": x.get("tag").or_else(|| x.get("text")).cloned().unwrap_or(Value::Null) }))
    .collect();
    let cashtags: Vec<Value> = resolve_refs_list(
        map,
        rr,
        details
            .get("cashtag_entities")
            .or_else(|| t.get("cashtag_entities"))
            .unwrap_or(&Value::Null),
    )
    .iter()
    .map(|x| json!({ "cashtag": x.get("tag").or_else(|| x.get("text")).cloned().unwrap_or(Value::Null) }))
    .collect();

    // reply
    let mut rep = Value::Null;
    let rep_to = rr(t.get("reply_to_results").unwrap_or(&Value::Null), 0);
    if rep_to.get("rest_id").is_some() || rep_to.get("id_str").is_some() {
        let rep_user = rr(t.get("reply_to_user_results").unwrap_or(&Value::Null), 0);
        let rep_core = pick(rep_user.get("core"));
        rep = json!({
            "tweetId": rep_to.get("rest_id").or_else(|| rep_to.get("id_str")).cloned().unwrap_or(Value::Null),
            "user": {
                "id": rep_user.get("rest_id").or_else(|| rep_user.get("id_str")).cloned().unwrap_or(Value::Null),
                "username": rep_core.get("screen_name").or_else(|| rep_user.get("screen_name")).cloned().unwrap_or(Value::Null),
                "name": rep_core.get("name").or_else(|| rep_user.get("name")).cloned().unwrap_or(Value::Null),
            },
        });
    }

    let is_blue = user_results
        .get("is_blue_verified")
        .and_then(|b| b.as_bool())
        .or_else(|| uc.get("is_blue_verified").and_then(|b| b.as_bool()))
        .unwrap_or(false);
    let is_verified = if user_results.get("professional").is_some() {
        is_blue
    } else {
        is_blue || uc.get("verified").map(truthy).unwrap_or(false)
    };

    let handle = uc
        .get("screen_name")
        .or_else(|| user_results.get("screen_name"))
        .or_else(|| legacy.get("screen_name"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let rest_id = t
        .get("rest_id")
        .or_else(|| details.get("id_str"))
        .cloned()
        .unwrap_or(Value::Null);
    let id_str = rest_id.as_str().unwrap_or("").to_string();

    json!({
        "id": rest_id,
        "text": details.get("full_text").and_then(|t| t.as_str()).unwrap_or("").replace("\\n", "\n"),
        "createdAt": details.get("created_at_ms").and_then(|c| c.as_str()).and_then(ms_to_iso),
        "lang": legacy.get("lang").cloned().unwrap_or(Value::Null),
        "stats": {
            "likes": counts.get("favorites").or_else(|| counts.get("favorite_count")).cloned().unwrap_or(Value::Null),
            "retweets": counts.get("retweets").or_else(|| counts.get("retweet_count")).cloned().unwrap_or(Value::Null),
            "replies": counts.get("replies").or_else(|| counts.get("reply_count")).cloned().unwrap_or(Value::Null),
            "views": views.get("count").cloned().unwrap_or(Value::Null),
        },
        "author": {
            "id": user_results.get("rest_id").or_else(|| user_results.get("id_str")).cloned().unwrap_or(Value::Null),
            "name": uc.get("name").or_else(|| user_results.get("name")).or_else(|| legacy.get("name")).cloned().unwrap_or(Value::Null),
            "username": if handle.is_empty() { Value::Null } else { Value::String(handle.clone()) },
            "verified": is_verified,
            "avatar": avatar.get("image_url").or_else(|| avatar.get("image"))
                .or_else(|| user_results.get("profile_image_url_https"))
                .or_else(|| legacy.get("profile_image_url_https")).cloned().unwrap_or(Value::Null),
        },
        "reply": rep,
        "media": media,
        "entities": { "urls": urls, "mentions": mentions, "hashtags": hashtags, "cashtags": cashtags },
        "url": if !id_str.is_empty() {
            Value::String(format!("https://x.com/{}/status/{}", if handle.is_empty() { "i" } else { &handle }, id_str))
        } else {
            Value::Null
        },
        "source": "ssr",
    })
}

fn ms_to_iso(ms: &str) -> Option<Value> {
    let ms: u64 = ms.parse().ok()?;
    let secs = ms / 1000;
    Some(Value::String(epoch_secs_to_iso(secs)))
}

fn epoch_secs_to_iso(secs: u64) -> String {
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
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, mo, d, h, m, s)
}

async fn ssr(tweet_id: &str) -> Vec<Value> {
    let Some(client) = client(20) else { return vec![] };
    let Ok(resp) = client
        .get(format!("https://x.com/i/status/{}", tweet_id))
        .send()
        .await
    else {
        return vec![];
    };
    let Ok(body) = resp.text().await else { return vec![] };
    let recs = extract_recs(&body);
    // parse each chunk; accept the first object that looks like tweet graph
    let mut map: HashMap<String, Value> = HashMap::new();
    for (id, chunk) in &recs {
        let cleaned = resolve_graph(chunk);
        if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
            let looks = v.as_object().map(|o| o.contains_key("client:root")).unwrap_or(false)
                || v.as_object().map(|o| {
                    o.values().any(|val| {
                        val.get("details")
                            .and_then(|d| d.get("full_text"))
                            .is_some()
                    })
                }).unwrap_or(false);
            if looks {
                // build map keyed by $R ids: emulate $R[N] refs — keys are chunk ids
                map.insert(id.clone(), v);
                // first match wins like JS
                break;
            }
        }
    }
    if map.is_empty() {
        return vec![];
    }
    let rr = make_resolver(&map);
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for v in map.values() {
        let t = rr(v, 0);
        let det = rr(t.get("details").unwrap_or(&Value::Null), 0);
        let det = if det.is_null() { t.get("details").unwrap_or(&Value::Null) } else { &det };
        if det.get("full_text").is_some() {
            let tw = read_tweet(&t, &rr, &map);
            if let Some(id) = tw.get("id").and_then(|i| i.as_str()) {
                if !tw.get("text").and_then(|x| x.as_str()).unwrap_or("").is_empty()
                    && seen.insert(id.to_string())
                {
                    out.push(tw);
                }
            }
        }
    }
    out
}

async fn synd(tweet_id: &str) -> Option<Vec<Value>> {
    let client = client(15)?;
    let resp = client
        .get(format!(
            "https://cdn.syndication.twimg.com/tweet-result?id={}&lang=en&token=0",
            tweet_id
        ))
        .send()
        .await
        .ok()?;
    let data: Value = resp.json().await.ok()?;
    let u = data.get("user").cloned().unwrap_or(json!({}));
    let mut media = Vec::new();
    if let Some(mds) = data.get("mediaDetails").and_then(|m| m.as_array()) {
        for m in mds {
            let video = m
                .get("video_info")
                .and_then(|v| v.get("variants"))
                .and_then(|v| v.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .filter_map(|v| v.get("url").and_then(|u| u.as_str()))
                        .find(|u| u.contains(".mp4"))
                        .map(|s| Value::String(s.to_string()))
                })
                .unwrap_or(Value::Null);
            let oi = m.get("originalInfo").cloned().unwrap_or(json!({}));
            media.push(json!({
                "type": m.get("type").cloned().unwrap_or(Value::Null),
                "thumbnail": m.get("media_url_https").or_else(|| m.get("media_url")).cloned().unwrap_or(Value::Null),
                "video": video,
                "size": { "width": oi.get("width").cloned().unwrap_or(Value::Null), "height": oi.get("height").cloned().unwrap_or(Value::Null) },
            }));
        }
    }
    let id_str = data
        .get("id_str")
        .and_then(|i| i.as_str())
        .unwrap_or(tweet_id);
    Some(vec![json!({
        "id": id_str,
        "text": data.get("text").cloned().unwrap_or(json!("")),
        "createdAt": data.get("created_at").cloned().unwrap_or(Value::Null),
        "lang": data.get("lang").cloned().unwrap_or(Value::Null),
        "stats": {
            "likes": data.get("favorite_count").cloned().unwrap_or(Value::Null),
            "retweets": Value::Null,
            "replies": data.get("conversation_count").cloned().unwrap_or(Value::Null),
            "views": Value::Null,
        },
        "author": {
            "id": u.get("id_str").cloned().unwrap_or(Value::Null),
            "name": u.get("name").cloned().unwrap_or(Value::Null),
            "username": u.get("screen_name").cloned().unwrap_or(Value::Null),
            "verified": u.get("is_blue_verified").cloned().unwrap_or(json!(false)),
            "avatar": u.get("profile_image_url_https").cloned().unwrap_or(Value::Null),
        },
        "reply": Value::Null,
        "media": media,
        "entities": { "urls": [], "mentions": [], "hashtags": [], "cashtags": [] },
        "url": format!("https://x.com/{}/status/{}", u.get("screen_name").and_then(|s| s.as_str()).unwrap_or("i"), id_str),
        "source": "syndication",
    })])
}

async fn resolve_tco(tco: &str) -> String {
    let Some(client) = reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()
    else {
        return tco.to_string();
    };
    let Ok(r) = client.get(tco).send().await else {
        return tco.to_string();
    };
    let status = r.status().as_u16();
    if (300..400).contains(&status) {
        if let Some(loc) = r.headers().get("location").and_then(|l| l.to_str().ok()) {
            return loc.to_string();
        }
    }
    let body = r.text().await.unwrap_or_default();
    for re in [
        regex::Regex::new(r#"location\.replace\("(.+?)"\)"#).unwrap(),
        regex::Regex::new(r#"(?i)URL=(.+?)["']?>"#).unwrap(),
        regex::Regex::new(r"(?is)<title>(.*?)</title>").unwrap(),
    ] {
        if let Some(m) = re.captures(&body).and_then(|c| c.get(1)) {
            return m.as_str().replace("\\/", "/").replace("&amp;", "&");
        }
    }
    tco.to_string()
}

async fn fill_urls(tw: &mut Value) {
    let text = tw.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let re = regex::Regex::new(r"(https://t\.co/\w+)").unwrap();
    let mut list: Vec<Value> = tw
        .get("entities")
        .and_then(|e| e.get("urls"))
        .and_then(|u| u.as_array())
        .cloned()
        .unwrap_or_default();
    for tco in re.find_iter(&text).map(|m| m.as_str().to_string()).collect::<std::collections::HashSet<_>>() {
        let already = list
            .iter()
            .any(|e| e.get("short").and_then(|s| s.as_str()) == Some(&tco));
        if !already {
            list.push(json!({ "short": tco, "expanded": Value::Null }));
        }
    }
    for u in list.iter_mut() {
        if let Some(short) = u.get("short").and_then(|s| s.as_str()) {
            if short.contains("t.co") {
                let expanded = resolve_tco(short).await;
                u["expanded"] = Value::String(expanded);
            }
        }
    }
    if let Some(entities) = tw.get_mut("entities") {
        entities["urls"] = Value::Array(list);
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| -> Option<String> {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|Json(v)| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()))
        })
    };
    let tweet_id = get("id")
        .as_deref()
        .and_then(id_of)
        .or_else(|| get("url").as_deref().and_then(id_of));
    let Some(tweet_id) = tweet_id else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "error": "Parameter 'id' atau 'url' wajib diisi"
        })))
        .into_response();
    };

    let mut tweets = ssr(&tweet_id).await;
    if tweets.is_empty() {
        if let Some(s) = synd(&tweet_id).await {
            tweets = s;
        }
    }
    if tweets.is_empty() {
        return (StatusCode::NOT_FOUND, Json(json!({
            "status": false,
            "error": "Tweet tidak ditemukan (deleted/private?)"
        })))
        .into_response();
    }

    for tw in tweets.iter_mut() {
        if tw.get("source").and_then(|s| s.as_str()) == Some("ssr") {
            fill_urls(tw).await;
        }
    }
    // sort: matching tweet id first
    tweets.sort_by_key(|tw| {
        let id = tw.get("id").and_then(|i| i.as_str()).unwrap_or("");
        if id == tweet_id { 0 } else { 1 }
    });

    Json(json!({ "status": true, "count": tweets.len(), "tweets": tweets })).into_response()
}

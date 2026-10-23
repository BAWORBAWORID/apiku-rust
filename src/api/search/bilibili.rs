// Bilibili Search — native conversion of api/search/bilibili.js
// api.bilibili.tv gateway: search (all/anime), detail, play (stream),
// trending, schedule. Buvid3 diambil dari cookie homepage atau digenerate.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .unwrap_or_default()
}

fn generate_buvid3() -> String {
    let hex = |len: usize| -> String {
        (0..len).map(|_| format!("{:x}", rand_u4())).collect()
    };
    format!("{}-{}-4{}-8{}-{}infoc", hex(8), hex(4), hex(3), hex(3), hex(12))
}

// xorshift PRNG sederhana (tanpa dependency rand)
fn rand_u4() -> u32 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static STATE: AtomicU64 = AtomicU64::new(0);
    let mut s = STATE.load(Ordering::Relaxed);
    if s == 0 {
        s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64 | 1;
    }
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    STATE.store(s, Ordering::Relaxed);
    (s & 0xF) as u32
}

fn clean_id(input: &str) -> String {
    let input = input.trim();
    if input.contains('/') {
        // ambil angka setelah '/' terakhir
        if let Some(last) = input.rsplit('/').find(|seg| !seg.is_empty() && seg.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
            let num: String = last.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !num.is_empty() {
                return num;
            }
        }
    }
    match input.split(|c: char| !c.is_ascii_digit()).find(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => input.to_string(),
    }
}

/// Ambil buvid3 dari cookie set-cookie homepage (via response header), fallback generate.
async fn init_buvid3(client: &reqwest::Client, lang: &str) -> String {
    let res = client.get(format!("https://www.bilibili.tv/{}", lang))
                    .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
        .send()
        .await;
    if let Ok(r) = res {
        for cookie in r.cookies() {
            if cookie.name() == "buvid3" {
                return cookie.value().to_string();
            }
        }
    }
    generate_buvid3()
}

async fn get_json(client: &reqwest::Client, buvid3: &str, lang: &str, api_url: &str) -> Result<Value, String> {
    let cookie = format!("buvid3={}; bstar-web-lang={}", buvid3, lang);
    let res = client.get(api_url)
                    .header("Referer", "https://www.bilibili.tv/")
                    .header("Origin", "https://www.bilibili.tv")
                    .header("Accept", "application/json, text/plain, */*")
        .header("Cookie", cookie)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if status != 200 {
        return Err(format!("Bilibili HTTP error: {}", status));
    }
    if !body.is_object() {
        return Err("Invalid response dari Bilibili".into());
    }
    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code != 0 {
        return Err(format!("Bilibili error {}: {}", code, body.get("message").and_then(Value::as_str).unwrap_or("Unknown error")));
    }
    Ok(body.get("data").cloned().unwrap_or(Value::Null))
}

fn anime_item(lang: &str, season_id: &Value, title: &Value, cover: &Value, view: &Value, index_show: &Value) -> Value {
    let sid = season_id.as_i64().map(|v| json!(v)).unwrap_or_else(|| season_id.clone());
    json!({
        "type": "anime",
        "id": sid,
        "title": title,
        "cover": cover,
        "views": view,
        "index_show": index_show,
        "url": format!("https://www.bilibili.tv/{}/play/{}", lang, season_id),
    })
}

async fn search_anime(client: &reqwest::Client, buvid3: &str, lang: &str, keyword: &str, page: i64, limit: i64) -> Result<Vec<Value>, String> {
    let pn = page.max(1);
    let ps = limit.max(1);
    let api = format!("https://api.bilibili.tv/intl/gateway/web/v2/search_v2/anime?keyword={}&pn={}&ps={}&platform=web", urlencoding::encode(keyword), pn, ps);
    let data = get_json(client, buvid3, lang, &api).await?;
    let items = data.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    for it in &items {
        if results.len() >= ps as usize {
            break;
        }
        results.push(anime_item(lang, it.get("season_id").unwrap_or(&Value::Null), it.get("title").unwrap_or(&Value::Null), it.get("cover").unwrap_or(&Value::Null), it.get("view").unwrap_or(&Value::Null), it.get("index_show").unwrap_or(&Value::Null)));
    }
    Ok(results)
}

async fn search_all(client: &reqwest::Client, buvid3: &str, lang: &str, keyword: &str, page: i64, limit: i64) -> Result<Vec<Value>, String> {
    let pn = page.max(1);
    let ps = limit.max(1);
    let api = format!("https://api.bilibili.tv/intl/gateway/web/v2/search_v2?keyword={}&highlight=1&pn={}&ps={}&qid=&sort=0&duration_type=0&platform=web", urlencoding::encode(keyword), pn, ps);
    let data = get_json(client, buvid3, lang, &api).await?;
    let modules = data.get("modules").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    'outer: for module in &modules {
        let items = module.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        for it in &items {
            if results.len() >= ps as usize {
                break 'outer;
            }
            if let Some(seasons) = it.get("seasons").and_then(Value::as_array).filter(|s| !s.is_empty()) {
                for s in seasons {
                    results.push(anime_item(lang, s.get("season_id").unwrap_or(&Value::Null), s.get("title").unwrap_or(&Value::Null), s.get("cover").unwrap_or(&Value::Null), s.get("view").unwrap_or(&Value::Null), s.get("index_show").unwrap_or(&Value::Null)));
                }
            } else if let Some(aid) = it.get("aid") {
                results.push(json!({
                    "type": "ugc",
                    "id": aid,
                    "title": it.get("title").cloned().unwrap_or(Value::Null),
                    "cover": it.get("cover").cloned().unwrap_or(Value::Null),
                    "views": it.get("view").cloned().unwrap_or(Value::Null),
                    "duration": it.get("duration").cloned().unwrap_or(Value::Null),
                    "author": it.pointer("/author/nickname").cloned().unwrap_or(json!("")),
                    "author_id": it.pointer("/author/mid").cloned().unwrap_or(json!("")),
                    "url": format!("https://www.bilibili.tv/{}/video/{}", lang, aid),
                }));
            }
        }
    }
    Ok(results)
}

async fn get_anime_details(client: &reqwest::Client, buvid3: &str, lang: &str, season_id: &str) -> Result<Value, String> {
    let clean = clean_id(season_id);
    let info_url = format!("https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/season_info?season_id={}&platform=web", clean);
    let episodes_url = format!("https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/episodes?season_id={}&platform=web", clean);

    let (info_data, ep_data) = tokio::join!(
        async { get_json(client, buvid3, lang, &info_url).await.unwrap_or(json!({})) },
        async { get_json(client, buvid3, lang, &episodes_url).await.unwrap_or(json!({})) }
    );

    let season = info_data.get("season").cloned().unwrap_or(json!({}));
    let styles: Vec<Value> = season.get("styles").and_then(Value::as_array).map(|a| a.iter().map(|s| s.get("title").cloned().unwrap_or(Value::Null)).collect()).unwrap_or_default();

    let mut episodes = Vec::new();
    if let Some(sections) = ep_data.get("sections").and_then(Value::as_array) {
        for sec in sections {
            for ep in sec.get("episodes").and_then(Value::as_array).cloned().unwrap_or_default() {
                let ep_id = ep.get("episode_id").cloned().unwrap_or(Value::Null);
                episodes.push(json!({
                    "episode_id": ep_id,
                    "title_display": ep.get("title_display").cloned().unwrap_or(Value::Null),
                    "short_title": ep.get("short_title_display").cloned().unwrap_or(Value::Null),
                    "cover": ep.get("cover").cloned().unwrap_or(Value::Null),
                    "publish_time": ep.get("publish_time").cloned().unwrap_or(Value::Null),
                    "is_free": ep.get("limit").and_then(Value::as_i64).unwrap_or(1) == 0,
                    "limit_text": ep.get("limit_text").cloned().unwrap_or(json!("")),
                    "play_url": format!("https://www.bilibili.tv/{}/play/{}/{}", lang, clean, ep_id),
                }));
            }
        }
    }

    Ok(json!({
        "season_id": season.get("season_id").cloned().unwrap_or(json!(clean)),
        "title": season.get("title").cloned().unwrap_or(json!("")),
        "origin_name": season.get("origin_name").cloned().unwrap_or(json!("")),
        "alias_name": season.get("alias_name").cloned().unwrap_or(json!("")),
        "cover": season.get("cover").cloned().unwrap_or(json!("")),
        "views": season.get("view").cloned().unwrap_or(json!("")),
        "description": season.get("description").cloned().unwrap_or(json!("")),
        "release_date": season.get("player_date").cloned().unwrap_or(json!("")),
        "styles": styles,
        "episodes": episodes,
        "total_episodes": episodes.len(),
    }))
}

async fn get_play_url(client: &reqwest::Client, buvid3: &str, lang: &str, target: &str) -> Result<Value, String> {
    let _ = lang;
    let clean = clean_id(target);
    let is_aid = clean.len() > 12 || target.to_lowercase().starts_with("ugc") || target.contains("/video/");

    let play_api = if is_aid {
        format!("https://api.bilibili.tv/intl/gateway/web/playurl?platform=web&aid={}", clean)
    } else {
        format!("https://api.bilibili.tv/intl/gateway/web/playurl?platform=web&ep_id={}", clean)
    };
    let sub_api = if is_aid {
        format!("https://api.bilibili.tv/intl/gateway/web/v2/subtitle?platform=web&s_locale=en_US&aid={}", clean)
    } else {
        format!("https://api.bilibili.tv/intl/gateway/web/v2/subtitle?platform=web&s_locale=en_US&episode_id={}", clean)
    };

    let (play_data, sub_data) = tokio::join!(
        get_json(client, buvid3, "id", &play_api),
        async { get_json(client, buvid3, "id", &sub_api).await.unwrap_or(json!({})) }
    );
    let play_data = play_data?;

    let play_url = play_data.get("playurl").cloned().unwrap_or(json!({}));

    let mut video_streams = Vec::new();
    for v in play_url.get("video").and_then(Value::as_array).cloned().unwrap_or_default() {
        let res = v.get("video_resource").cloned().unwrap_or(Value::Null);
        if res.is_null() || res.get("url").and_then(Value::as_str).unwrap_or("").is_empty() {
            continue;
        }
        video_streams.push(json!({
            "quality": res.get("quality").cloned().unwrap_or(Value::Null),
            "desc_words": v.pointer("/stream_info/desc_words").cloned().unwrap_or(json!("")),
            "width": res.get("width").cloned().unwrap_or(Value::Null),
            "height": res.get("height").cloned().unwrap_or(Value::Null),
            "bandwidth": res.get("bandwidth").cloned().unwrap_or(Value::Null),
            "codecs": res.get("codecs").cloned().unwrap_or(Value::Null),
            "size": res.get("size").cloned().unwrap_or(Value::Null),
            "url": res.get("url").cloned().unwrap_or(Value::Null),
        }));
    }

    let mut audio_streams = Vec::new();
    for a in play_url.get("audio_resource").and_then(Value::as_array).cloned().unwrap_or_default() {
        if a.get("url").and_then(Value::as_str).unwrap_or("").is_empty() {
            continue;
        }
        audio_streams.push(json!({
            "quality": a.get("quality").cloned().unwrap_or(Value::Null),
            "bandwidth": a.get("bandwidth").cloned().unwrap_or(Value::Null),
            "codecs": a.get("codecs").cloned().unwrap_or(Value::Null),
            "size": a.get("size").cloned().unwrap_or(Value::Null),
            "url": a.get("url").cloned().unwrap_or(Value::Null),
        }));
    }

    let mut subtitles = Vec::new();
    for s in sub_data.get("subtitles").and_then(Value::as_array).cloned().unwrap_or_default() {
        if !s.get("url").and_then(Value::as_str).unwrap_or("").is_empty() {
            subtitles.push(json!({
                "lang_key": s.get("lang_key").cloned().unwrap_or(Value::Null),
                "lang": s.get("lang").cloned().unwrap_or(Value::Null),
                "url": s.get("url").cloned().unwrap_or(Value::Null),
            }));
        }
    }

    Ok(json!({
        "id": clean,
        "type": if is_aid { "ugc_video" } else { "ogv_episode" },
        "duration_ms": play_url.get("duration").cloned().unwrap_or(Value::Null),
        "videos": video_streams,
        "audios": audio_streams,
        "subtitles": subtitles,
        "required_headers": {
            "Referer": "https://www.bilibili.tv/",
            "User-Agent": USER_AGENT,
        },
    }))
}

async fn get_trending(client: &reqwest::Client, buvid3: &str, lang: &str, limit: usize) -> Result<Vec<Value>, String> {
    let api = "https://api.bilibili.tv/intl/gateway/web/v2/home/ogv/trending?platform=web";
    let data = get_json(client, buvid3, lang, api).await?;
    let cards = data.get("cards").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    for c in &cards {
        if results.len() >= limit {
            break;
        }
        results.push(anime_item(lang, c.get("season_id").unwrap_or(&Value::Null), c.get("title").unwrap_or(&Value::Null), c.get("cover").unwrap_or(&Value::Null), c.get("view").unwrap_or(&Value::Null), c.get("index_show").unwrap_or(&Value::Null)));
    }
    Ok(results)
}

async fn get_timeline(client: &reqwest::Client, buvid3: &str, lang: &str) -> Result<Vec<Value>, String> {
    let api = "https://api.bilibili.tv/intl/gateway/web/v2/ogv/timeline?platform=web";
    let data = get_json(client, buvid3, lang, api).await?;
    let items = data.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut schedule = Vec::new();
    for day in &items {
        let mut anime_list = Vec::new();
        for card in day.get("cards").and_then(Value::as_array).cloned().unwrap_or_default() {
            let sid = card.get("season_id").cloned().unwrap_or(Value::Null);
            anime_list.push(json!({
                "season_id": sid,
                "title": card.get("title").cloned().unwrap_or(Value::Null),
                "cover": card.get("cover").cloned().unwrap_or(Value::Null),
                "views": card.get("view").cloned().unwrap_or(Value::Null),
                "index_show": format!("{} ({})", card.get("index_show").and_then(Value::as_str).unwrap_or(""), card.get("pub_time_text").and_then(Value::as_str).unwrap_or("")),
                "styles": card.get("style_list").cloned().unwrap_or(json!([])),
                "url": format!("https://www.bilibili.tv/{}/play/{}", lang, sid),
            }));
        }
        schedule.push(json!({
            "day_of_week": day.get("full_day_of_week").cloned().unwrap_or_else(|| day.get("day_of_week").cloned().unwrap_or(Value::Null)),
            "date_text": day.get("date_text").cloned().unwrap_or(Value::Null),
            "is_today": day.get("is_today").and_then(Value::as_bool).unwrap_or(false),
            "anime": anime_list,
        }));
    }
    Ok(schedule)
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if !v.is_empty() {
                    return Some(v.clone());
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
    let get_num = |keys: &[&str], default: i64| -> i64 {
        for k in keys {
            if let Some(v) = query.get(*k) {
                if let Ok(n) = v.parse::<i64>() {
                    return n;
                }
            }
            if let Some(Json(v)) = &body {
                if let Some(n) = v.get(*k).and_then(Value::as_i64) {
                    return n;
                }
            }
        }
        default
    };

    let action = get_param(&["action"]).map(|a| a.to_lowercase()).unwrap_or_else(|| "search".to_string());
    let lang = get_param(&["lang"]).unwrap_or_else(|| "id".to_string());
    let page = get_num(&["page"], 1);
    let limit = get_num(&["limit"], 20);

    let client = http();
    let buvid3 = init_buvid3(&client, &lang).await;

    let result: Result<Value, String> = async {
        match action.as_str() {
            "trending" => {
                let r = get_trending(&client, &buvid3, &lang, limit.max(0) as usize).await?;
                Ok(json!({"mode": "trending", "total": r.len(), "result": r}))
            }
            "schedule" => {
                let r = get_timeline(&client, &buvid3, &lang).await?;
                Ok(json!({"mode": "schedule", "total": r.len(), "result": r}))
            }
            "detail" => {
                let target = get_param(&["url", "id", "season_id", "query"]).unwrap_or_default();
                if target.is_empty() {
                    return Err("__BAD__Parameter 'url' atau 'id' (season_id) wajib diisi untuk action detail".into());
                }
                let r = get_anime_details(&client, &buvid3, &lang, &target).await?;
                Ok(json!({"mode": "detail", "result": r}))
            }
            "play" => {
                let target = get_param(&["url", "id", "episode_id", "aid", "query"]).unwrap_or_default();
                if target.is_empty() {
                    return Err("__BAD__Parameter 'url' atau 'id' (episode_id / aid) wajib diisi untuk action play".into());
                }
                let r = get_play_url(&client, &buvid3, &lang, &target).await?;
                Ok(json!({"mode": "play", "result": r}))
            }
            _ => {
                // default: search
                let query = get_param(&["query", "q"]).unwrap_or_default().trim().to_string();
                if query.is_empty() {
                    return Err("__BAD__Parameter 'query' wajib diisi untuk pencarian".into());
                }
                let type_ = get_param(&["type"]).map(|t| t.to_lowercase()).unwrap_or_else(|| "all".to_string());
                let mut videos = if type_ == "anime" {
                    let mut v = search_anime(&client, &buvid3, &lang, &query, page, limit).await?;
                    if v.is_empty() {
                        v = search_all(&client, &buvid3, &lang, &query, page, limit).await?;
                    }
                    v
                } else {
                    search_all(&client, &buvid3, &lang, &query, page, limit).await?
                };
                let total = videos.len();
                Ok(json!({"mode": "search", "query": query, "type": type_, "page": page, "total": total, "result": std::mem::take(&mut videos)}))
            }
        }
    }
    .await;

    match result {
        Ok(v) => {
            let mut obj = json!({"status": true});
            if let (Some(dst), Some(src)) = (obj.as_object_mut(), v.as_object()) {
                dst.extend(src.iter().map(|(k, v)| (k.clone(), v.clone())));
            }
            Json(obj).into_response()
        }
        Err(e) => {
            if let Some(msg) = e.strip_prefix("__BAD__") {
                err(StatusCode::BAD_REQUEST, msg)
            } else {
                err(StatusCode::INTERNAL_SERVER_ERROR, &e)
            }
        }
    }
}

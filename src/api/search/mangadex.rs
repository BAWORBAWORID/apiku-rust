// MangaDex — native conversion of api/search/mangadex.js
// Wrapper api.mangadex.org: search, home, popular, recent, latest, detail,
// random, chapters, allchapters, chapter, read (MD@Home), covers, tags, stats.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const API: &str = "https://api.mangadex.org";
const UP: &str = "https://uploads.mangadex.org";
const REPORT: &str = "https://api.mangadex.network/report";
const ACTIONS: [&str; 14] = ["search", "home", "popular", "recent", "latest", "detail", "random", "chapters", "allchapters", "chapter", "read", "covers", "tags", "stats"];

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("MangaDex-Wrapper/3.1")
        .build()
        .map_err(|e| e.to_string())
}

fn last_req() -> &'static Mutex<Option<Instant>> {
    static L: std::sync::OnceLock<Mutex<Option<Instant>>> = std::sync::OnceLock::new();
    L.get_or_init(|| Mutex::new(None))
}

async fn api(c: &reqwest::Client, path: &str, params: &[(&str, String)]) -> Result<Value, (StatusCode, String)> {
    // rate limit 220ms
    {
        let wait_ms = {
            let mut last = last_req().lock().unwrap();
            if let Some(t) = *last {
                let elapsed = t.elapsed().as_millis() as u64;
                if elapsed < 220 {
                    Some(220 - elapsed)
                } else {
                    None
                }
            } else {
                None
            }
        };
        if let Some(ms) = wait_ms {
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
        *last_req().lock().unwrap() = Some(Instant::now());
    }
    let mut req = c.get(format!("{}{}", API, path));
    for (k, v) in params {
        req = req.query(&[(k, v)]);
    }
    let res = req.send().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("API ?: {}", e)))?;
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(json!({}));
    if !(200..300).contains(&status) {
        let msg = body
            .pointer("/errors/0/detail")
            .or_else(|| body.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err((StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), format!("API {}: {}", status, msg)));
    }
    Ok(body)
}

fn pick(obj: Option<&Value>) -> Option<String> {
    let obj = obj?;
    const LANGS: [&str; 4] = ["en", "ja-ro", "ja", "id"];
    for l in LANGS {
        if let Some(v) = obj.get(l).and_then(Value::as_str) {
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    obj.as_object().and_then(|m| m.values().next()).and_then(Value::as_str).map(str::to_string)
}

fn manga_obj(e: &Value) -> Value {
    let a = e.get("attributes").cloned().unwrap_or(json!({}));
    let rels = e.get("relationships").and_then(Value::as_array).cloned().unwrap_or_default();
    let cover = rels.iter().find(|r| r.get("type").and_then(Value::as_str) == Some("cover_art"));
    let file_name = cover.and_then(|cc| cc.pointer("/attributes/fileName").and_then(Value::as_str)).unwrap_or("");
    let mut authors: Vec<String> = Vec::new();
    for r in &rels {
        let t = r.get("type").and_then(Value::as_str).unwrap_or("");
        if t == "author" || t == "artist" {
            if let Some(n) = r.pointer("/attributes/name").and_then(Value::as_str) {
                authors.push(n.to_string());
            }
        }
    }
    authors.sort();
    authors.dedup();
    let id = e.get("id").and_then(Value::as_str).unwrap_or("");
    let cover_field = |suffix: &str| if file_name.is_empty() { Value::Null } else { json!(format!("{}/covers/{}/{}{}", UP, id, file_name, suffix)) };
    json!({
        "id": id,
        "title": pick(a.get("title")),
        "description": pick(a.get("description")).map(|d| json!(d.chars().take(500).collect::<String>())).filter(|d| d.as_str().map(|s| !s.is_empty()).unwrap_or(false)),
        "status": a.get("status").cloned().unwrap_or(Value::Null),
        "year": a.get("year").cloned().unwrap_or(Value::Null),
        "originalLanguage": a.get("originalLanguage").cloned().unwrap_or(Value::Null),
        "contentRating": a.get("contentRating").cloned().unwrap_or(Value::Null),
        "tags": a.get("tags").and_then(Value::as_array).map(|ts| ts.iter().filter_map(|t| pick(t.pointer("/attributes/name"))).take(15).collect::<Vec<_>>()).unwrap_or_default(),
        "authors": authors,
        "cover": cover_field(".256.jpg"),
        "coverFull": cover_field(""),
        "lastChapter": a.get("lastChapter").cloned().unwrap_or(Value::Null),
        "lastVolume": a.get("lastVolume").cloned().unwrap_or(Value::Null),
    })
}

fn chapter_obj(e: &Value) -> Value {
    let a = e.get("attributes").cloned().unwrap_or(json!({}));
    let rels = e.get("relationships").and_then(Value::as_array).cloned().unwrap_or_default();
    let manga = rels.iter().find(|r| r.get("type").and_then(Value::as_str) == Some("manga"));
    let groups: Vec<Value> = rels
        .iter()
        .filter(|r| r.get("type").and_then(Value::as_str) == Some("scanlation_group"))
        .map(|r| r.pointer("/attributes/name").cloned().unwrap_or_else(|| r.get("id").cloned().unwrap_or(Value::Null)))
        .collect();
    json!({
        "id": e.get("id").cloned().unwrap_or(Value::Null),
        "chapter": a.get("chapter").cloned().unwrap_or(Value::Null),
        "volume": a.get("volume").cloned().unwrap_or(Value::Null),
        "title": a.get("title").cloned().unwrap_or(Value::Null),
        "lang": a.get("translatedLanguage").cloned().unwrap_or(Value::Null),
        "pages": a.get("pages").cloned().unwrap_or(Value::Null),
        "publishAt": a.get("publishAt").cloned().unwrap_or(Value::Null),
        "externalUrl": a.get("externalUrl").cloned().unwrap_or(Value::Null),
        "mangaId": manga.and_then(|m| m.get("id")).cloned().unwrap_or(Value::Null),
        "mangaTitle": manga.and_then(|m| m.get("attributes")).and_then(|m| pick(m.get("title"))),
        "groups": groups,
    })
}

fn list_of(data: &Value, map_fn: impl Fn(&Value) -> Value) -> Value {
    json!({
        "data": data.get("data").and_then(Value::as_array).map(|a| a.iter().map(&map_fn).collect::<Vec<_>>()).unwrap_or_default(),
        "total": data.get("total").cloned().unwrap_or(json!(0)),
        "limit": data.get("limit").cloned().unwrap_or(json!(0)),
        "offset": data.get("offset").cloned().unwrap_or(json!(0)),
    })
}

async fn do_search(c: &reqwest::Client, title: Option<&str>, limit: usize, offset: usize, lang: Option<&str>, status: Option<&str>, order: &[(&str, &str)], has_available: bool) -> Result<Value, (StatusCode, String)> {
    let mut params: Vec<(&str, String)> = vec![
        ("limit", limit.min(100).to_string()),
        ("offset", offset.to_string()),
        ("includes[]", "cover_art".into()),
        ("includes[]", "author".into()),
        ("includes[]", "artist".into()),
    ];
    if let Some(t) = title {
        params.push(("title", t.to_string()));
    }
    if let Some(s) = status {
        params.push(("status[]", s.to_string()));
    }
    if let Some(l) = lang {
        params.push(("availableTranslatedLanguage[]", l.to_string()));
    }
    for (k, v) in order {
        params.push((format!("order[{}]", k).leak(), v.to_string()));
    }
    if has_available {
        params.push(("hasAvailableChapters", "true".into()));
    }
    params.push(("contentRating[]", "safe".into()));
    params.push(("contentRating[]", "suggestive".into()));
    params.push(("contentRating[]", "erotica".into()));
    let data = api(c, "/manga", &params).await?;
    Ok(list_of(&data, manga_obj))
}

async fn popular(c: &reqwest::Client, limit: usize, offset: usize) -> Result<Value, (StatusCode, String)> {
    do_search(c, None, limit, offset, None, None, &[("followedCount", "desc")], true).await
}

async fn recent(c: &reqwest::Client, limit: usize, offset: usize) -> Result<Value, (StatusCode, String)> {
    do_search(c, None, limit, offset, None, None, &[("createdAt", "desc")], true).await
}

async fn latest(c: &reqwest::Client, limit: usize, offset: usize, lang: &str) -> Result<Value, (StatusCode, String)> {
    let params = [
        ("limit", limit.min(100).to_string()),
        ("offset", offset.to_string()),
        ("translatedLanguage[]", lang.to_string()),
        ("order[readableAt]", "desc".to_string()),
        ("includes[]", "manga".to_string()),
        ("includes[]", "scanlation_group".to_string()),
        ("contentRating[]", "safe".to_string()),
        ("contentRating[]", "suggestive".to_string()),
        ("contentRating[]", "erotica".to_string()),
        ("contentRating[]", "pornographic".to_string()),
        ("includeFutureUpdates", "0".to_string()),
    ];
    let data = api(c, "/chapter", &params).await?;
    let mut list = list_of(&data, chapter_obj);
    if let Some(arr) = list.get_mut("data").and_then(Value::as_array_mut) {
        arr.retain(|cc| cc.get("pages").and_then(Value::as_i64).unwrap_or(0) > 0);
    }
    Ok(list)
}

async fn home(c: &reqwest::Client, limit: usize, lang: &str) -> Result<Value, (StatusCode, String)> {
    let (p, l, r) = tokio::join!(popular(c, limit, 0), latest(c, limit, 0, lang), recent(c, limit, 0));
    Ok(json!({"popular": p?.get("data").cloned().unwrap_or(json!([])), "latest": l?.get("data").cloned().unwrap_or(json!([])), "recent": r?.get("data").cloned().unwrap_or(json!([]))}))
}

async fn detail(c: &reqwest::Client, id: &str) -> Result<Value, (StatusCode, String)> {
    let params = [
        ("includes[]", "cover_art".to_string()),
        ("includes[]", "author".to_string()),
        ("includes[]", "artist".to_string()),
        ("includes[]", "tag".to_string()),
    ];
    let data = api(c, &format!("/manga/{}", id), &params).await?;
    Ok(manga_obj(data.get("data").unwrap_or(&json!({}))))
}

async fn random(c: &reqwest::Client) -> Result<Value, (StatusCode, String)> {
    let params = [
        ("includes[]", "cover_art".to_string()),
        ("includes[]", "author".to_string()),
        ("includes[]", "artist".to_string()),
    ];
    let data = api(c, "/manga/random", &params).await?;
    Ok(manga_obj(data.get("data").unwrap_or(&json!({}))))
}

async fn chapters(c: &reqwest::Client, manga_id: &str, limit: usize, offset: usize, lang: &str, include_empty: bool) -> Result<Value, (StatusCode, String)> {
    let params = [
        ("limit", limit.min(100).to_string()),
        ("offset", offset.to_string()),
        ("translatedLanguage[]", lang.to_string()),
        ("order[volume]", "asc".to_string()),
        ("order[chapter]", "asc".to_string()),
        ("includes[]", "scanlation_group".to_string()),
        ("contentRating[]", "safe".to_string()),
        ("contentRating[]", "suggestive".to_string()),
        ("contentRating[]", "erotica".to_string()),
        ("contentRating[]", "pornographic".to_string()),
        ("includeFutureUpdates", "0".to_string()),
        ("includeEmptyPages", if include_empty { "1" } else { "0" }.to_string()),
        ("includeExternalUrl", if include_empty { "1" } else { "0" }.to_string()),
    ];
    let data = api(c, &format!("/manga/{}/feed", manga_id), &params).await?;
    let mut list = list_of(&data, chapter_obj);
    if !include_empty {
        if let Some(arr) = list.get_mut("data").and_then(Value::as_array_mut) {
            arr.retain(|cc| {
                cc.get("pages").and_then(Value::as_i64).unwrap_or(0) > 0
                    && cc.get("externalUrl").map(|e| e.is_null()).unwrap_or(true)
            });
        }
    }
    Ok(list)
}

async fn all_chapters(c: &reqwest::Client, manga_id: &str, lang: &str, include_empty: bool) -> Result<Vec<Value>, (StatusCode, String)> {
    let mut all = Vec::new();
    let mut offset = 0usize;
    let mut total = usize::MAX;
    while offset < total {
        let page = chapters(c, manga_id, 100, offset, lang, include_empty).await?;
        total = page.get("total").and_then(Value::as_u64).unwrap_or(0) as usize;
        let data = page.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        let had_data = !data.is_empty();
        all.extend(data);
        offset += 100;
        if !had_data {
            break;
        }
    }
    Ok(all)
}

async fn chapter(c: &reqwest::Client, id: &str) -> Result<Value, (StatusCode, String)> {
    let params = [
        ("includes[]", "manga".to_string()),
        ("includes[]", "scanlation_group".to_string()),
    ];
    let data = api(c, &format!("/chapter/{}", id), &params).await?;
    Ok(chapter_obj(data.get("data").unwrap_or(&json!({}))))
}

async fn probe(c: &reqwest::Client, url: &str) -> bool {
    let res = c
        .head(url)
                    .header("Referer", "https://mangadex.org/")
        .timeout(Duration::from_secs(8))
        .send()
        .await;
    match res {
        Ok(r) => r.status().is_success() || r.status().as_u16() < 400,
        Err(_) => {
            // fallback GET with Range: bytes=0-0
            match c
                .get(url)
                            .header("Referer", "https://mangadex.org/")
                            .header("Range", "bytes=0-0")
                .timeout(Duration::from_secs(10))
                .send()
                .await
            {
                Ok(r) => r.status().as_u16() >= 200 && r.status().as_u16() < 400,
                Err(_) => false,
            }
        }
    }
}

async fn report(url: String, success: bool) {
    let Ok(http) = reqwest::Client::builder().timeout(Duration::from_secs(5)).build() else { return };
    let _ = http
        .post(REPORT)
        .json(&json!({"url": url, "success": success, "bytes": 0, "duration": 0, "cached": false}))
        .send()
        .await;
}

async fn read(c: &reqwest::Client, chapter_id: &str, quality: &str) -> Result<Value, (StatusCode, String)> {
    let q = if quality == "data-saver" { "data-saver" } else { "data" };
    let mut last_err = String::from("Failed to get readable pages");
    for attempt in 0..=3u32 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
        }
        let data = match api(c, &format!("/at-home/server/{}", chapter_id), &[]).await {
            Ok(d) => d,
            Err((_, e)) => {
                last_err = e;
                continue;
            }
        };
        let hash = data.pointer("/chapter/hash").and_then(Value::as_str).unwrap_or("");
        if hash.is_empty() {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, "No page data (external/empty chapter?)".into()));
        }
        let files: Vec<String> = data
            .pointer(if q == "data-saver" { "/chapter/dataSaver" } else { "/chapter/data" })
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default();
        if files.is_empty() {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, "No page files (pages=0 or external)".into()));
        }
        let base_url = data.get("baseUrl").and_then(Value::as_str).unwrap_or("");
        let urls: Vec<String> = files.iter().map(|f| format!("{}/{}/{}/{}", base_url, q, hash, f)).collect();
        if probe(c, &urls[0]).await {
            return Ok(json!({"chapterId": chapter_id, "quality": q, "count": urls.len(), "urls": urls}));
        }
        tokio::spawn(report(urls[0].clone(), false));
        last_err = format!("MD@Home node failed (attempt {}/{})", attempt + 1, 4);
    }
    Err((StatusCode::INTERNAL_SERVER_ERROR, last_err))
}

async fn covers(c: &reqwest::Client, manga_id: &str, limit: usize) -> Result<Vec<Value>, (StatusCode, String)> {
    let params = [
        ("manga[]", manga_id.to_string()),
        ("limit", limit.min(100).to_string()),
        ("order[volume]", "asc".to_string()),
    ];
    let data = api(c, "/cover", &params).await?;
    Ok(data
        .get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|e| {
                    let a = e.get("attributes").cloned().unwrap_or(json!({}));
                    let fname = a.get("fileName").and_then(Value::as_str).unwrap_or("");
                    json!({
                        "id": e.get("id").cloned().unwrap_or(Value::Null),
                        "volume": a.get("volume").cloned().unwrap_or(Value::Null),
                        "fileName": a.get("fileName").cloned().unwrap_or(Value::Null),
                        "url": format!("{}/covers/{}/{}", UP, manga_id, fname),
                        "url256": format!("{}/covers/{}/{}.256.jpg", UP, manga_id, fname),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

async fn tags(c: &reqwest::Client) -> Result<Vec<Value>, (StatusCode, String)> {
    let data = api(c, "/manga/tag", &[]).await?;
    Ok(data
        .get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    json!({
                        "id": t.get("id").cloned().unwrap_or(Value::Null),
                        "name": pick(t.pointer("/attributes/name")),
                        "group": t.pointer("/attributes/group").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

async fn stats(c: &reqwest::Client, manga_id: &str) -> Result<Value, (StatusCode, String)> {
    let params = [("manga[]", manga_id.to_string())];
    let data = api(c, "/statistics/manga", &params).await?;
    let s = data.pointer(&format!("/statistics/{}", manga_id)).cloned().unwrap_or(Value::Null);
    if s.is_null() {
        return Ok(Value::Null);
    }
    Ok(json!({
        "follows": s.get("follows").cloned().unwrap_or(Value::Null),
        "rating": s.pointer("/rating/average").cloned().unwrap_or(Value::Null),
        "bayesian": s.pointer("/rating/bayesian").cloned().unwrap_or(Value::Null),
        "comments": s.pointer("/comments/repliesCount").cloned().unwrap_or(json!(0)),
    }))
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

    let mut action = get_param(&["action"]).map(|a| a.trim().to_lowercase()).unwrap_or_default();
    let query_str = get_param(&["query", "q", "title"]).map(|v| v.trim().to_string()).unwrap_or_default();
    let id = get_param(&["id", "mangaId"]).map(|v| v.trim().to_string()).unwrap_or_default();
    let chapter_id = get_param(&["chapterId", "chapter", "ch"]).map(|v| v.trim().to_string()).unwrap_or_default();
    let limit: usize = get_param(&["limit"]).and_then(|l| l.parse().ok()).unwrap_or(20).max(1);
    let offset: usize = get_param(&["offset"]).and_then(|o| o.parse().ok()).unwrap_or(0);
    let lang = get_param(&["lang"]).map(|l| l.trim().to_string()).unwrap_or_else(|| "en".to_string());
    let quality = get_param(&["quality"]).unwrap_or_else(|| "data".to_string());
    let include_empty = get_param(&["empty"]).map(|e| e == "true").unwrap_or(false);

    if action.is_empty() {
        action = if !chapter_id.is_empty() {
            "read".into()
        } else if !id.is_empty() {
            "detail".into()
        } else if !query_str.is_empty() {
            "search".into()
        } else {
            "home".into()
        };
    }
    if !ACTIONS.contains(&action.as_str()) {
        return err(StatusCode::BAD_REQUEST, &format!("Action '{}' tidak dikenali. Pilihan: {}", action, ACTIONS.join(", ")));
    }

    let c = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let result = async {
        match action.as_str() {
            "home" => home(&c, limit, &lang).await,
            "popular" => popular(&c, limit, offset).await,
            "recent" => recent(&c, limit, offset).await,
            "latest" => latest(&c, limit, offset, &lang).await,
            "search" => {
                if query_str.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk action=search".into()));
                }
                do_search(&c, Some(&query_str), limit, offset, Some(&lang), None, &[("relevance", "desc")], false).await
            }
            "detail" | "manga" => {
                let target = if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=detail".into()));
                }
                detail(&c, target).await
            }
            "random" => random(&c).await,
            "chapters" => {
                let target = if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=chapters".into()));
                }
                chapters(&c, target, limit, offset, &lang, include_empty).await
            }
            "allchapters" => {
                let target = if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=allchapters".into()));
                }
                let all = all_chapters(&c, target, &lang, include_empty).await?;
                Ok(json!(all))
            }
            "chapter" => {
                let target = if !chapter_id.is_empty() { &chapter_id } else if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'chapterId' wajib diisi untuk action=chapter".into()));
                }
                chapter(&c, target).await
            }
            "read" | "pages" => {
                let target = if !chapter_id.is_empty() { &chapter_id } else if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'chapterId' wajib diisi untuk action=read".into()));
                }
                read(&c, target, &quality).await
            }
            "covers" | "cover" => {
                let target = if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=covers".into()));
                }
                let list = covers(&c, target, limit).await?;
                Ok(json!(list))
            }
            "tags" => {
                let list = tags(&c).await?;
                Ok(json!(list))
            }
            "stats" => {
                let target = if !id.is_empty() { &id } else { &query_str };
                if target.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, "Parameter 'id' wajib diisi untuk action=stats".into()));
                }
                stats(&c, target).await
            }
            _ => unreachable!(),
        }
    }
    .await;

    match result {
        Ok(r) => Json(json!({"status": true, "action": action, "data": r})).into_response(),
        Err((status, msg)) => err(status, &msg),
    }
}

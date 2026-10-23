// MCPEDL Search & Downloader — native conversion of api/search/mcpedl.js
// MCPEDL (.com API & .org scraping): actions search, detail, home, tags.
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const MCPEDL_COM_API: &str = "https://api.mcpedl.com/api";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg, "timestamp": chrono::Utc::now().timestamp_millis()}))).into_response()
}

fn clients() -> Result<(reqwest::Client, reqwest::Client), String> {
    let org = reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let com = reqwest::Client::builder()
        
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    Ok((org, com))
}

fn normalize_slug(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let mut clean = raw.trim().to_string();
    clean = regex::Regex::new(r"^https?://[^/]+/").unwrap().replace_all(&clean, "").to_string();
    let clean = clean.trim_matches('/');
    let clean = clean.split('?').next().unwrap_or("").split('#').next().unwrap_or("");
    let parts: Vec<&str> = clean.split('/').filter(|s| !s.is_empty()).collect();
    parts.last().map(|s| s.to_string()).unwrap_or_default()
}

async fn search_org(c: &reqwest::Client, query: &str, max_result: usize) -> Vec<Value> {
    let url = format!("https://mcpedl.org/?s={}", urlencoding::encode(query));
    let Ok(html) = c.get(&url).send().await else { return vec![] };
    let Ok(html) = html.text().await else { return vec![] };
    let doc = scraper::Html::parse_document(&html);
    let s = |s: &str| scraper::Selector::parse(s).unwrap();

    let mut results = Vec::new();
    for el in doc.select(&s(".g-block.size-20 article, article.tease-post")) {
        if results.len() >= max_result {
            break;
        }
        let Some(title_el) = el.select(&s(".entry-title a")).next() else { continue };
        let title = title_el.text().collect::<String>().trim().to_string();
        let link = title_el.value().attr("href").unwrap_or("").to_string();
        let image = el
            .select(&s(".post-thumbnail img"))
            .next()
            .and_then(|img| img.value().attr("data-srcset").or_else(|| img.value().attr("src")))
            .map(str::to_string);
        let rating = el.select(&s(".rating-wrapper span")).next().map(|r| r.text().collect::<String>().trim().to_string());
        let slug = normalize_slug(&link);
        if !title.is_empty() {
            results.push(json!({
                "title": title,
                "slug": if slug.is_empty() { Value::Null } else { json!(slug) },
                "url": if link.is_empty() { Value::Null } else { json!(link) },
                "thumbnail": image,
                "rating": rating,
                "source": "mcpedl.org",
            }));
        }
    }
    results
}

async fn get_org_detail(c: &reqwest::Client, target_url: &str) -> Result<Value, String> {
    let clean_url = if target_url.starts_with("http") {
        target_url.to_string()
    } else {
        format!("https://mcpedl.org/{}/", target_url.trim_matches('/'))
    };
    let html = c.get(&clean_url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let (title, description, image, rating, download_forms) = {
    let doc = scraper::Html::parse_document(&html);
    let s = |s: &str| scraper::Selector::parse(s).unwrap();

    let title = doc
        .select(&s("h1.entry-title"))
        .next()
        .map(|t| t.text().collect::<String>().trim().to_string())
        .or_else(|| doc.select(&s("title")).next().map(|t| t.text().collect::<String>().trim().to_string()))
        .unwrap_or_default();
    let description = doc.select(&s(".entry-content p")).next().map(|p| p.text().collect::<String>().trim().to_string()).unwrap_or_default();
    let image = doc
        .select(&s(".post-thumbnail img"))
        .next()
        .and_then(|img| img.value().attr("src"))
        .map(str::to_string)
        .or_else(|| doc.select(&s("meta[property=\"og:image\"]")).next().and_then(|m| m.value().attr("content")).map(str::to_string));
    let rating = doc
        .select(&s(".vote_block"))
        .next()
        .and_then(|v| v.value().attr("data-rating"))
        .map(str::to_string)
        .or_else(|| doc.select(&s(".rating-wrapper span")).next().map(|r| r.text().collect::<String>().trim().to_string()));

    let mut download_forms = Vec::new();
    for form in doc.select(&s("form[action*=\"show_file.php\"]")) {
        let post_title = form.select(&s("input[name=\"post_title\"]")).next().and_then(|i| i.value().attr("value")).unwrap_or("").to_string();
        let file_id = form.select(&s("input[name=\"file_id\"]")).next().and_then(|i| i.value().attr("value")).unwrap_or("").to_string();
        let post_url = form.select(&s("input[name=\"post_url\"]")).next().and_then(|i| i.value().attr("value")).unwrap_or(&clean_url).to_string();
        if !file_id.is_empty() {
            download_forms.push(json!({"post_title": post_title, "file_id": file_id, "post_url": post_url}));
        }
    }
    (title, description, image, rating, download_forms)
    };

    let mut downloads = Vec::new();
    for form in download_forms {
        let post_title = form.get("post_title").and_then(Value::as_str).unwrap_or("").to_string();
        let post_url = form.get("post_url").and_then(Value::as_str).unwrap_or("").to_string();
        let body = format!(
            "post_title={}&file_id={}&post_url={}",
            urlencoding::encode(&post_title),
            urlencoding::encode(form.get("file_id").and_then(Value::as_str).unwrap_or("")),
            urlencoding::encode(&post_url)
        );
        if let Ok(res) = c
            .post("https://mcpedl.org/show_file.php")
                        .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Referer", &clean_url)
            .body(body)
            .send()
            .await
        {
            if let Ok(html) = res.text().await {
                let fdoc = scraper::Html::parse_document(&html);
                if let Some(btn) = scraper::Selector::parse("button[onclick*=\"window.location.href\"]")
                    .ok()
                    .and_then(|s| fdoc.select(&s).next())
                {
                    let onclick = btn.value().attr("onclick").unwrap_or("");
                    if let Some(cm) = regex::Regex::new(r"window\.location\.href='([^']+)'").unwrap().captures(onclick) {
                        let btn_text = btn.text().collect::<String>().trim().to_string();
                        downloads.push(json!({
                            "name": if btn_text.is_empty() { if post_title.is_empty() { "Download File".to_string() } else { post_title } } else { btn_text },
                            "url": cm[1].to_string(),
                        }));
                    }
                }
            }
        }
    }

    Ok(json!({
        "title": title,
        "slug": normalize_slug(&clean_url),
        "url": clean_url,
        "thumbnail": image,
        "description": if description.is_empty() { Value::Null } else { json!(description) },
        "rating": rating,
        "source": "mcpedl.org",
        "downloads": downloads,
    }))
}

async fn search_com(c: &reqwest::Client, query: &str, page: i64, per_page: i64) -> Vec<Value> {
    let url = format!(
        "{}/search/advanced?q={}&page={}&per_page={}",
        MCPEDL_COM_API,
        urlencoding::encode(query),
        page,
        per_page
    );
    let Ok(res) = c.get(&url).send().await else { return vec![] };
    let Ok(data) = res.json::<Value>().await else { return vec![] };
    data.get("results")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|item| {
                    let tags: Vec<Value> = item
                        .get("cf_tags")
                        .and_then(Value::as_array)
                        .map(|ts| ts.iter().filter_map(|t| t.get("name").cloned()).collect())
                        .unwrap_or_default();
                    json!({
                        "title": item.get("title").cloned().unwrap_or(Value::Null),
                        "slug": item.get("slug").cloned().unwrap_or(Value::Null),
                        "url": format!("https://mcpedl.com/{}", item.get("slug").and_then(Value::as_str).unwrap_or("")),
                        "thumbnail": item.get("image").cloned().unwrap_or(Value::Null),
                        "rating": item.get("average_rating").and_then(Value::as_str).and_then(|s| s.parse::<f64>().ok()).map(|f| json!(format!("{:.1}", f))),
                        "downloads": item.get("downloadCount").cloned().unwrap_or(json!(0)),
                        "summary": item.get("summary").cloned().unwrap_or(Value::Null),
                        "author": item.get("display_name").cloned().or_else(|| item.get("user_nicename").cloned()).unwrap_or(Value::Null),
                        "tags": tags,
                        "source": "mcpedl.com",
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn get_com_detail(c: &reqwest::Client, raw_slug: &str) -> Result<Value, String> {
    let clean_slug = normalize_slug(raw_slug);
    if clean_slug.is_empty() {
        return Err("Slug mcpedl.com tidak valid.".into());
    }
    let url = format!("{}/route/slug/{}", MCPEDL_COM_API, urlencoding::encode(&clean_slug));
    let res = c.get(&url).send().await.map_err(|e| e.to_string())?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let raw = data
        .get("data")
        .cloned()
        .ok_or_else(|| format!("Data tidak ditemukan untuk slug: \"{}\"", clean_slug))?;

    let rating_obj = json!({
        "average": raw.get("average_rating").and_then(Value::as_str).and_then(|s| s.parse::<f64>().ok()).or_else(|| raw.get("average_rating").and_then(Value::as_f64)).unwrap_or(0.0),
        "downloads": raw.get("download_count").cloned().unwrap_or(json!(0)),
    });
    let author = if let Some(user) = raw.get("user") {
        json!({
            "name": user.get("display_name").cloned().or_else(|| user.get("username").cloned()).unwrap_or(Value::Null),
            "username": user.get("user_nicename").cloned().or_else(|| user.get("username").cloned()).unwrap_or(Value::Null),
            "avatar": user.get("avatar").cloned().unwrap_or(Value::Null),
        })
    } else if let Some(un) = raw.get("username").cloned() {
        json!({"name": un})
    } else {
        Value::Null
    };
    let categories: Vec<Value> = raw
        .get("categories")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().map(|cc| json!({"id": cc.get("id"), "name": cc.get("name"), "slug": cc.get("slug")})).collect())
        .unwrap_or_default();
    let cf_tags = raw.get("cf_tags").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    let tags: Vec<Value> = if cf_tags > 0 {
        raw.get("cf_tags").and_then(Value::as_array).map(|arr| arr.iter().map(|t| json!({"id": t.get("id"), "name": t.get("name"), "slug": t.get("slug"), "icon": t.get("iconUrl")})).collect()).unwrap_or_default()
    } else {
        raw.get("tags").and_then(Value::as_array).map(|arr| arr.iter().map(|t| json!({"id": t.get("id"), "name": t.get("name"), "slug": t.get("slug")})).collect()).unwrap_or_default()
    };
    let downloads: Vec<Value> = raw
        .get("downloads")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|dl| json!({"id": dl.get("id"), "name": dl.get("name").or_else(|| dl.get("display_name")), "url": dl.get("file"), "date": dl.get("fileDate"), "type": dl.get("type")}))
                .collect()
        })
        .unwrap_or_default();
    let downloads_vip: Vec<Value> = raw
        .get("downloads_vip")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|dl| json!({"id": dl.get("id"), "name": dl.get("name").or_else(|| dl.get("display_name")), "url": dl.get("file"), "date": dl.get("fileDate")}))
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "id": raw.get("id").cloned().unwrap_or(Value::Null),
        "title": raw.get("title").cloned().unwrap_or(Value::Null),
        "slug": clean_slug,
        "url": format!("https://mcpedl.com/{}", clean_slug),
        "source": "mcpedl.com",
        "status": raw.get("status").cloned().unwrap_or(json!("PUBLISHED")),
        "type_id": raw.get("type_id").cloned().unwrap_or(Value::Null),
        "rating": rating_obj,
        "dates": {
            "created": raw.get("created_at").cloned().or_else(|| raw.get("publish_date").cloned()).unwrap_or(Value::Null),
            "updated": raw.get("updated_at").cloned().or_else(|| raw.get("update_date").cloned()).unwrap_or(Value::Null),
        },
        "author": author,
        "categories": categories,
        "tags": tags,
        "media": {
            "cover": raw.get("image").cloned().unwrap_or(Value::Null),
            "screenshots": raw.get("submission_images").cloned().unwrap_or(json!([])),
        },
        "short_description": raw.get("short_description").cloned().unwrap_or(Value::Null),
        "description": raw.get("description").cloned().unwrap_or(Value::Null),
        "changelog": raw.get("changelog").cloned().unwrap_or(Value::Null),
        "downloads": downloads,
        "downloads_vip": downloads_vip,
        "links": {
            "curseforge": raw.get("cf_link").cloned().unwrap_or(Value::Null),
            "website": raw.get("website_link").cloned().unwrap_or(Value::Null),
        },
    }))
}

async fn get_com_home(c: &reqwest::Client) -> Value {
    let (fp_v2, fp_v1, carousel_fp) = tokio::join!(
        c.get(&format!("{}/search/frontpage/v2", MCPEDL_COM_API)).send(),
        c.get(&format!("{}/search/frontpage", MCPEDL_COM_API)).send(),
        c.get(&format!("{}/carousels/fp", MCPEDL_COM_API)).send(),
    );
    let get_json = |r: Result<reqwest::Response, _>| async {
        match r {
            Ok(res) => res.json::<Value>().await.unwrap_or(Value::Null),
            Err(_) => Value::Null,
        }
    };
    let v2 = get_json(fp_v2).await;
    let v1 = get_json(fp_v1).await;
    let banner = get_json(carousel_fp).await;

    json!({
        "source": "mcpedl.com",
        "featured_banners": banner.pointer("/data").cloned().unwrap_or(json!([])),
        "shelves": v2.get("shelves").cloned().unwrap_or(json!({})),
        "category_highlights": v1,
    })
}

async fn get_com_tags(c: &reqwest::Client) -> Result<Value, String> {
    let data: Value = c
        .get(&format!("{}/search/tags", MCPEDL_COM_API))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let roots = data.get("roots").cloned().unwrap_or(json!([]));
    let total = roots.as_array().map(|a| a.len()).unwrap_or(0);
    Ok(json!({"source": "mcpedl.com", "total_root_categories": total, "categories": roots}))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let query_str = get_param("query").unwrap_or_default();
    let url_param = get_param("url").unwrap_or_default();
    let slug_param = get_param("slug").unwrap_or_default();
    let selected_source = get_param("source").unwrap_or_else(|| "all".to_string()).to_lowercase();
    let selected_action = get_param("action").unwrap_or_default().to_lowercase();
    let max_result = get_param("max").and_then(|m| m.parse::<usize>().ok()).unwrap_or(10).min(30);
    let page_num: i64 = get_param("page").and_then(|p| p.parse().ok()).unwrap_or(1).max(1);

    let (c_org, c_com) = match clients() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    // 1. Home
    if selected_action == "home" || selected_action == "frontpage" {
        let home = get_com_home(&c_com).await;
        return Json(json!({"status": true, "action": "home", "result": home, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response();
    }

    // 2. Tags
    if selected_action == "tags" || selected_action == "categories" {
        return match get_com_tags(&c_com).await {
            Ok(tags) => Json(json!({"status": true, "action": "tags", "result": tags, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
            Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        };
    }

    // 3. Detail
    let is_url_query = query_str.starts_with("http://") || query_str.starts_with("https://");
    let target_detail = if !url_param.is_empty() {
        Some(url_param.clone())
    } else if !slug_param.is_empty() {
        Some(slug_param.clone())
    } else if selected_action == "detail" && !query_str.is_empty() {
        Some(query_str.clone())
    } else if is_url_query {
        Some(query_str.clone())
    } else {
        None
    };

    if let Some(target) = target_detail {
        let clean_target = target.trim().to_string();
        let result = if clean_target.contains("mcpedl.org") {
            get_org_detail(&c_org, &clean_target).await
        } else {
            match get_com_detail(&c_com, &clean_target).await {
                Ok(v) => Ok(v),
                Err(com_err) => {
                    if !clean_target.contains("mcpedl.com") {
                        get_org_detail(&c_org, &clean_target).await.map_err(|_| com_err)
                    } else {
                        Err(com_err)
                    }
                }
            }
        };
        return match result {
            Ok(r) => Json(json!({"status": true, "action": "detail", "result": r, "timestamp": chrono::Utc::now().timestamp_millis()})).into_response(),
            Err(e) => {
                let status = if e.contains("tidak ditemukan") || e.contains("not found") || e.contains("404") {
                    StatusCode::NOT_FOUND
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                };
                err(status, &e)
            }
        };
    }

    // 4. Search (default)
    let q = query_str.trim().to_string();
    if q.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Parameter 'query' wajib diisi untuk pencarian, atau gunakan parameter 'url'/'slug' untuk melihat detail & download.");
    }

    let max_usize = max_result;
    let (items, com_count, org_count) = if selected_source == "com" {
        let com_items = search_com(&c_com, &q, page_num, max_result as i64).await;
        let count = com_items.len();
        (com_items.into_iter().take(max_usize).collect(), count, 0)
    } else if selected_source == "org" {
        let org_items = search_org(&c_org, &q, max_usize).await;
        let count = org_items.len();
        (org_items.into_iter().take(max_usize).collect(), 0, count)
    } else {
        let (com_items, org_items) = tokio::join!(search_com(&c_com, &q, page_num, max_result as i64), search_org(&c_org, &q, max_usize));
        let com_count = com_items.len();
        let org_count = org_items.len();
        let mut items = Vec::new();
        let max_len = com_count.max(org_count);
        for i in 0..max_len {
            if i < com_count && items.len() < max_result * 2 {
                items.push(com_items[i].clone());
            }
            if i < org_count && items.len() < max_result * 2 {
                items.push(org_items[i].clone());
            }
        }
        (items, com_count, org_count)
    };

    if items.is_empty() {
        return err(StatusCode::NOT_FOUND, &format!("Mod/konten \"{}\" tidak ditemukan di MCPEDL ({}).", q, selected_source));
    }

    let mapped: Vec<Value> = items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            json!({
                "index": i + 1,
                "title": item.get("title").cloned().unwrap_or(Value::Null),
                "slug": item.get("slug").cloned().unwrap_or(Value::Null),
                "url": item.get("url").cloned().unwrap_or(Value::Null),
                "thumbnail": item.get("thumbnail").cloned().unwrap_or(Value::Null),
                "rating": item.get("rating").cloned().unwrap_or(Value::Null),
                "downloads": item.get("downloads").cloned().unwrap_or(Value::Null),
                "summary": item.get("summary").cloned().unwrap_or(Value::Null),
                "author": item.get("author").cloned().unwrap_or(Value::Null),
                "tags": item.get("tags").cloned().unwrap_or(json!([])),
                "source": item.get("source").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();

    Json(json!({
        "status": true,
        "action": "search",
        "result": {
            "total": mapped.len(),
            "sources": {"selected": selected_source, "com": com_count, "org": org_count},
            "items": mapped,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()
}

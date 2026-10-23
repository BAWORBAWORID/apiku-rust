// NASA Search — native conversion of api/search/nasa.js
// Scraping nasa.gov: type=news | missions | images, opsional detail (maks 5).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const NEWS_API: &str = "https://www.nasa.gov/wp-json/nasa-hds/v1/content-lists";
const MISSIONS_URL: &str = "https://www.nasa.gov/a-to-z-of-nasa-missions/";
const IOTD_URL: &str = "https://www.nasa.gov/image-of-the-day/";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

fn clean(s: &str) -> String {
    s.replace("&#0?38;", "&")
        .replace("&#38;", "&")
        .replace("&nbsp;", " ")
        .replace("&hellip;", "\u{2026}")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#8217;", "'")
        .replace("&#8220;", "\"")
        .replace("&#8221;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn filter_list(list: Vec<Value>, query: Option<&str>) -> Vec<Value> {
    match query {
        None | Some("") => list,
        Some(q) => {
            let ql = q.to_lowercase();
            list.into_iter()
                .filter(|i| i.to_string().to_lowercase().contains(&ql))
                .collect()
        }
    }
}

fn cap_at(max: i64, t: &str) -> i64 {
    let limits = match t {
        "news" => 154,
        "missions" => 666,
        _ => 40,
    };
    max.min(limits)
}

async fn fetch_news_page(client: &reqwest::Client, page: i64) -> Result<Vec<Value>, String> {
    let qs = format!(
        "postType=press-release&postId=940636&perPage=25&newsTags=16635&layout=list&showThumbnails=yes&showReadTime=yes&showExcerpts=yes&showContentTypeTags=yes&pageClicked={}",
        page
    );
    let json: Value = client
        .get(format!("{}?{}", NEWS_API, qs))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let html = json.get("html").and_then(Value::as_str).unwrap_or("");

    let re = regex::Regex::new(r#"<div class="hds-content-item">([\s\S]*?)(?=<div class="hds-content-item"|$)"#).unwrap();
    let re_ha = regex::Regex::new(
        r#"<a href="([^"]+)" class="hds-content-item-heading">[\s\S]*?<div class="hds-a11y-heading-22">([\s\S]*?)</div>"#,
    )
    .unwrap();
    let re_thumb = regex::Regex::new(r#"<a href="[^"]+" class="hds-content-item-thumbnail">[\s\S]*?<img[^>]*src="([^"]+)""#).unwrap();
    let re_rt = regex::Regex::new(r#"<div class="hds-content-item-readtime[^"]*"[^>]*>([^<]*)<"#).unwrap();
    let re_ex = regex::Regex::new(r#"<p class="margin-top-0 margin-bottom-1">([\s\S]*?)</p>"#).unwrap();

    let mut items = Vec::new();
    for m in re.captures_iter(html) {
        let block = &m[1];
        let Some(ha) = re_ha.captures(block) else { continue };
        let url = ha[1].to_string();
        let title = clean(&ha[2]);
        if !url.starts_with("http") || title.len() < 10 {
            continue;
        }
        let thumb = re_thumb.captures(block).and_then(|c| c.get(1)).map(|g| g.as_str()).unwrap_or("");
        let rt = re_rt.captures(block).and_then(|c| c.get(1)).map(|g| clean(g.as_str())).unwrap_or_default();
        let ex = re_ex.captures(block).and_then(|c| c.get(1)).map(|g| clean(g.as_str())).unwrap_or_default();
        items.push(json!({
            "title": title,
            "url": url,
            "description": ex,
            "readTime": rt,
            "contentType": "News Release",
            "imageUrl": thumb,
        }));
    }
    Ok(items)
}

fn main_of(html: &str) -> String {
    regex::Regex::new(r"(?is)<main[\s\S]*</main>")
        .ok()
        .and_then(|re| re.find(html).map(|m| m.as_str().to_string()))
        .unwrap_or_else(|| html.to_string())
}

fn parse_news_detail(html: &str) -> Value {
    let main = main_of(html);
    let title = regex::Regex::new(r"(?s)<h1[^>]*>([\s\S]*?)</h1>")
        .ok()
        .and_then(|re| re.captures(&main))
        .map(|c| clean(&c[1]))
        .unwrap_or_default();

    let re_p = regex::Regex::new(r"(?s)<p\b[^>]*>([\s\S]*?)</p>").unwrap();
    let skip_re = regex::Regex::new(r"(?i)^(Media|News|Contact|Privacy|FOIA|Budget|Follow|Sitemap)").unwrap();
    let skip2_re = regex::Regex::new(r"(National Aeronautics and Space Administration|NASA explores the unknown|Was this page helpful)").unwrap();
    let mut paragraphs: Vec<String> = Vec::new();
    for m in re_p.captures_iter(&main) {
        let t = clean(&m[1]);
        if t.len() < 40 || skip_re.is_match(&t) || skip2_re.is_match(&t) {
            continue;
        }
        paragraphs.push(t);
    }

    let date_re = regex::Regex::new(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}").unwrap();
    let meta_re = regex::Regex::new(r#"(?s)class="article-meta-item[\s\S]*?</div>"#).unwrap();
    let sp_re = regex::Regex::new(r#"(?s)<span class="heading-12 text-uppercase">([\s\S]*?)</span>"#).unwrap();
    let id_re = regex::Regex::new(r"\b([A-Z]{0,4}\d{2}-\d{3,4})\b").unwrap();
    let loc_re = regex::Regex::new(r#"(?s)<a class="hds-location-tag-name[^"]*"[^>]*>([\s\S]*?)</a>"#).unwrap();

    let mut publish_date = String::new();
    let mut raw_date = String::new();
    let mut release_type = String::new();
    let mut release_id = String::new();
    let mut location = String::new();

    for blk in meta_re.find_iter(&main) {
        let blk = blk.as_str();
        if let Some(dm) = date_re.captures(blk) {
            raw_date = dm[0].to_string();
            if let Ok(d) = chrono::NaiveDate::parse_from_str(&format!("{} 00:00", raw_date), "%b %d, %Y %H:%M") {
                publish_date = d.and_hms_opt(0, 0, 0).unwrap().and_utc().to_rfc3339();
            }
        }
        if let Some(sp) = sp_re.captures(blk) {
            if !sp[1].split(|c: char| c.is_ascii_digit()).any(|s| s.len() == 4) && sp[1].chars().any(|c| c.is_ascii_digit()) || regex::Regex::new(r"\d{4}").unwrap().is_match(&sp[1]) {
                // tetap proses
            }
            if !regex::Regex::new(r"\d{4}").unwrap().is_match(sp.get(1).map(|g| g.as_str()).unwrap_or("")) {
                let s = clean(sp.get(1).map(|g| g.as_str()).unwrap_or(""));
                let rm = id_re.captures(&s);
                if let Some(rm) = &rm {
                    release_id = rm[1].to_string();
                }
                let typ = match rm {
                    Some(r) => s.replace(&r[1], "").trim().to_string(),
                    None => s.clone(),
                };
                if !typ.is_empty() && typ.chars().all(|c| c.is_ascii_uppercase() || c == ' ') {
                    release_type = typ;
                }
            }
        }
        if (blk.contains("article-location-tags") || blk.contains("hds-location-tag")) && location.is_empty() {
            location = loc_re
                .captures(blk)
                .map(|c| clean(c.get(1).map(|g| g.as_str()).unwrap_or(blk)))
                .unwrap_or_else(|| clean(blk));
        }
    }

    let mut author = String::new();
    if let Some(am) = regex::Regex::new(r#"<p class="font-weight-bold">([^<]+)</p>"#).unwrap().captures(&main) {
        author = clean(&am[1]);
    }
    if release_id.is_empty() {
        if let Some(rm2) = id_re.captures(&main) {
            release_id = rm2[1].to_string();
        }
    }
    if release_type.is_empty() {
        if let Some(tm2) = regex::Regex::new(r#"<span class="heading-12 text-uppercase">([A-Z\s]{3,})</span>"#).unwrap().captures(&main) {
            release_type = clean(&tm2[1]);
        }
    }
    if location.is_empty() {
        if let Some(lm2) = loc_re.captures(&main) {
            location = clean(&lm2[1]);
        }
    }

    json!({
        "title": title,
        "fullContent": paragraphs.join("\n\n"),
        "publishDate": publish_date,
        "publishedDateRaw": raw_date,
        "releaseType": release_type,
        "releaseId": release_id,
        "author": author,
        "location": location,
    })
}

async fn add_news_detail(client: &reqwest::Client, mut item: Value) -> Value {
    let url = item.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    let ok = if let Ok(html) = client.get(&url).send().await {
        if let Ok(html) = html.text().await {
            let d = parse_news_detail(&html);
            if let Some(o) = item.as_object_mut() {
                o.insert("fullContent".into(), d.get("fullContent").cloned().unwrap_or(json!("")));
                for k in ["publishDate", "publishedDateRaw", "releaseType", "releaseId", "author", "location", "title"] {
                    let v = d.get(k).cloned().unwrap_or(Value::Null);
                    if !v.is_null() && v.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
                        o.insert(k.into(), v);
                    }
                }
            }
            true
        } else {
            false
        }
    } else {
        false
    };
    if !ok {
        if let Some(o) = item.as_object_mut() {
            o.insert("fullContent".into(), json!(""));
        }
    }
    item
}

fn parse_mission_list(html: &str) -> Vec<Value> {
    let mut missions = Vec::new();
    let mut current_letter = "#".to_string();
    let re = regex::Regex::new(r#"(?s)<h2\b[^>]*class="wp-block-heading"[^>]*id="([A-Z0-9])"[^>]*>|<p\b[^>]*class="wp-block-paragraph"[^>]*>([\s\S]*?)</p>"#).unwrap();
    let link_re = regex::Regex::new(r#"(?s)<a href="([^"]+)"[^>]*>([\s\S]*?)</a>"#).unwrap();
    for m in re.captures_iter(html) {
        if let Some(l) = m.get(1) {
            current_letter = l.as_str().to_string();
            continue;
        }
        let inner = m.get(2).map(|g| g.as_str()).unwrap_or("");
        let Some(lm) = link_re.captures(inner) else { continue };
        let name = clean(&lm[2]);
        if name.is_empty() {
            continue;
        }
        let desc = clean(&inner.replace(lm.get(0).map(|g| g.as_str()).unwrap_or(""), ""));
        missions.push(json!({"name": name, "url": lm[1], "letter": current_letter, "description": desc}));
    }
    missions
}

fn parse_mission_detail(html: &str, url: &str) -> (String, Value, Vec<String>, Vec<String>) {
    // (name, facts, keyDates, overview)
    let main = main_of(html);
    let name = regex::Regex::new(r"(?s)<h1[^>]*>([\s\S]*?)</h1>")
        .ok()
        .and_then(|re| re.captures(&main))
        .map(|c| clean(&c[1]))
        .unwrap_or_default();

    let mut facts = serde_json::Map::new();
    let re_f = regex::Regex::new(
        r#"(?s)<div class="grid-col-6">[\s\S]*?<p class="label[^"]*"[^>]*>([\s\S]*?)</p>[\s\S]*?</div>[\s\S]*?<div[^>]*>([\s\S]*?)</div>"#,
    )
    .unwrap();
    for fm in re_f.captures_iter(&main) {
        let label = clean(&fm[1]);
        let value = clean(&fm[2]);
        if !label.is_empty() && !value.is_empty() {
            facts.insert(label, json!(value));
        }
    }

    let re_p = regex::Regex::new(r#"(?s)<p\b[^>]*class="wp-block-paragraph"[^>]*>([\s\S]*?)</p>"#).unwrap();
    let date_re = regex::Regex::new(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*\d{1,2},?\s*\d{4}$").unwrap();
    let mut key_dates = Vec::new();
    let mut paragraphs = Vec::new();
    let skip_re = regex::Regex::new(r"(National Aeronautics and Space Administration|NASA explores the unknown|Follow NASA|Privacy Policy|Was this page helpful)").unwrap();
    let skip2_re = regex::Regex::new(r"^(Related Terms|Multimedia|Highlights)").unwrap();
    for pm in re_p.captures_iter(&main) {
        let inner = pm.get(1).map(|g| g.as_str()).unwrap_or("");
        if let Some(bm) = regex::Regex::new(r"<b>([^<]+)</b>").unwrap().captures(inner) {
            let date = clean(&bm[1]).trim_end_matches([':', '.', ' ']).to_string();
            if date_re.is_match(&date) {
                let event = clean(inner.split("</b>").nth(1).unwrap_or(""));
                if !event.is_empty() {
                    key_dates.push(format!("{}: {}", date, event));
                }
            }
        }
        let t = clean(inner);
        if t.len() < 40 || skip_re.is_match(&t) || skip2_re.is_match(&t) {
            continue;
        }
        paragraphs.push(t);
    }

    (name, Value::Object(facts), key_dates, paragraphs.into_iter().take(12).collect())
}

async fn add_mission_detail(client: &reqwest::Client, mut misi: Value) -> Value {
    let mut url = misi.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    if url.starts_with('/') {
        url = format!("https://www.nasa.gov{}", url);
    }
    if !url.starts_with("http") {
        if let Some(o) = misi.as_object_mut() {
            o.insert("detail".into(), json!({"error": "URL tidak valid"}));
        }
        return misi;
    }
    let detail = match client.get(&url).send().await {
        Ok(r) => match r.text().await {
            Ok(html) => {
                let (name, facts, key_dates, overview) = parse_mission_detail(&html, &url);
                if !name.is_empty() {
                    if let Some(o) = misi.as_object_mut() {
                        o.insert("name".into(), json!(name));
                    }
                }
                json!({"facts": facts, "keyDates": key_dates, "overview": overview})
            }
            Err(e) => json!({"error": e.to_string()}),
        },
        Err(e) => json!({"error": &e.to_string()[..e.to_string().len().min(60)]}),
    };
    if let Some(o) = misi.as_object_mut() {
        o.insert("detail".into(), detail);
    }
    misi
}

fn parse_images(html: &str) -> Vec<Value> {
    let re = regex::Regex::new(r#"(?s)<div class="hds-gallery-item-single[^"]*">([\s\S]*?)(?=<div class="hds-gallery-item-single|$)"#).unwrap();
    let link_re = regex::Regex::new(r#"<a class="hds-gallery-item-link[^"]*" href="([^"]+)""#).unwrap();
    let img_re = regex::Regex::new(r#"<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)""#).unwrap();
    let cap_re = regex::Regex::new(r#"(?s)<div class="hds-gallery-item-caption[^"]*"[^>]*>([\s\S]*?)</div>"#).unwrap();

    re.captures_iter(html)
        .map(|m| {
            let block = m.get(1).map(|g| g.as_str()).unwrap_or("");
            let href = link_re.captures(block).and_then(|c| c.get(1)).map(|g| g.as_str().to_string()).unwrap_or_default();
            let img = img_re.captures(block);
            let cap = cap_re.captures(block).and_then(|c| c.get(1)).map(|g| g.as_str().to_string()).unwrap_or_default();
            let alt = img.as_ref().map(|c| clean(&c[2])).unwrap_or_default();
            let slug = href.split('/').filter(|s| !s.is_empty()).next_back().unwrap_or("").to_string();
            let title = if !slug.is_empty() {
                slug.split('-').map(|w| { let mut cs = w.chars(); match cs.next() { Some(f) => f.to_uppercase().collect::<String>() + cs.as_str(), None => String::new() } }).collect::<Vec<_>>().join(" ")
            } else {
                cap.clone()
            };
            json!({
                "title": title,
                "url": href,
                "imageUrl": img.as_ref().map(|c| c[1].to_string()).unwrap_or_default(),
                "alt": alt,
                "caption": clean(&cap),
            })
        })
        .collect()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<Value> {
        if let Some(v) = query.get(k) {
            return Some(json!(v));
        }
        body.as_ref().and_then(|Json(v)| v.get(k).cloned())
    };

    let t = get_param("type").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default().to_lowercase();
    if !["news", "missions", "images"].contains(&t.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Parameter 'type' wajib salah satu: news | missions | images");
    }

    let lim_raw = get_param("limit").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
    let mut lim = match lim_raw {
        Some(l) if l >= 1 => l,
        _ => 5,
    };
    lim = cap_at(lim, &t);

    let want_detail = get_param("detail")
        .map(|v| v.as_bool().unwrap_or_else(|| v.as_str().map(|s| s.eq_ignore_ascii_case("true")).unwrap_or(false)))
        .unwrap_or(false);
    let detail_n = if want_detail { lim.min(5) } else { 0 };

    let client = match client() {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let query_f = get_param("query").and_then(|v| v.as_str().map(str::to_string));

    let result: Result<Value, String> = async {
        if t == "news" {
            let mut list: Vec<Value> = Vec::new();
            for page in 1..=7i64 {
                if let Ok(items) = fetch_news_page(&client, page).await {
                    let seen: std::collections::HashSet<String> =
                        list.iter().filter_map(|i| i.get("url").and_then(Value::as_str).map(str::to_string)).collect();
                    for it in items {
                        let url = it.get("url").and_then(Value::as_str).unwrap_or("").to_string();
                        if !seen.contains(&url) {
                            list.push(it);
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
            let list = filter_list(list, query_f.as_deref());
            let mut list = list;
            if detail_n > 0 {
                let head: Vec<Value> = list.drain(..(detail_n.max(0) as usize).min(list.len())).collect();
                let mut done = Vec::new();
                for it in head {
                    done.push(add_news_detail(&client, it).await);
                }
                done.extend(list);
                list = done;
            }
            let total = list.len();
            Ok(json!({"totalArticles": total, "detailFetched": detail_n, "articles": list.into_iter().take(lim as usize).collect::<Vec<_>>()}))
        } else if t == "missions" {
            let html = client.get(MISSIONS_URL).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
            let list = filter_list(parse_mission_list(&html), query_f.as_deref());
            let mut list = list;
            if detail_n > 0 {
                let head: Vec<Value> = list.drain(..(detail_n.max(0) as usize).min(list.len())).collect();
                let mut done = Vec::new();
                for it in head {
                    done.push(add_mission_detail(&client, it).await);
                }
                done.extend(list);
                list = done;
            }
            let mut by_letter = serde_json::Map::new();
            for m in &list {
                let letter = m.get("letter").and_then(Value::as_str).unwrap_or("#").to_string();
                let name = m.get("name").cloned().unwrap_or(Value::Null);
                let entry = by_letter.entry(letter).or_insert_with(|| json!([]));
                if let Some(arr) = entry.as_array_mut() {
                    arr.push(name);
                }
            }
            let total = list.len();
            Ok(json!({
                "totalMissions": total,
                "detailFetched": detail_n,
                "groupedByLetter": Value::Object(by_letter),
                "missions": list.into_iter().take(lim as usize).collect::<Vec<_>>(),
            }))
        } else {
            let html = client.get(IOTD_URL).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
            let mut list = filter_list(parse_images(&html), query_f.as_deref());
            if let Some(first) = list.first_mut() {
                if let Some(o) = first.as_object_mut() {
                    o.insert("isToday".into(), json!(true));
                }
            }
            let total = list.len();
            Ok(json!({"totalImages": total, "images": list.into_iter().take(lim as usize).collect::<Vec<_>>()}))
        }
    }
    .await;

    match result {
        Ok(r) => {
            let source = match t.as_str() {
                "news" => "https://www.nasa.gov/2026-news-releases/",
                "missions" => MISSIONS_URL,
                _ => IOTD_URL,
            };
            let mut obj = json!({
                "status": true,
                "result": {
                    "type": t,
                    "source": source,
                    "scrapedAt": chrono::Utc::now().to_rfc3339(),
                }
            });
            if let (Some(dst), Some(src)) = (obj.pointer_mut("/result").and_then(Value::as_object_mut), r.as_object()) {
                dst.extend(src.clone());
            }
            Json(obj).into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}

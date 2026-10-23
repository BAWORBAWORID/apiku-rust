// YouTube Downloader (YTScrape) — native conversion of api/downloader/ytscrape.js
// Providers: Invidious (multi-instance, link langsung) + Y2Mate.gs fallback.
use axum::{
    extract::{Query, Json as AxumJson},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IV_FALLBACK: [&str; 10] = [
    "invidious.f5.si", "inv.nadeko.net", "invidious.tiekoetter.com", "yewtu.be",
    "invidious.nerdvpn.de", "invidious.privacyredirect.com", "invidious.materialio.us",
    "invidious.fdn.fr", "iv.ggtyler.dev", "invidious.protokolla.fi",
];
const Y2: &str = "https://y2mate.gs";

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn video_id(input: &str) -> Option<String> {
    let raw = input.trim();
    if raw.len() == 11 && raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Some(raw.to_string());
    }
    let normalized = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let u = url::Url::parse(&normalized).ok()?;
    let host = u.host_str()?.trim_start_matches("www.").to_lowercase();
    let parts: Vec<&str> = u.path().split('/').filter(|s| !s.is_empty()).collect();
    if host == "youtu.be" {
        return parts.first().map(|s| s.to_string());
    }
    for (k, v) in u.query_pairs() {
        if k == "v" && !v.is_empty() {
            return Some(v.to_string());
        }
    }
    if let Some(p0) = parts.first() {
        if ["embed", "live", "shorts", "v"].contains(p0) {
            if let Some(p1) = parts.get(1) {
                return Some(p1.to_string());
            }
        }
    }
    None
}

fn bytes_of(f: &Value) -> Option<f64> {
    for k in ["clen", "size"] {
        if let Some(n) = f.get(k).and_then(|v| v.as_f64()) {
            if n > 1000.0 {
                return Some(n);
            }
        }
        if let Some(s) = f.get(k).and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()) {
            if s > 1000.0 {
                return Some(s);
            }
        }
    }
    None
}

fn wh(f: &Value) -> Option<(f64, f64)> {
    for k in ["resolution", "size"] {
        if let Some(s) = f.get(k).and_then(|v| v.as_str()) {
            let nums: Vec<&str> = s.split('x').collect();
            if nums.len() == 2 {
                if let (Ok(a), Ok(b)) = (nums[0].parse::<f64>(), nums[1].parse::<f64>()) {
                    return Some((a, b));
                }
            }
        }
    }
    None
}

async fn iv_instances(client: &reqwest::Client) -> Vec<String> {
    let mut list: Vec<String> = IV_FALLBACK.iter().map(|s| s.to_string()).collect();
    if let Ok(r) = client
        .get("https://api.invidious.io/instances.json")
        
        .send()
        .await
    {
        if let Ok(j) = r.json::<Value>().await {
            if let Some(arr) = j.as_array() {
                for entry in arr {
                    if let Some(pair) = entry.as_array() {
                        if let Some(host) = pair.first().and_then(|h| h.as_str()) {
                            let meta = pair.get(1);
                            let ok = meta
                                .map(|m| {
                                    m.get("type").and_then(|t| t.as_str()).map(|t| t.contains("http")).unwrap_or(false)
                                        || m.get("api").and_then(|a| a.as_bool()).unwrap_or(false)
                                })
                                .unwrap_or(false);
                            if ok && !list.iter().any(|x| x == host) {
                                list.push(host.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    list
}

async fn iv_fetch(client: &reqwest::Client, host: &str, id: &str) -> Result<Value, String> {
    let r = client
        .get(format!("https://{host}/api/v1/videos/{id}"))
                    .header("Accept", "application/json")
        .header("Referer", format!("https://{host}/"))
        
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = j.get("error").and_then(|e| e.as_str()) {
        return Err(err.to_string());
    }

    let muxed = j.get("formatStreams").and_then(|a| a.as_array()).cloned().unwrap_or_default();
    let adaptive = j.get("adaptiveFormats").and_then(|a| a.as_array()).cloned().unwrap_or_default();

    let muxed_out: Vec<Value> = muxed
        .iter()
        .map(|f| {
            let m = wh(f);
            json!({
                "itag": f.get("itag").and_then(|i| i.as_i64().or_else(|| i.as_str().and_then(|s| s.parse::<i64>().ok()))),
                "kind": "muxed",
                "type": f.get("type").cloned().unwrap_or(Value::Null),
                "quality": f.get("qualityLabel").cloned().or_else(|| f.get("quality").cloned()).unwrap_or(Value::Null),
                "container": f.get("container").cloned().unwrap_or(Value::Null),
                "width": m.map(|x| x.0 as i64),
                "height": m.map(|x| x.1 as i64),
                "bytes": bytes_of(f),
                "url": f.get("url").cloned().unwrap_or(Value::Null)
            })
        })
        .collect();

    let adaptive_out: Vec<Value> = adaptive
        .iter()
        .filter_map(|f| {
            let url = f.get("url").and_then(|u| u.as_str())?;
            let m = wh(f);
            let label = f.get("qualityLabel").and_then(|q| q.as_str()).unwrap_or("");
            let kind = if f.get("type").and_then(|t| t.as_str()).unwrap_or("").starts_with("audio") {
                "audio"
            } else {
                "video"
            };
            let height = m
                .map(|x| x.1 as i64)
                .or_else(|| label.trim_end_matches('p').parse::<i64>().ok().filter(|_| label.ends_with('p')));
            Some(json!({
                "itag": f.get("itag").and_then(|i| i.as_i64().or_else(|| i.as_str().and_then(|s| s.parse::<i64>().ok()))),
                "kind": kind,
                "type": f.get("type").cloned().unwrap_or(Value::Null),
                "quality": if label.is_empty() { f.get("quality").cloned().unwrap_or(Value::Null) } else { json!(label) },
                "container": f.get("container").cloned().unwrap_or(Value::Null),
                "encoding": f.get("encoding").cloned().unwrap_or(Value::Null),
                "width": m.map(|x| x.0 as i64),
                "height": height,
                "fps": f.get("fps").cloned().unwrap_or(Value::Null),
                "bitrate": f.get("bitrate").and_then(|b| b.as_f64()),
                "bytes": bytes_of(f),
                "url": url
            }))
        })
        .collect();

    Ok(json!({
        "title": j.get("title").cloned().unwrap_or(Value::Null),
        "author": j.get("author").cloned().unwrap_or(Value::Null),
        "lengthSeconds": j.get("lengthSeconds").cloned().unwrap_or(Value::Null),
        "hlsUrl": j.get("hlsUrl").cloned().unwrap_or(Value::Null),
        "dashUrl": j.get("dashUrl").cloned().unwrap_or(Value::Null),
        "muxed": muxed_out,
        "adaptive": adaptive_out
    }))
}

async fn via_invidious(client: &reqwest::Client, id: &str) -> Result<Value, String> {
    let hosts = iv_instances(client).await;
    let mut errors: Vec<Value> = Vec::new();
    for host in hosts {
        match iv_fetch(client, &host, id).await {
            Ok(mut info) => {
                info["provider"] = json!("invidious");
                info["videoId"] = json!(id);
                info["instance"] = json!(host);
                info["errors"] = json!(errors);
                return Ok(info);
            }
            Err(e) => errors.push(json!({ "host": host, "why": e })),
        }
    }
    Err("semua instance invidious gagal".into())
}

fn pick_stream(info: &Value, format: &str, itag: Option<&str>) -> Result<Value, String> {
    if let Some(itag) = itag {
        let wanted: i64 = itag.parse().map_err(|_| format!("itag {itag} tidak ada"))?;
        let all: Vec<Value> = info
            .get("muxed")
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .chain(info.get("adaptive").and_then(|a| a.as_array()).cloned().unwrap_or_default())
            .collect();
        return all
            .into_iter()
            .find(|f| f.get("itag").and_then(|i| i.as_i64()) == Some(wanted))
            .ok_or_else(|| format!("itag {itag} tidak ada"));
    }
    if format == "mp3" {
        let audio: Vec<Value> = info
            .get("adaptive")
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|f| f.get("kind").and_then(|k| k.as_str()) == Some("audio"))
            .collect();
        let best = audio
            .iter()
            .find(|f| f.get("itag").and_then(|i| i.as_i64()) == Some(251))
            .or_else(|| audio.iter().find(|f| f.get("itag").and_then(|i| i.as_i64()) == Some(140)))
            .or_else(|| audio.first())
            .ok_or_else(|| "tidak ada stream audio".to_string())?;
        let mut v = best.clone();
        v["note"] = json!("bukan hasil konversi mp3 — m4a/opus mentah");
        return Ok(v);
    }
    let mut muxed: Vec<Value> = info
        .get("muxed")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    muxed.sort_by(|a, b| {
        (b.get("height").and_then(|h| h.as_i64()).unwrap_or(0)).cmp(&(a.get("height").and_then(|h| h.as_i64()).unwrap_or(0)))
    });
    if let Some(first) = muxed.first() {
        return Ok(first.clone());
    }
    let mut video: Vec<Value> = info
        .get("adaptive")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|f| {
            f.get("kind").and_then(|k| k.as_str()) == Some("video")
                && f.get("container").and_then(|c| c.as_str()) == Some("mp4")
        })
        .collect();
    video.sort_by(|a, b| {
        (b.get("height").and_then(|h| h.as_i64()).unwrap_or(0)).cmp(&(a.get("height").and_then(|h| h.as_i64()).unwrap_or(0)))
    });
    let first = video.first().ok_or_else(|| "tidak ada stream video".to_string())?;
    let mut v = first.clone();
    v["note"] = json!("video-only (DASH)");
    Ok(v)
}

async fn probe(client: &reqwest::Client, url: &str) -> Value {
    match client.head(url).send().await {
        Ok(r) => {
            let status = r.status().as_u16();
            json!({ "ok": (200..400).contains(&status), "status": status })
        }
        Err(_) => json!({ "ok": false, "status": 0 }),
    }
}

async fn y2discover(client: &reqwest::Client) -> Result<(String, String), String> {
    let html = client
        .get(Y2)
                    .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // apiKey = '...'
    let api_key = html
        .split("apiKey")
        .nth(1)
        .and_then(|s| s.split('=').nth(1))
        .and_then(|s| {
            let t = s.trim();
            t.strip_prefix('\'').or_else(|| t.strip_prefix('"'))
        })
        .map(|s| {
            s.chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect::<String>()
        })
        .filter(|s| s.len() >= 16)
        .ok_or_else(|| "struktur y2mate berubah".to_string())?;

    let mut script_src: Option<String> = None;
    let mut rest: &str = &html;
    while let Some(i) = rest.find("<script") {
        let after = &rest[i..];
        let end = after.find("</script>").unwrap_or(after.len().min(500));
        let tag = &after[..end];
        if tag.contains("y2mate") && tag.contains(".js") {
            let src = tag
                .split("src=\"")
                .nth(1)
                .map(|s| s.split('"').next().unwrap_or("").to_string())
                .or_else(|| tag.split("src='").nth(1).map(|s| s.split('\'').next().unwrap_or("").to_string()));
            if let Some(s) = src {
                script_src = Some(s);
                break;
            }
        }
        rest = &after[end..];
    }
    let script_src = script_src.ok_or_else(|| "struktur y2mate berubah".to_string())?;
    let script_url = if script_src.starts_with("http") {
        script_src
    } else if script_src.starts_with('/') {
        format!("{Y2}{script_src}")
    } else {
        format!("{Y2}/{script_src}")
    };

    let script = client
        .get(script_url)
                    .header("Accept", "text/javascript")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let enc_host = script
        .split("atob(")
        .nth(1)
        .and_then(|s| s.split('\'').nth(1).or_else(|| s.split('"').nth(1)))
        .map(|s| s.to_string());
    let host = match enc_host {
        Some(e) => {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(e.as_bytes())
                .ok()
                .and_then(|b| String::from_utf8(b).ok())
                .unwrap_or_else(|| "etacloud.org".into())
        }
        None => "etacloud.org".into(),
    };

    Ok((api_key, format!("https://eta.{host}")))
}

async fn y2json(client: &reqwest::Client, url: &str, label: &str, bearer: Option<&str>) -> Result<Value, String> {
    let mut req = client
        .get(url)
                    .header("Accept", "application/json, text/plain, */*")
                    .header("Cache-Control", "no-cache")
                    .header("Pragma", "no-cache")
        .header("Referer", format!("{Y2}/"))
        .header("Origin", Y2);
    if let Some(b) = bearer {
        req = req.header("Authorization", format!("Bearer {b}"));
    }
    let r = req.send().await.map_err(|e| e.to_string())?;
    if r.status().as_u16() != 200 {
        return Err(format!("{label} HTTP {}", r.status().as_u16()));
    }
    let j: Value = r.json().await.map_err(|_| format!("{label} bukan JSON"))?;
    let code = j.get("error").or_else(|| j.get("err")).and_then(|e| e.as_f64()).unwrap_or(0.0);
    if code > 0.0 {
        return Err(format!("{label} kode {}", code as i64));
    }
    Ok(j)
}

async fn via_y2mate(client: &reqwest::Client, id: &str, format: &str) -> Result<Value, String> {
    let mut site = y2discover(client).await?;
    let mut init: Option<Value> = None;
    for attempt in 0..2 {
        let auth = y2json(
            client,
            &format!("{}/api/v1/auth?api_key={}&_={}", site.1, site.0, now_ms()),
            "auth y2mate",
            None,
        )
        .await?;
        let key = auth
            .get("key")
            .and_then(|k| k.as_str())
            .ok_or("token y2mate tidak ada")?
            .to_string();
        match y2json(client, &format!("{}/api/v1/init?_={}", site.1, now_ms()), "init y2mate", Some(&key)).await {
            Ok(v) => {
                init = Some(v);
                break;
            }
            Err(e) => {
                if attempt == 0 && e.contains("403") {
                    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
                    site = y2discover(client).await?;
                    continue;
                }
                return Err(e);
            }
        }
    }
    let mut url = init
        .ok_or("URL convert tidak ada")?
        .get("convertURL")
        .and_then(|c| c.as_str())
        .ok_or("URL convert tidak ada")?
        .to_string();

    let mut job_title: Option<String> = None;
    let mut job_dl: Option<String> = None;
    let mut job_progress_url: Option<String> = None;
    let mut job_progress: f64 = 0.0;

    for _ in 0..6 {
        let sep = if url.contains('?') { '&' } else { '?' };
        let data = y2json(client, &format!("{url}{sep}v={id}&f={format}&_={}", now_ms()), "convert y2mate", None).await?;
        let dl = data.get("downloadURL").and_then(|d| d.as_str()).unwrap_or("").trim().to_string();
        let st = data.get("status").and_then(|s| s.as_str()).unwrap_or("").to_lowercase();
        job_title = data.get("title").and_then(|t| t.as_str()).map(|s| s.to_string());
        if st == "download" && !dl.is_empty() {
            job_dl = Some(dl);
            break;
        }
        if data.get("redirect").and_then(|r| r.as_str()) == Some("1") {
            if let Some(r) = data.get("redirectURL").and_then(|r| r.as_str()) {
                url = r.to_string();
                continue;
            }
        }
        if let Some(pu) = data.get("progressURL").and_then(|p| p.as_str()) {
            if !dl.is_empty() {
                job_dl = Some(dl);
                job_progress_url = Some(pu.to_string());
                job_progress = data.get("progress").and_then(|p| p.as_f64()).unwrap_or(0.0);
                break;
            }
        }
        return Err("convert tidak mengembalikan status valid".into());
    }
    let mut dl = job_dl.ok_or("convert gagal")?;

    if let Some(pu) = &job_progress_url {
        let mut progress = job_progress;
        for _ in 0..20 {
            if progress >= 3.0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let sep = if pu.contains('?') { '&' } else { '?' };
            let data = y2json(client, &format!("{pu}{sep}_={}", now_ms()), "progress y2mate", None).await?;
            let st = data.get("status").and_then(|s| s.as_str()).unwrap_or("").to_lowercase();
            if st == "download" {
                if let Some(newdl) = data.get("downloadURL").and_then(|d| d.as_str()) {
                    dl = newdl.to_string();
                }
                break;
            }
            progress = data.get("progress").and_then(|p| p.as_f64()).unwrap_or(progress);
            if let Some(newdl) = data.get("downloadURL").and_then(|d| d.as_str()) {
                dl = newdl.to_string();
            }
        }
    }
    if dl.is_empty() {
        return Err("download URL tidak keluar".into());
    }

    Ok(json!({
        "provider": "y2mate",
        "videoId": id,
        "format": format,
        "title": job_title,
        "downloadUrl": format!("{}&v={id}&f={format}&r=y2mate.gs", dl)
    }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let mut merged = query.clone();
    if let Some(Json(b)) = &body {
        for k in ["url", "format", "provider", "itag"] {
            if let Some(u) = b.get(k).and_then(|u| u.as_str()) {
                merged.insert(k.into(), u.to_string());
            }
        }
    }
    let input = match merged.get("url") {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "Parameter 'url' wajib diisi."
            }))).into_response()
        }
    };
    let format = merged.get("format").map(|s| s.to_lowercase()).unwrap_or_else(|| "mp4".into());
    if format != "mp4" && format != "mp3" {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Format harus mp4 atau mp3."
        }))).into_response();
    }
    let provider = merged.get("provider").map(|s| s.to_lowercase()).unwrap_or_else(|| "auto".into());
    if !["auto", "invidious", "y2mate"].contains(&provider.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false, "message": "Provider harus auto, invidious, atau y2mate."
        }))).into_response();
    }
    let itag = merged.get("itag").filter(|s| !s.is_empty()).cloned();

    let id = match video_id(&input) {
        Some(i) => i,
        None => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false, "message": "URL YouTube tidak valid."
            }))).into_response()
        }
    };

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e.to_string() }))).into_response(),
    };

    let order: Vec<&str> = match provider.as_str() {
        "invidious" => vec!["invidious"],
        "y2mate" => vec!["y2mate"],
        _ => {
            if format == "mp3" {
                vec!["y2mate", "invidious"]
            } else {
                vec!["invidious", "y2mate"]
            }
        }
    };

    let mut attempts: Vec<Value> = Vec::new();
    for name in order {
        let result = if name == "invidious" {
            via_invidious(&client, &id)
                .await
                .and_then(|info| {
                    let stream = pick_stream(&info, &format, itag.as_deref())?;
                    Ok(json!({
                        "source": input,
                        "videoId": id,
                        "title": info.get("title"),
                        "author": info.get("author"),
                        "provider": "invidious",
                        "instance": info.get("instance"),
                        "format": format,
                        "stream": stream,
                        "streams": {
                            "muxed": info.get("muxed").cloned().unwrap_or(json!([])),
                            "videoOnly": info.get("adaptive").cloned().unwrap_or(json!([]))
                                .as_array().map(|a| a.iter().filter(|f| f["kind"] == "video").cloned().collect::<Vec<_>>()).unwrap_or_default(),
                            "audioOnly": info.get("adaptive").cloned().unwrap_or(json!([]))
                                .as_array().map(|a| a.iter().filter(|f| f["kind"] == "audio").cloned().collect::<Vec<_>>()).unwrap_or_default()
                        },
                        "hlsUrl": info.get("hlsUrl"),
                        "dashUrl": info.get("dashUrl"),
                        "lengthSeconds": info.get("lengthSeconds")
                    }))
                })
        } else {
            via_y2mate(&client, &id, &format).await.map(|y| {
                json!({
                    "source": input,
                    "videoId": id,
                    "title": y.get("title"),
                    "provider": "y2mate",
                    "format": format,
                    "downloadUrl": y.get("downloadUrl")
                })
            })
        };

        match result {
            Ok(mut r) => {
                let probe_url = r
                    .pointer("/stream/url")
                    .and_then(|u| u.as_str())
                    .or_else(|| r.get("downloadUrl").and_then(|u| u.as_str()))
                    .unwrap_or("");
                let probe_res = probe(&client, probe_url).await;
                let probe_ok = probe_res.get("ok").and_then(|o| o.as_bool()).unwrap_or(true);
                r["probe"] = probe_res;
                if probe_ok {
                    r["attempts"] = json!(attempts);
                    return Json(json!({ "status": true, "result": r })).into_response();
                }
                attempts.push(json!({ "provider": name, "ok": false, "why": "link mati" }));
            }
            Err(e) => attempts.push(json!({ "provider": name, "ok": false, "why": e })),
        }
    }

    let detail = attempts
        .iter()
        .map(|a| format!("{}={}", a["provider"].as_str().unwrap_or("?"), a["why"].as_str().unwrap_or("?")))
        .collect::<Vec<_>>()
        .join("; ");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
        "status": false, "message": format!("semua provider gagal: {detail}")
    }))).into_response()
}

// Wink HD Video Enhancer — native conversion of api/hdvidio/wink-hd-video.js
// Pure HTTP: GET image.pollinations.ai/prompt/<prompt> and stream the image bytes back.
use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn jerr(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "status": false, "message": msg }))).into_response()
}

fn merge_params(query: HashMap<String, String>, body: Option<Json<Value>>) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in query {
        m.insert(k, Value::String(v));
    }
    if let Some(Json(b)) = body {
        if let Value::Object(o) = b {
            for (k, v) in o {
                m.insert(k, v);
            }
        }
    }
    Value::Object(m)
}

fn p_str<'a>(p: &'a Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        p.get(*k).and_then(|v| v.as_str()).map(|s| s.to_string())
    })
}

fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default()
}

fn bytes_response(ct: &str, bytes: bytes::Bytes) -> Response {
    (StatusCode::OK, [(header::CONTENT_TYPE, ct.to_string())], bytes).into_response()
}

// Wink HD Video Enhancer — native conversion of api/hdvidio/wink-hd-video.js.
// Pure HTTP flow via wink.ai + Meitu strategy: sign -> policy -> upload Qiniu ->
// video info -> transcode -> delivery -> poll result -> download hasil.
const BASE_URL: &str = "https://wink.ai";
const STRATEGY_URL: &str = "https://strategy.app.meitudata.com";
const CLIENT_ID: &str = "1189857605";
const VERSION: &str = "5.1.2";
const TASK_TYPE: &str = "11";
const CONTENT_TYPE: &str = "2";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

fn trace_headers() -> Vec<(&'static str, String)> {
    let trace = format!("{}-{}-1", random_hex(32), random_hex(16));
    vec![
        ("sentry-trace", trace.clone()),
        (
            "baggage",
            format!(
                "sentry-environment=release,sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1),sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54,sentry-trace_id={},sentry-sampled=true,sentry-sample_rate=0.75",
                &trace[..32]
            ),
        ),
    ]
}

fn base_params(gnum: &str, extra: &[(&str, &str)]) -> String {
    let mut params: Vec<(String, String)> = vec![
        ("client_id".into(), CLIENT_ID.into()),
        ("version".into(), VERSION.into()),
        ("country_code".into(), "ID".into()),
        ("gnum".into(), gnum.into()),
        ("client_language".into(), "en_US".into()),
        ("client_channel_id".into(), String::new()),
        ("client_timezone".into(), "Asia/Jakarta".into()),
    ];
    for (k, v) in extra {
        params.push((k.to_string(), v.to_string()));
    }
    params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn ext_to_mime(ext: &str) -> &'static str {
    match ext {
        ".mp4" => "video/mp4",
        ".mov" => "video/quicktime",
        ".webm" => "video/webm",
        ".mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

pub async fn handler(Query(query): Query<HashMap<String, String>>, body: Option<Json<Value>>) -> Response {
    let params = merge_params(query, body);
    let url = match p_str(&params, &["url"]) {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    if url::Url::parse(&url).is_err() {
        return jerr(StatusCode::BAD_REQUEST, "Format URL tidak valid");
    }
    let start = std::time::Instant::now();

    let client = match reqwest::Client::builder()
        
        .user_agent(UA)
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &format!("client error: {e}")),
    };

    // Cookies awal
    let gnum = {
        let h = random_hex(32);
        format!("{}-{}-{}", h, random_hex(16), "1")
    };
    let mut req = client.get(BASE_URL).header("origin", BASE_URL);
    for (k, v) in trace_headers() {
        req = req.header(k, v);
    }
    let _ = req.send().await;

    let ext = url
        .split('?')
        .next()
        .and_then(|u| u.rsplit('.').next())
        .map(|e| format!(".{}", e.to_lowercase()))
        .filter(|e| e.len() <= 5)
        .unwrap_or_else(|| ".mp4".to_string());

    macro_rules! step {
        ($res:expr, $label:expr) => {
            match $res {
                Ok(v) => v,
                Err(e) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                        "status": false,
                        "message": format!("{}: {}", $label, e),
                        "responseTime": format!("{}ms", start.elapsed().as_millis())
                    }))).into_response()
                }
            }
        };
    }

    // 1. get_maat_sign
    let sign_res: Value = step!(
        async {
            let mut req = client
                .get(format!(
                    "{BASE_URL}/api/file/get_maat_sign.json?{}",
                    base_params(&gnum, &[("suffix", ext.trim_start_matches('.')), ("type", "temp"), ("count", "1")])
                ))
                .header("referer", format!("{BASE_URL}/video-enhancer/upload"));
            for (k, v) in trace_headers() {
                req = req.header(k, v);
            }
            let r = req.send().await.map_err(|e| e.to_string())?;
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            if v.get("code").and_then(|c| c.as_i64()) != Some(0) {
                return Err(format!("get_maat_sign gagal: {v}"));
            }
            Ok(v.get("data").cloned().unwrap_or(json!({})))
        }
        .await,
        "get_maat_sign"
    );

    // 2. upload policy
    let sign = &sign_res;
    let policy_res: Value = step!(
        async {
            let app = sign.get("app").and_then(|v| v.as_str()).unwrap_or_default();
            let count = sign.get("count").cloned().unwrap_or(json!(1)).to_string();
            let sig = sign.get("sig").and_then(|v| v.as_str()).unwrap_or_default();
            let sig_time = sign.get("sig_time").and_then(|v| v.as_str()).unwrap_or_default();
            let sig_version = sign.get("sig_version").and_then(|v| v.as_str()).unwrap_or_default();
            let suffix = sign.get("suffix").and_then(|v| v.as_str()).unwrap_or_default();
            let stype = sign.get("type").and_then(|v| v.as_str()).unwrap_or_default();
            let url = format!(
                "{STRATEGY_URL}/upload/policy?app={app}&count={count}&sig={sig}&sigTime={sig_time}&sigVersion={sig_version}&suffix={suffix}&type={stype}"
            );
            let r = client
                .get(&url)
                .header("origin", BASE_URL)
                .header("referer", format!("{BASE_URL}/"))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            v.get(0)
                .and_then(|x| x.get("qiniu"))
                .cloned()
                .ok_or_else(|| format!("upload policy gagal: {v}"))
        }
        .await,
        "upload policy"
    );

    // 3. download video source lalu upload ke Qiniu
    let video_bytes: bytes::Bytes = step!(
        async {
            let r = client.get(&url).send().await.map_err(|e| e.to_string())?;
            r.bytes().await.map_err(|e| e.to_string())
        }
        .await,
        "download video"
    );
    let policy_url = policy_res.get("url").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let policy_key = policy_res.get("key").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let policy_token = policy_res.get("token").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let fname = format!("input{ext}");

    let upload_res: Value = step!(
        async {
            let form = reqwest::multipart::Form::new()
                .part("file", reqwest::multipart::Part::bytes(video_bytes.to_vec()).file_name(fname.clone()))
                .part("token", reqwest::multipart::Part::text(policy_token.clone()))
                .part("key", reqwest::multipart::Part::text(policy_key.clone()))
                .part("fname", reqwest::multipart::Part::text(fname.clone()));
            let r = client
                .post(&policy_url)
                .header("origin", BASE_URL)
                .header("referer", format!("{BASE_URL}/"))
                .multipart(form)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !r.status().is_success() {
                return Err(format!("upload qiniu gagal HTTP {}", r.status().as_u16()));
            }
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            if v.get("url").is_none() && v.get("data").is_none() {
                return Err(format!("upload qiniu response tidak valid: {v}"));
            }
            Ok(v)
        }
        .await,
        "upload qiniu"
    );
    let source_url = upload_res
        .get("url")
        .and_then(|v| v.as_str())
        .or_else(|| upload_res.get("data").and_then(|v| v.as_str()))
        .unwrap_or(&policy_key)
        .to_string();

    // 4-6. video info, transcode start, wait transcode
    let _ = source_url.clone();
    let info: Value = step!(
        async {
            let mut req = client
                .post(format!("{BASE_URL}/api/file/video_cover_and_display_info_ext.json"))
                            .header("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
                .body(base_params(&gnum, &[("file_key", &policy_key)]));
            for (k, v) in trace_headers() {
                req = req.header(k, v);
            }
            let r = req.send().await.map_err(|e| e.to_string())?;
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            if v.get("code").and_then(|c| c.as_i64()) != Some(0) {
                return Err(format!("video info gagal: {v}"));
            }
            Ok(v.get("data").cloned().unwrap_or(json!({})))
        }
        .await,
        "video info"
    );

    let transcode_id: String = step!(
        async {
            let mut req = client
                .post(format!("{BASE_URL}/api/file/video_trans_start.json"))
                            .header("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
                .body(base_params(&gnum, &[("file_key", &policy_key)]));
            for (k, v) in trace_headers() {
                req = req.header(k, v);
            }
            let r = req.send().await.map_err(|e| e.to_string())?;
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            if v.get("code").and_then(|c| c.as_i64()) != Some(0) {
                return Err(format!("transcode start gagal: {v}"));
            }
            v.pointer("/data/id")
                .and_then(|i| i.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| format!("transcode start gagal: {v}"))
        }
        .await,
        "transcode start"
    );

    // wait transcode (maks 80x3s)
    let mut video_transcoded = source_url.clone();
    for _ in 0..80 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let mut req = client
            .get(format!(
                "{BASE_URL}/api/file/video_trans_query.json?{}",
                base_params(&gnum, &[("id", &transcode_id)])
            ))
            .header("referer", format!("{BASE_URL}/video-enhancer/upload"));
        for (k, v) in trace_headers() {
            req = req.header(k, v);
        }
        if let Ok(r) = req.send().await {
            if let Ok(v) = r.json::<Value>().await {
                if v.get("code").and_then(|c| c.as_i64()) == Some(0) {
                    let d = v.get("data").cloned().unwrap_or(json!({}));
                    let candidate = d
                        .get("video_transcoded")
                        .or_else(|| d.get("transcoded_video"))
                        .or_else(|| d.get("transcoded_url"))
                        .or_else(|| d.get("video_url"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if !candidate.is_empty() {
                        video_transcoded = d
                            .get("video")
                            .and_then(|x| x.as_str())
                            .unwrap_or(&source_url)
                            .to_string();
                        break;
                    }
                }
            }
        }
    }

    // 7. delivery
    let task_name = format!("Enhancer-Ultra HD-{fname}");
    let delivery_body = base_params(
        &gnum,
        &[
            ("type", TASK_TYPE),
            ("content_type", CONTENT_TYPE),
            ("source_url", &video_transcoded),
            (
                "type_params",
                r#"{"is_mirror":0,"orientation_tag":1,"j_420_trans":"1","return_ext":"2"}"#,
            ),
            (
                "right_detail",
                r#"{"source":"1","touch_type":"4","function_id":"630","material_id":"63011","url":"https://wink.ai/video-enhancer/upload"}"#,
            ),
            (
                "ext_params",
                &format!(
                    r#"{{\"task_name\":\"{task_name}\",\"records\":\"{TASK_TYPE}\",\"video_transcoded\":\"{video_transcoded}\"}}"#
                ),
            ),
            ("with_prepare", "1"),
        ],
    );
    let msg_id: String = step!(
        async {
            let mut req = client
                .post(format!("{BASE_URL}/api/meitu_ai/delivery.json"))
                            .header("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
                .body(delivery_body);
            for (k, v) in trace_headers() {
                req = req.header(k, v);
            }
            let r = req.send().await.map_err(|e| e.to_string())?;
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            if v.get("code").and_then(|c| c.as_i64()) != Some(0) {
                return Err(format!("delivery gagal: {v}"));
            }
            let d = v.get("data").cloned().unwrap_or(json!({}));
            d.get("msg_id")
                .or_else(|| d.get("prepare_msg_id"))
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "delivery tidak mengembalikan msg_id".into())
        }
        .await,
        "delivery"
    );

    // 8. wait result (maks 120x5s, mengikuti next msg_id)
    let mut current_msg_id = msg_id;
    let mut result_url = String::new();
    for _ in 0..120 {
        let mut req = client
            .get(format!(
                "{BASE_URL}/api/meitu_ai/query_batch.json?{}",
                base_params(&gnum, &[("msg_ids", &current_msg_id)])
            ))
            .header("referer", format!("{BASE_URL}/video-enhancer/upload"));
        for (k, v) in trace_headers() {
            req = req.header(k, v);
        }
        let data: Value = match req.send().await {
            Ok(r) => match r.json().await {
                Ok(v) => v,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }
            },
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };
        if data.get("code").and_then(|c| c.as_i64()) != Some(0) {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }
        let item = data.pointer("/item_list/0").cloned().unwrap_or(json!({}));
        let result = item.get("result").cloned().unwrap_or(json!({}));

        // next msg id
        let next = result
            .get("result")
            .and_then(|r| r.as_str())
            .filter(|s| !s.starts_with("http"))
            .map(|s| s.to_string())
            .or_else(|| result.get("msg_id").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .filter(|s| !s.is_empty() && s != &current_msg_id && !s.starts_with("wpr_"));
        if let Some(next) = next {
            current_msg_id = next;
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            continue;
        }

        let url_out = result
            .pointer("/media_info_list/0/media_data")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .or_else(|| result.get("result_url").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .or_else(|| result.get("url").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or_default();
        let error_code = result.get("error_code").and_then(|e| e.as_i64()).unwrap_or(0);
        if url_out.starts_with("http") && error_code == 0 {
            result_url = url_out;
            break;
        }
        if error_code != 0 && error_code != 29901 {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": format!("task gagal: {error_code}"),
                "responseTime": format!("{}ms", start.elapsed().as_millis())
            }))).into_response();
        }
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
    if result_url.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": false,
            "message": "result belum selesai",
            "responseTime": format!("{}ms", start.elapsed().as_millis())
        }))).into_response();
    }

    // 9. download hasil
    let final_res = step!(
        async { client.get(&result_url).send().await.map_err(|e| e.to_string()) }.await,
        "download hasil"
    );
    let mime = final_res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();
    match final_res.bytes().await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, header::HeaderValue::from_str(&mime).unwrap_or(header::HeaderValue::from_static("video/mp4"))),
                (header::HeaderName::from_static("x-processor"), header::HeaderValue::from_static("wink.ai")),
                (
                    header::HeaderName::from_static("x-generated-in"),
                    header::HeaderValue::from_str(&format!("{}ms", start.elapsed().as_millis())).unwrap_or(header::HeaderValue::from_static("0ms")),
                ),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "status": false,
                "message": format!("Gagal enhance video: {e}"),
                "responseTime": format!("{}ms", start.elapsed().as_millis())
            }))).into_response()
        }
    }
}

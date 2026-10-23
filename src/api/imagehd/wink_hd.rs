// Wink HD Enhancer — native conversion of api/imagehd/wink-hd.js
// wink.ai (meitu): get_maat_sign -> upload policy -> qiniu upload -> meta_info ->
// calc beans -> delivery -> query_batch polling -> download result image.
use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const BASE_URL: &str = "https://wink.ai";
const STRATEGY_URL: &str = "https://strategy.app.meitudata.com";
const CLIENT_ID: &str = "1189857605";
const VERSION: &str = "5.1.2";
const COUNTRY_CODE: &str = "ID";
const CLIENT_LANGUAGE: &str = "en_US";
const CLIENT_TIMEZONE: &str = "Asia/Jakarta";
const TASK_TYPE: &str = "12";
const CONTENT_TYPE: &str = "1";
const EXT_VALUE: &str = "2";
const UA: &str = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

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

fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn make_trace() -> String {
    format!("{}-{}-1", random_hex(16), random_hex(8))
}

fn trace_headers(transaction: &str) -> Vec<(String, String)> {
    let trace = make_trace();
    vec![
        (
            "sentry-trace".to_string(),
            trace.clone(),
        ),
        (
            "baggage".to_string(),
            [
                "sentry-environment=release",
                "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
                "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
                &format!("sentry-trace_id={}", trace.split('-').next().unwrap_or("")),
                &format!("sentry-transaction={transaction}"),
                "sentry-sampled=true",
                "sentry-sample_rate=0.75",
            ]
            .join(","),
        ),
    ]
}

fn base_params(gnum: &str, extra: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = vec![
        ("client_id".to_string(), CLIENT_ID.to_string()),
        ("version".to_string(), VERSION.to_string()),
        ("country_code".to_string(), COUNTRY_CODE.to_string()),
        ("gnum".to_string(), gnum.to_string()),
        ("client_language".to_string(), CLIENT_LANGUAGE.to_string()),
        ("client_channel_id".to_string(), String::new()),
        ("client_timezone".to_string(), CLIENT_TIMEZONE.to_string()),
    ];
    for (k, val) in extra {
        v.push((k.to_string(), val.to_string()));
    }
    v
}

struct WinkApi {
    client: reqwest::Client,
    cookies: Vec<String>,
}

fn ext_to_mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn file_suffix(ext: &str) -> String {
    if ext.is_empty() { ".jpg".to_string() } else if ext == "jpeg" { ".jpg".to_string() } else { format!(".{ext}") }
}

impl WinkApi {
    fn new(gnum: &str) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            
            .build()
            .map_err(|e| e.to_string())?;
        let sm_cookie = format!("_sm={gnum}; Path=/; Domain=wink.ai");
        let meitu = format!(
            "meitustat={}; Path=/; Domain=wink.ai",
            urlencoding::encode(&json!({ "wgid": gnum }).to_string())
        );
        Ok(WinkApi { client, cookies: vec![sm_cookie, meitu] })
    }

    async fn get(&self, url: &str, extra_headers: &[(String, String)]) -> Result<Value, String> {
        let mut req = self
            .client
            .get(url)
                        .header("accept", "*/*")
            .header("origin", BASE_URL)
            .header("referer", format!("{BASE_URL}/image-enhancer/upload"))
            .header("user-agent", UA)
            .header("cookie", self.cookies.join("; "));
        for (k, v) in extra_headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let data: Value = res.json().await.unwrap_or(Value::Null);
        if status >= 400 || data.get("code").and_then(|c| c.as_i64()) != Some(0) {
            return Err(format!("gagal: {data}"));
        }
        Ok(data)
    }

    async fn post_form(&self, url: &str, form: &[(String, String)], extra_headers: &[(String, String)]) -> Result<Value, String> {
        let mut req = self
            .client
            .post(url)
                        .header("accept", "*/*")
            .header("origin", BASE_URL)
            .header("referer", format!("{BASE_URL}/image-enhancer/upload"))
            .header("user-agent", UA)
            .header("cookie", self.cookies.join("; "))
                        .header("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
        for (k, v) in extra_headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let res = req.form(form).send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let data: Value = res.json().await.unwrap_or(Value::Null);
        if status >= 400 || data.get("code").and_then(|c| c.as_i64()) != Some(0) {
            return Err(format!("gagal: {data}"));
        }
        Ok(data)
    }
}

async fn get_maat_sign(api: &WinkApi, gnum: &str, suffix: &str) -> Result<Value, String> {
    let params = base_params(gnum, &[("suffix", suffix), ("type", "temp"), ("count", "1")]);
    let qs: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let headers = trace_headers("GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload");
    let data = api.get(&format!("{BASE_URL}/api/file/get_maat_sign.json?{qs}"), &headers).await?;
    data.get("data")
        .cloned()
        .ok_or_else(|| format!("get_maat_sign gagal: {data}"))
}

async fn get_upload_policy(sign: &Value) -> Result<Value, String> {
    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let qs: String = [
        ("app", sign.get("app").and_then(|v| v.as_str()).unwrap_or("")),
        ("count", &sign.get("count").map(|v| v.to_string()).unwrap_or_default()),
        ("sig", sign.get("sig").and_then(|v| v.as_str()).unwrap_or("")),
        ("sigTime", &sign.get("sig_time").map(|v| v.to_string()).unwrap_or_default()),
        ("sigVersion", &sign.get("sig_version").map(|v| v.to_string()).unwrap_or_default()),
        ("suffix", sign.get("suffix").and_then(|v| v.as_str()).unwrap_or("")),
        ("type", sign.get("type").and_then(|v| v.as_str()).unwrap_or("")),
    ]
    .iter()
    .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
    .collect::<Vec<_>>()
    .join("&");

    let res = cl
        .get(format!("{STRATEGY_URL}/upload/policy?{qs}"))
                    .header("accept", "*/*")
        .header("origin", BASE_URL)
        .header("referer", format!("{BASE_URL}/"))
        .header("user-agent", UA)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    let qiniu = data.get(0).and_then(|d| d.get("qiniu")).cloned();
    if status >= 400 || qiniu.is_none() {
        return Err(format!("upload policy gagal: {data}"));
    }
    Ok(qiniu.unwrap())
}

async fn upload_to_qiniu(policy: &Value, buffer: Vec<u8>, filename: &str, ext: &str) -> Result<(String, String), String> {
    let token = policy.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let key = policy.get("key").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let url = policy.get("url").and_then(|t| t.as_str()).unwrap_or("").to_string();

    let cl = reqwest::Client::builder()
        
        .build()
        .map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(buffer)
        .file_name(filename.to_string())
        .mime_str(ext_to_mime(ext))
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("token", token)
        .text("key", key.clone())
        .text("fname", filename.to_string());

    let res = cl
        .post(&url)
        .header("origin", BASE_URL)
        .header("referer", format!("{BASE_URL}/"))
        .header("user-agent", UA)
                    .header("accept", "*/*")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    if status >= 400 {
        return Err(format!("upload qiniu gagal HTTP {status}: {text}"));
    }
    let data: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let source_url = data
        .get("url")
        .and_then(|u| u.as_str())
        .or_else(|| data.get("data").and_then(|u| u.as_str()))
        .unwrap_or("")
        .to_string();
    if source_url.is_empty() {
        return Err(format!("upload qiniu response tidak valid: {text}"));
    }
    Ok((key, source_url))
}

async fn get_meta_info(api: &WinkApi, gnum: &str, file_key: &str) -> Result<(), String> {
    let body = base_params(gnum, &[("file_key", file_key)]);
    let headers = trace_headers("GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload");
    api.post_form(&format!("{BASE_URL}/api/file/meta_info.json"), &body, &headers)
        .await
        .map(|_| ())
}

async fn calc_need_beans(api: &WinkApi, gnum: &str) -> Result<(), String> {
    let type_params = json!({ "is_mirror": 0, "orientation_tag": 1, "j_420_trans": "1", "return_ext": "2" }).to_string();
    let right_detail = json!({
        "source": "1", "touch_type": "4", "function_id": "630", "material_id": "63011",
        "url": "https://wink.ai/image-enhancer/upload"
    })
    .to_string();
    let item_list = json!([{
        "type": TASK_TYPE.parse::<i64>().unwrap_or(12),
        "ext_value": EXT_VALUE,
        "content_type": CONTENT_TYPE.parse::<i64>().unwrap_or(1),
        "duration": 0,
        "type_params": type_params,
        "right_detail": right_detail
    }])
    .to_string();

    let body = base_params(gnum, &[("item_list", item_list.as_str())]);
    let headers = trace_headers("GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload");
    api.post_form(&format!("{BASE_URL}/api/subscribe/batch_calc_need_beans.json"), &body, &headers)
        .await
        .map(|_| ())
}

async fn delivery(api: &WinkApi, gnum: &str, source_url: &str, task_name: &str) -> Result<(String, String), String> {
    let type_params = json!({ "is_mirror": 0, "orientation_tag": 1, "j_420_trans": "1", "return_ext": "2" }).to_string();
    let right_detail = json!({
        "source": "1", "touch_type": "4", "function_id": "630", "material_id": "63011",
        "url": "https://wink.ai/image-enhancer/upload"
    })
    .to_string();
    let ext_params = json!({ "task_name": task_name, "records": TASK_TYPE }).to_string();

    let body = base_params(
        gnum,
        &[
            ("type", TASK_TYPE),
            ("content_type", CONTENT_TYPE),
            ("source_url", source_url),
            ("type_params", type_params.as_str()),
            ("right_detail", right_detail.as_str()),
            ("ext_params", ext_params.as_str()),
            ("with_prepare", "1"),
        ],
    );
    let headers = trace_headers("GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload");
    let data = api
        .post_form(&format!("{BASE_URL}/api/meitu_ai/delivery.json"), &body, &headers)
        .await?;
    let d = data.get("data").cloned().unwrap_or(Value::Null);
    Ok((
        d.get("msg_id").and_then(|m| m.as_str()).unwrap_or("").to_string(),
        d.get("prepare_msg_id").and_then(|m| m.as_str()).unwrap_or("").to_string(),
    ))
}

async fn query_batch(api: &WinkApi, gnum: &str, msg_id: &str) -> Result<Value, String> {
    let params = base_params(gnum, &[("msg_ids", msg_id)]);
    let qs: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let mut headers = trace_headers("%2F%3Alocale%2Feditor%2Frecent-task");
    headers.push(("referer".to_string(), format!("{BASE_URL}/image-enhancer/upload")));
    api.get(&format!("{BASE_URL}/api/meitu_ai/query_batch.json?{qs}"), &headers)
        .await
}

fn extract_result_url(data: &Value) -> String {
    data.pointer("/item_list/0/result/media_info_list/0/media_data")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string()
}

fn extract_next_msg_id(data: &Value, current_msg_id: &str) -> String {
    let item = data.pointer("/item_list/0");
    let result_value = item
        .and_then(|i| i.pointer("/result/result"))
        .and_then(|r| r.as_str())
        .unwrap_or("");
    let real_msg_id = item
        .and_then(|i| {
            i.pointer("/result/msg_id")
                .or_else(|| i.get("msg_id"))
        })
        .and_then(|r| r.as_str())
        .unwrap_or("");
    if !result_value.is_empty()
        && result_value != current_msg_id
        && !result_value.starts_with("http")
    {
        return result_value.to_string();
    }
    if !real_msg_id.is_empty() && real_msg_id != current_msg_id && !real_msg_id.starts_with("wpr_") {
        return real_msg_id.to_string();
    }
    String::new()
}

async fn wait_result(api: &WinkApi, gnum: &str, first_msg_id: &str) -> Result<String, String> {
    let mut msg_id = first_msg_id.to_string();
    let mut last = Value::Null;
    for _ in 0..80 {
        let data = query_batch(api, gnum, &msg_id).await?;
        last = data.clone();
        let next = extract_next_msg_id(&data, &msg_id);
        if !next.is_empty() {
            msg_id = next;
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            continue;
        }
        let url = extract_result_url(&data);
        let error_code = data
            .pointer("/item_list/0/result/error_code")
            .and_then(|e| e.as_i64())
            .unwrap_or(0);
        let error_msg = data
            .pointer("/item_list/0/result/error_msg")
            .and_then(|e| e.as_str())
            .unwrap_or("");
        if url.starts_with("http") && error_code == 0 {
            return Ok(url);
        }
        if error_code != 0 && error_code != 29901 {
            return Err(format!("task gagal: {error_code} {error_msg}"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    }
    Err(format!("result belum selesai: {last}"))
}

fn ext_from_url(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    path.rsplit('.').next().unwrap_or("").to_lowercase()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let params = merge_params(query, body);
    let url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return jerr(StatusCode::BAD_REQUEST, "Parameter 'url' wajib diisi"),
    };
    if reqwest::Url::parse(&url).is_err() {
        return jerr(StatusCode::BAD_REQUEST, "Format URL tidak valid");
    }

    let start = std::time::Instant::now();

    let run = async {
        // Download source image
        let dl = reqwest::Client::builder()
            
            .build()
            .map_err(|e| e.to_string())?;
        let res = dl.get(&url).send().await.map_err(|e| e.to_string())?;
        let buf = res.bytes().await.map_err(|e| e.to_string())?.to_vec();

        let gnum = format!(
            "{}-{}-{}-{}-{}",
            &random_hex(4),
            &random_hex(2),
            &random_hex(2),
            &random_hex(2),
            &random_hex(6)
        );
        let api = WinkApi::new(&gnum)?;

        let ext = ext_from_url(&url);
        let suffix = file_suffix(&ext);
        let filename = format!("input{suffix}");
        let task_name = format!("Enhancer-Ultra HD-input");

        // 1-2. signature + policy
        let sign = get_maat_sign(&api, &gnum, &suffix).await?;
        let policy = get_upload_policy(&sign).await?;
        // 3. upload to qiniu
        let (file_key, source_url) = upload_to_qiniu(&policy, buf, &filename, &ext).await?;
        // 4-5. meta + beans
        get_meta_info(&api, &gnum, &file_key).await?;
        calc_need_beans(&api, &gnum).await?;
        // 6. delivery
        let (msg_id, prepare_msg_id) = delivery(&api, &gnum, &source_url, &task_name).await?;
        let first = if !msg_id.is_empty() { msg_id } else { prepare_msg_id };
        if first.is_empty() {
            return Err("delivery tidak mengembalikan msg_id".to_string());
        }
        // 7. poll
        wait_result(&api, &gnum, &first).await
    };

    let result_url = match run.await {
        Ok(u) => u,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "status": false,
                    "message": e,
                    "responseTime": format!("{}ms", start.elapsed().as_millis())
                })),
            )
                .into_response()
        }
    };

    let dl_cl = reqwest::Client::builder()
        
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = match dl_cl.get(&result_url).send().await {
        Ok(r) => r,
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let mime = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let buffer = match res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return jerr(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .header("Content-Length", buffer.len().to_string())
                    .header("X-Processor", "wink.ai")
        .header("X-Generated-In", format!("{}ms", start.elapsed().as_millis()))
        .body(axum::body::Body::from(buffer))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

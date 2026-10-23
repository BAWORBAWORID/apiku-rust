// Solve helpers: response format + shared HTTP client utilities
use serde_json::{json, Value};

/// Standard success response matching Node.js apiku format
pub fn ok(result: Value) -> Value {
    json!({ "status": true, "result": result })
}

/// Standard error response matching Node.js apiku format
pub fn err(message: &str) -> Value {
    json!({ "status": false, "message": message })
}

/// Parse merged query + JSON body params (mirrors `{ ...req.query, ...req.body }` in Node).
pub fn merged_params(
    query: &std::collections::HashMap<String, String>,
    body: Option<Value>,
) -> Value {
    let mut map = serde_json::Map::new();
    for (k, v) in query {
        map.insert(k.clone(), json!(v));
    }
    if let Some(Value::Object(body_map)) = body {
        for (k, v) in body_map {
            map.insert(k, v);
        }
    }
    Value::Object(map)
}

/// Build a reqwest client with browser-like default headers and optional proxy.
pub fn http_client(proxy: Option<&str>, timeout_secs: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10));

    if let Some(p) = proxy {
        if !p.is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(p).map_err(|e| format!("invalid proxy: {e}"))?);
        }
    }

    builder.build().map_err(|e| format!("client build error: {e}"))
}

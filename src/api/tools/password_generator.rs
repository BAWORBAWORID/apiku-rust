// PasswordGenerator — native conversion of api/tools/password-generator.js
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const SIMILAR: &str = "il1Lo0O";

struct Options {
    length: usize,
    include_lowercase: bool,
    include_uppercase: bool,
    include_numbers: bool,
    include_symbols: bool,
    exclude_similar: bool,
    custom_chars: String,
}

fn gen_password(opts: &Options) -> Result<String, String> {
    use rand::Rng;
    if !(4..=128).contains(&opts.length) {
        return Err("Password length must be between 4 and 128 characters".into());
    }

    let mut pool = String::new();
    if opts.include_lowercase {
        pool.push_str(LOWERCASE);
    }
    if opts.include_uppercase {
        pool.push_str(UPPERCASE);
    }
    if opts.include_numbers {
        pool.push_str(NUMBERS);
    }
    if opts.include_symbols {
        pool.push_str(SYMBOLS);
    }
    pool.push_str(&opts.custom_chars);

    if pool.is_empty() {
        return Err("At least one character type must be selected".into());
    }

    if opts.exclude_similar {
        pool = pool.chars().filter(|c| !SIMILAR.contains(*c)).collect();
    }

    let pool_chars: Vec<char> = pool.chars().collect();
    let mut rng = rand::thread_rng();
    let mut password: String = (0..opts.length)
        .map(|_| pool_chars[rng.gen_range(0..pool_chars.len())])
        .collect();

    // Ensure at least one of each selected type (mirrors Node logic loosely)
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_num = password.chars().any(|c| c.is_ascii_digit());
    let has_sym = password.chars().any(|c| SYMBOLS.contains(c));

    let mut ensure = |password: &mut String, set: &str| {
        let chars: Vec<char> = set.chars().collect();
        let c = chars[rng.gen_range(0..chars.len())];
        let idx = rng.gen_range(0..password.len());
        let mut bytes: Vec<char> = password.chars().collect();
        bytes[idx] = c;
        *password = bytes.into_iter().collect();
    };

    if opts.include_lowercase && !has_lower {
        ensure(&mut password, LOWERCASE);
    }
    if opts.include_uppercase && !has_upper {
        ensure(&mut password, UPPERCASE);
    }
    if opts.include_numbers && !has_num {
        ensure(&mut password, NUMBERS);
    }
    if opts.include_symbols && !has_sym {
        ensure(&mut password, SYMBOLS);
    }

    Ok(password)
}

fn calculate_entropy(password: &str) -> f64 {
    if password.is_empty() {
        return 0.0;
    }
    let mut size = 0.0;
    if password.chars().any(|c| c.is_ascii_lowercase()) {
        size += 26.0;
    }
    if password.chars().any(|c| c.is_ascii_uppercase()) {
        size += 26.0;
    }
    if password.chars().any(|c| c.is_ascii_digit()) {
        size += 10.0;
    }
    if password.chars().any(|c| !c.is_ascii_alphanumeric()) {
        size += 32.0;
    }
    if size == 0.0 {
        return 0.0;
    }
    ((size as f64).powi(password.len() as i32)).log2()
}

fn strength(password: &str) -> &'static str {
    let e = calculate_entropy(password);
    if e < 28.0 {
        "Very Weak"
    } else if e < 36.0 {
        "Weak"
    } else if e < 60.0 {
        "Good"
    } else if e < 80.0 {
        "Strong"
    } else {
        "Very Strong"
    }
}

fn parse_bool(v: Option<String>, default: bool) -> bool {
    match v {
        Some(s) => s == "true" || s == "1",
        None => default,
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str().map(|s| s.to_string()).or_else(|| {
                    if v.is_null() {
                        None
                    } else {
                        Some(v.to_string())
                    }
                })
            })
        })
    };

    let count: i64 = get("count").and_then(|c| c.parse().ok()).unwrap_or(1);
    if count > 50 {
        return Json(json!({"success": false, "error": "Maximum count is 50 passwords"}))
            .into_response();
    }

    let opts = Options {
        length: get("length").and_then(|l| l.parse().ok()).unwrap_or(12),
        include_lowercase: parse_bool(get("includeLowercase"), true),
        include_uppercase: parse_bool(get("includeUppercase"), true),
        include_numbers: parse_bool(get("includeNumbers"), true),
        include_symbols: parse_bool(get("includeSymbols"), true),
        exclude_similar: parse_bool(get("excludeSimilar"), false),
        custom_chars: get("customChars").unwrap_or_default(),
    };

    if count == 1 {
        return match gen_password(&opts) {
            Ok(password) => Json(json!({
                "data": {
                    "success": true,
                    "password": password,
                    "length": password.len(),
                    "entropy": (calculate_entropy(&password) * 100.0).round() / 100.0,
                    "strength": strength(&password),
                    "character_types": {
                        "lowercase": password.chars().any(|c| c.is_ascii_lowercase()),
                        "uppercase": password.chars().any(|c| c.is_ascii_uppercase()),
                        "numbers": password.chars().any(|c| c.is_ascii_digit()),
                        "symbols": password.chars().any(|c| !c.is_ascii_alphanumeric()),
                    }
                }
            }))
            .into_response(),
            Err(e) => Json(json!({"success": false, "error": e})).into_response(),
        };
    }

    let mut results = Vec::new();
    for _ in 0..count {
        match gen_password(&opts) {
            Ok(password) => results.push(json!({
                "password": password,
                "length": password.len(),
                "entropy": (calculate_entropy(&password) * 100.0).round() / 100.0,
                "strength": strength(&password),
            })),
            Err(e) => return Json(json!({"success": false, "error": e})).into_response(),
        }
    }

    Json(json!({
        "success": true,
        "count": count,
        "passwords": results,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    })).into_response()

}

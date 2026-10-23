use axum::{
    extract::Query,
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct MathParams {
    pub level: Option<String>,
    pub mode: Option<String>,
}

pub async fn handler(
    Query(query): Query<MathParams>,
    body: Option<Json<MathParams>>,
) -> impl IntoResponse {
    let level_raw = query.level
        .or(query.mode)
        .or_else(|| body.as_ref().and_then(|b| b.level.clone().or_else(|| b.mode.clone())))
        .unwrap_or_else(|| "easy".to_string());

    let level = level_raw.to_lowercase();
    let mut rng = rand::thread_rng();

    let (min, max, ops, time_ms, bonus) = match level.as_str() {
        "noob" => (-3, 3, vec!['+', '-'], 15000, 10),
        "medium" => (-40, 40, vec!['+', '-', '*'], 40000, 150),
        "hard" => (-100, 100, vec!['+', '-', '*'], 60000, 350),
        "extreme" => (-1000, 1000, vec!['*', '+', '-'], 99999, 9999),
        _ => (-10, 10, vec!['+', '-', '*'], 20000, 40), // default easy
    };

    let op = ops[rng.gen_range(0..ops.len())];
    let a = rng.gen_range(min..=max);
    let b = rng.gen_range(min..=max);

    let (res_val, str_problem) = match op {
        '+' => (a + b, format!("{} + {}", a, b)),
        '-' => (a - b, format!("{} - {}", a, b)),
        '*' => (a * b, format!("{} × {}", a, b)),
        _ => (a + b, format!("{} + {}", a, b)),
    };

    Json(json!({
        "status": true,
        "result": {
            "mode": level,
            "soal": str_problem,
            "jawaban": res_val,
            "waktu": format!("{}s", time_ms / 1000),
            "bonus": bonus
        }
    })).into_response()
}

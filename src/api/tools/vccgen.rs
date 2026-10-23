// VccGen — native conversion of api/tools/vccgen.js (Luhn-valid VCC generator)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const DEFAULT_BIN: &str = "4258-8164|07|20-27";

struct Network {
    name: &'static str,
    lengths: [usize; 2],
    cvv_length: usize,
}

fn detect_network(bin: &str) -> Network {
    let t: u32 = bin.get(0..2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let r: u32 = bin.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(0);
    let a: u32 = bin.get(0..6).and_then(|s| s.parse().ok()).unwrap_or(0);
    let r3: u32 = bin.get(0..3).and_then(|s| s.parse().ok()).unwrap_or(0);

    let _ = a;
    if t == 34 || t == 37 {
        Network {
            name: "American Express",
            lengths: [15, 15],
            cvv_length: 4,
        }
    } else if (51..=55).contains(&t) || (bin.len() >= 4 && (2221..=2720).contains(&r)) {
        Network {
            name: "Mastercard",
            lengths: [16, 16],
            cvv_length: 3,
        }
    } else if bin.starts_with('4') {
        Network {
            name: "Visa",
            lengths: [16, 19],
            cvv_length: 3,
        }
    } else if (bin.len() >= 4 && r == 6011)
        || (bin.len() >= 6 && (622126..=622925).contains(&a))
        || (bin.len() >= 3 && (644..=649).contains(&r3))
        || t == 65
    {
        Network {
            name: "Discover",
            lengths: [16, 19],
            cvv_length: 3,
        }
    } else if bin.len() >= 4 && (3528..=3589).contains(&r) {
        Network {
            name: "JCB",
            lengths: [16, 19],
            cvv_length: 3,
        }
    } else if (bin.len() >= 3 && (300..=305).contains(&r3)) || t == 36 || t == 38 {
        Network {
            name: "Diners Club",
            lengths: [14, 16],
            cvv_length: 3,
        }
    } else if t == 62 {
        Network {
            name: "UnionPay",
            lengths: [16, 19],
            cvv_length: 3,
        }
    } else {
        Network {
            name: "Unknown",
            lengths: [16, 16],
            cvv_length: 3,
        }
    }
}

fn luhn_check_digit(digits: &[u32]) -> u32 {
    // digits: PAN without check digit; parity matches JS generateLuhnNumber
    // (double starts true at rightmost)
    let mut sum = 0u32;
    let mut double = true;
    for &d in digits.iter().rev() {
        let mut x = d;
        if double {
            x *= 2;
            if x > 9 {
                x -= 9;
            }
        }
        sum += x;
        double = !double;
    }
    (10 - (sum % 10)) % 10
}

fn is_valid_luhn(card: &str) -> bool {
    let digits: Vec<u32> = card
        .chars()
        .filter(|c| c.is_ascii_digit())
        .map(|c| c as u32 - 48)
        .collect();
    let mut sum = 0u32;
    let mut double = false;
    for &d in digits.iter().rev() {
        let mut x = d;
        if double {
            x *= 2;
            if x > 9 {
                x -= 9;
            }
        }
        sum += x;
        double = !double;
    }
    sum % 10 == 0
}

fn generate_luhn_number(bin: &str, target_len: usize) -> String {
    let mut digits: Vec<u32> = bin.chars().filter_map(|c| c.to_digit(10)).collect();
    use rand::Rng;
    while digits.len() < target_len - 1 {
        digits.push(rand::thread_rng().gen_range(0..10));
    }
    let check = luhn_check_digit(&digits);
    digits.push(check);
    digits.iter().map(|d| d.to_string()).collect()
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

    let bin_input = get("bin").unwrap_or_default();
    let amount_raw = get("amount").unwrap_or_default();

    let clean_input = if bin_input.trim().is_empty() {
        DEFAULT_BIN.to_string()
    } else {
        bin_input.trim().to_string()
    };
    let parts: Vec<&str> = clean_input.split('|').map(|p| p.trim()).collect();
    let clean_bin: String = parts
        .first()
        .unwrap_or(&"")
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(16)
        .collect();

    if clean_bin.len() < 2 {
        return Json(json!({
            "status": false,
            "message": "BIN minimal harus memiliki 2 digit angka."
        }))
        .into_response();
    }

    let parsed_amount: i64 = amount_raw.trim().parse().unwrap_or(0);
    let total = if parsed_amount >= 1 {
        parsed_amount.min(100)
    } else {
        10
    } as usize;

    let network = detect_network(&clean_bin);
    let target_length = network.lengths[0];
    let cvv_length = network.cvv_length;

    let custom_month: Option<String> = parts.get(1).and_then(|p| {
        let m: String = p.chars().filter(|c| c.is_ascii_digit()).collect();
        if m.is_empty() {
            None
        } else {
            Some(format!("{:0>2}", m))
        }
    });
    let custom_year: Option<String> = parts.get(2).and_then(|p| {
        let mut y: String = p.chars().filter(|c| c.is_ascii_digit()).collect();
        if y.len() == 2 {
            y = format!("20{}", y);
        } else if y.len() > 4 {
            y = y[y.len() - 4..].to_string();
        }
        if y.is_empty() {
            None
        } else {
            Some(y)
        }
    });
    let custom_cvv: Option<String> = parts.get(3).and_then(|p| {
        let c: String = p.chars().filter(|c| c.is_ascii_digit()).collect();
        if c.is_empty() {
            None
        } else {
            Some(c)
        }
    });

    use rand::Rng;
    use chrono::Datelike;
    let current_year = chrono::Utc::now().year();

    let mut cards = Vec::new();
    let mut raw_list = Vec::new();

    for _ in 0..total {
        let raw_number = generate_luhn_number(&clean_bin, target_length);
        let (month, year) = match (&custom_month, &custom_year) {
            (Some(m), Some(y)) => (m.clone(), y.clone()),
            _ => {
                let m = format!("{:02}", rand::thread_rng().gen_range(1..=12));
                let y = current_year + rand::thread_rng().gen_range(1..=5);
                (m, y.to_string())
            }
        };
        let cvv = custom_cvv.clone().unwrap_or_else(|| {
            (0..cvv_length)
                .map(|_| rand::thread_rng().gen_range(0..10).to_string())
                .collect()
        });

        let formatted: String = raw_number
            .as_bytes()
            .chunks(4)
            .map(|c| String::from_utf8_lossy(c).to_string())
            .collect::<Vec<_>>()
            .join(" ");
        let pipe = format!("{}|{}|{}|{}", raw_number, month, year, cvv);

        cards.push(json!({
            "card_number": raw_number,
            "formatted": formatted,
            "month": month,
            "year": year,
            "cvv": cvv,
            "pipe": pipe,
            "network": network.name,
            "luhn_valid": is_valid_luhn(&raw_number),
        }));
        raw_list.push(pipe);
    }

    Json(json!({
        "status": true,
        "result": {
            "total": cards.len(),
            "bin_pattern": clean_input,
            "network": network.name,
            "card_length": target_length,
            "cvv_length": cvv_length,
            "cards": cards,
            "raw_list": raw_list,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })).into_response()

}

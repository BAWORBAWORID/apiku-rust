// FakeData — native conversion of api/tools/fakedata.js (random fake data generator)
// Node version used @faker-js/faker; Rust version generates equivalent random data
// with the same field structure using rand.
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const VALID_TYPES: &[&str] = &[
    "person", "company", "product", "address", "internet", "finance", "vehicle", "lorem", "date",
];

fn uuid() -> String {
    let b = rand_bytes(16);
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-8{:01x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] % 16, b[7], b[8] % 16, b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

fn rand_bytes(n: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

fn pick<'a>(list: &[&'a str]) -> &'a str {
    use rand::seq::SliceRandom;
    list.choose(&mut rand::thread_rng()).copied().unwrap_or("")
}

fn rint(lo: i64, hi: i64) -> i64 {
    use rand::Rng;
    rand::thread_rng().gen_range(lo..=hi)
}

fn rfloat(lo: f64, hi: f64) -> f64 {
    use rand::Rng;
    rand::thread_rng().gen_range(lo..hi)
}

fn words(n: usize) -> String {
    let pool = [
        "lorem",
        "ipsum",
        "dolor",
        "sit",
        "amet",
        "consectetur",
        "adipiscing",
        "elit",
        "sed",
        "do",
        "eiusmod",
        "tempor",
        "incididunt",
        "ut",
        "labore",
        "et",
        "dolore",
        "magna",
        "aliqua",
    ];
    (0..n).map(|_| pick(&pool)).collect::<Vec<_>>().join(" ")
}

fn sentence() -> String {
    format!(
        "{} {} {}.",
        words(rint(6, 12) as usize),
        words(rint(4, 8) as usize),
        words(rint(3, 6) as usize)
    )
}

fn street_address() -> String {
    format!(
        "{} {} {}",
        rint(1, 9999),
        pick(&["Jl.", "Gang", "Jalan"]),
        words(2)
    )
}

fn city() -> String {
    pick(&[
        "Jakarta",
        "Bandung",
        "Surabaya",
        "Medan",
        "Denpasar",
        "Yogyakarta",
        "Semarang",
        "Makassar",
    ])
    .to_string()
}

fn country() -> String {
    pick(&[
        "Indonesia",
        "United States",
        "Japan",
        "Germany",
        "Brazil",
        "Australia",
        "India",
    ])
    .to_string()
}

fn zip_code() -> String {
    format!("{:05}", rint(10000, 99999))
}

fn email() -> String {
    format!(
        "{}{}@{}.{}",
        words(1),
        rint(1, 999),
        pick(&["example", "test", "mail"]),
        pick(&["com", "net", "org", "id"])
    )
}

fn person() -> Value {
    json!({
        "id": uuid(),
        "name": format!("{} {}", words(1), words(1)),
        "email": email(),
        "avatar": format!("https://example.com/avatar/{}.jpg", uuid()),
        "phone": format!("+62 8{:02} {:04} {:04}", rint(10, 99), rint(1000, 9999), rint(1000, 9999)),
        "birthDate": chrono::Utc::now().to_rfc3339(),
        "gender": pick(&["male", "female"]),
        "jobTitle": format!("{} {}", pick(&["Senior", "Junior", "Lead"]), words(1)),
        "bio": sentence(),
        "address": {
            "street": street_address(),
            "city": city(),
            "state": words(1),
            "country": country(),
            "zipCode": zip_code(),
            "coordinates": {
                "latitude": rfloat(-90.0f64, 90.0),
                "longitude": rfloat(-180.0f64, 180.0),
            }
        }
    })
}

fn company() -> Value {
    json!({
        "id": uuid(),
        "name": format!("{} {} {}", words(1), words(1), pick(&["Inc", "LLC", "Ltd", "Corp", "GmbH", "S.A.", "Group", "Holdings", "Partners"])),
        "catchPhrase": sentence(),
        "buzzPhrase": words(3),
        "suffix": pick(&["Inc", "LLC", "Ltd", "Corp", "GmbH", "S.A.", "Group", "Holdings", "Partners"]),
        "address": { "street": street_address(), "city": city(), "country": country(), "zipCode": zip_code() },
        "website": format!("https://www.{}.com", words(1)),
        "email": email(),
        "phone": format!("+62 {:04} {:04}", rint(1000, 9999), rint(1000, 9999)),
        "industry": words(2),
        "employees": rint(1, 10000),
    })
}

fn product() -> Value {
    let price = rint(1000, 1000000);
    json!({
        "id": uuid(),
        "name": format!("{} {}", pick(&["Awesome", "Fantastic", "Practical", "Sleek"]), words(1)),
        "price": price.to_string(),
        "priceFormatted": format!("Rp {}", price),
        "category": words(1),
        "description": sentence(),
        "material": pick(&["Steel", "Wooden", "Concrete", "Plastic", "Rubber", "Granite"]),
        "color": pick(&["red", "blue", "green", "black", "white", "grey", "azure", "mint"]),
        "image": format!("https://example.com/product/{}.jpg", uuid()),
        "inStock": rint(0, 1) == 1,
        "rating": (rfloat(1.0f64, 5.1) * 10.0).round() / 10.0,
        "createdAt": chrono::Utc::now().to_rfc3339(),
    })
}

fn address() -> Value {
    json!({
        "id": uuid(),
        "street": street_address(),
        "city": city(),
        "state": words(1),
        "country": country(),
        "zipCode": zip_code(),
        "coordinates": { "latitude": rfloat(-90.0f64, 90.0), "longitude": rfloat(-180.0f64, 180.0) },
        "timezone": pick(&["Asia/Jakarta", "Asia/Tokyo", "America/New_York", "Europe/Berlin"]),
        "buildingNumber": rint(1, 999).to_string(),
        "secondaryAddress": format!("Suite {}", rint(1, 999)),
    })
}

fn internet() -> Value {
    json!({
        "id": uuid(),
        "email": email(),
        "username": format!("{}{}", words(1), rint(1, 999)),
        "displayName": words(2),
        "password": words(rint(2, 4) as usize),
        "avatar": format!("https://example.com/avatar/{}.jpg", uuid()),
        "url": format!("https://{}.com", words(1)),
        "ip": format!("{}.{}.{}.{}", rint(1, 254), rint(1, 254), rint(1, 254), rint(1, 254)),
        "ipv6": "2001:db8::1",
        "macAddress": format!("{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}", rint(0, 255), rint(0, 255), rint(0, 255), rint(0, 255), rint(0, 255), rint(0, 255)),
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "emoji": pick(&["😀", "🚀", "🌟", "🎉", "💻"]),
    })
}

fn finance() -> Value {
    json!({
        "id": uuid(),
        "accountNumber": format!("{:09}", rint(1, 999999999)),
        "accountName": format!("{} {}", words(1), words(1)),
        "amount": rint(1000, 10000000).to_string(),
        "currency": pick(&["USD", "EUR", "IDR", "JPY", "GBP"]),
        "currencyName": pick(&["US Dollar", "Euro", "Indonesian Rupiah", "Japanese Yen", "Pound Sterling"]),
        "creditCardNumber": format!("4{:015}", rint(1, 999999999999999)),
        "creditCardIssuer": pick(&["visa", "mastercard", "amex", "discover"]),
        "pin": format!("{:04}", rint(0, 9999)),
        "routingNumber": format!("{:09}", rint(1, 999999999)),
        "bitcoinAddress": format!("1{}", words(rint(4, 6) as usize)),
        "ethereumAddress": format!("0x{}", uuid().replace('-', "")),
        "transactionType": pick(&["deposit", "withdrawal", "payment", "invoice"]),
    })
}

fn vehicle() -> Value {
    json!({
        "id": uuid(),
        "manufacturer": pick(&["Toyota", "Honda", "Suzuki", "Mitsubishi", "Daihatsu", "BMW", "Yamaha"]),
        "model": words(1),
        "type": pick(&["Sedan", "SUV", "Hatchback", "MPV", "Coupe"]),
        "fuel": pick(&["Gasoline", "Diesel", "Electric", "Hybrid"]),
        "color": pick(&["red", "blue", "black", "silver", "white"]),
        "vin": uuid().replace('-', "").to_uppercase(),
        "licensePlate": format!("{} {} {}", pick(&["B", "D", "L", "F"]), rint(1000, 9999), words(1).to_uppercase()),
        "year": rint(1996, 2026),
        "mileage": rint(0, 300000),
        "price": rint(50000000, 1000000000).to_string(),
    })
}

fn lorem() -> Value {
    json!({
        "id": uuid(),
        "word": words(1),
        "words": words(rint(3, 10) as usize),
        "sentence": sentence(),
        "sentences": (0..rint(2, 5)).map(|_| sentence()).collect::<Vec<_>>().join(" "),
        "paragraph": (0..rint(3, 6)).map(|_| sentence()).collect::<Vec<_>>().join(" "),
        "paragraphs": (0..rint(2, 5)).map(|_| (0..rint(3, 6)).map(|_| sentence()).collect::<Vec<_>>().join(" ")).collect::<Vec<_>>().join("\n\n"),
        "slug": words(3).replace(' ', "-"),
        "text": (0..rint(2, 4)).map(|_| sentence()).collect::<Vec<_>>().join(" "),
    })
}

fn date_entry() -> Value {
    let now = chrono::Utc::now().timestamp_millis();
    json!({
        "id": uuid(),
        "past": chrono::DateTime::from_timestamp_millis(now - rint(1, 1000000000) * 1000).map(|d| d.to_rfc3339()),
        "future": chrono::DateTime::from_timestamp_millis(now + rint(1, 1000000000) * 1000).map(|d| d.to_rfc3339()),
        "recent": chrono::DateTime::from_timestamp_millis(now - rint(1, 86400) * 1000).map(|d| d.to_rfc3339()),
        "soon": chrono::DateTime::from_timestamp_millis(now + rint(1, 86400) * 1000).map(|d| d.to_rfc3339()),
        "month": pick(&["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]),
        "weekday": pick(&["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
        "birthdate": chrono::DateTime::from_timestamp_millis(now - rint(18, 65) * 365 * 86400 * 1000).map(|d| d.to_rfc3339()),
        "iso": chrono::DateTime::from_timestamp_millis(now + rint(-1000000, 1000000) * 1000).map(|d| d.to_rfc3339()),
        "timestamp": chrono::DateTime::from_timestamp_millis(now + rint(-1000000, 1000000) * 1000).map(|d| d.timestamp_millis()).unwrap_or(0),
    })
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

    let type_param = match get("type") {
        Some(t) => t,
        None => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'type' is required",
                "availableTypes": VALID_TYPES,
            })).into_response();
        }
    };

    if !VALID_TYPES.contains(&type_param.as_str()) {
        return Json(json!({
            "status": false,
            "message": format!("Invalid type '{}'", type_param),
            "availableTypes": VALID_TYPES,
        })).into_response();
    }

    let count_num: i64 = get("count").and_then(|c| c.parse().ok()).unwrap_or(1);
    if !(1..=1000).contains(&count_num) {
        return Json(json!({
            "status": false,
            "message": "Count must be a number between 1 and 1000"
        })).into_response();
    }

    let locale = get("locale").unwrap_or_else(|| "en".to_string());
    let seed = get("seed");

    use rand::RngCore;
    let data: Vec<Value> = (0..count_num)
        .map(|_| match type_param.as_str() {
            "person" => person(),
            "company" => company(),
            "product" => product(),
            "address" => address(),
            "internet" => internet(),
            "finance" => finance(),
            "vehicle" => vehicle(),
            "lorem" => lorem(),
            "date" => date_entry(),
            _ => Value::Null,
        })
        .collect();

    Json(json!({
        "status": true,
        "result": {
            "type": type_param,
            "count": data.len(),
            "locale": locale,
            "seed": seed,
            "generated_at": chrono::Utc::now().to_rfc3339(),
            "data": data,
        }
    })).into_response()

}

// Tokogame shared helpers — extracted from api/topup/{cek,dana,ff,ml}.js
use hmac::{Hmac, Mac};
use rand::Rng;
use serde_json::{json, Value};
use sha2::Sha256;

pub const TOKOGAKE_BASE: &str = "https://api.tokogame.com/core/v1";

fn uuid_v4() -> String {
    let mut rng = rand::thread_rng();
    let b: [u8; 16] = rng.gen();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-4{:01x}{:02x}-8{:01x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6] & 0x0f, b[7],
        b[8] & 0x0f, b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

pub fn make_headers() -> Vec<(String, String)> {
    let request_id = uuid_v4();
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(b"tokogame.com").expect("hmac key");
    mac.update(request_id.as_bytes());
    let secret_id = hex::encode(mac.finalize().into_bytes());
    let app_instance_id = uuid_v4().replace('-', "");
    vec![
        ("Accept".into(), "application/json, text/plain, */*".into()),
        ("X-Language".into(), "ID".into()),
        ("X-Region".into(), "ID".into()),
        ("X-Currency".into(), "IDR".into()),
        ("X-Request-Id".into(), request_id),
        ("X-Secret-Id".into(), secret_id),
        ("X-App-Instance-Id".into(), app_instance_id),
        ("Origin".into(), "https://www.tokogame.com".into()),
        ("Referer".into(), "https://www.tokogame.com/".into()),
    ]
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .build().unwrap_or_default()
}

/// Create a QRIS order on Tokogame. Returns the raw upstream JSON.
pub async fn create_order(product_id: &str, package_code: &str, questionnaire: Value) -> Result<(reqwest::StatusCode, Value), String> {
    let body = json!({
        "contact": { "emailAddress": "", "phoneNumber": "+628****1614" },
        "paymentMethod": "QRIS_ID_BNC",
        "productId": product_id,
        "productPackageCode": package_code,
        "questionnaireAnswers": questionnaire
    });
    let mut req = client().post(format!("{}/orders/create-order", TOKOGAKE_BASE));
    for (k, v) in make_headers() {
        if k != "Accept" { req = req.header(&k, &v); }
        else { req = req.header(&k, &v); }
    }
    let res = req.json(&body).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    Ok((status, data))
}

pub fn check_questionnaire(regex: &str) -> Value {
    json!([{
        "questionnaire": {
            "code": "userid",
            "inputType": "NUMBER",
            "regexValidation": {
                "regex": regex,
                "errorMessages": [
                    { "language": "ID", "title": "Format Nomor HP Salah", "body": "Format nomor HP salah. Mohon masukkan nomor yang dimulai dengan 08..." }
                ]
            },
            "translations": [ { "language": "ID", "question": "Masukkan No. HP", "description": "Nomor HP", "choices": [] } ]
        },
        "answer": ""
    }])
}

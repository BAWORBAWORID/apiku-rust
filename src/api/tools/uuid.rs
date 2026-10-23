use axum::{response::IntoResponse, Json};
use rand::Rng;
use serde_json::json;

fn gen_uuid_v4() -> String {
    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; 16];
    rng.fill(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
    let hex = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

pub async fn handler() -> impl IntoResponse {
    let id = gen_uuid_v4();

    Json(json!({
        "status": true,
        "result": {
            "uuid": id,
            "version": 4
        },
        "attribution": "@zyvorapi"
    })).into_response()
}

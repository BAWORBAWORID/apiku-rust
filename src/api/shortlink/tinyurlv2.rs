// TinyURL File Shortener — native conversion of api/shortlink/tinyurlv2.js
// multipart upload -> Cognito unauthenticated identity creds -> SigV4 S3 PUT ->
// presigned GET (24h) -> TinyURL shorten.
use axum::{
    extract::Multipart,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::{Digest, Sha256};

const REGION: &str = "us-east-1";
const IDENTITY_POOL_ID: &str = "us-east-1:3b2f9a16-a4b2-4045-9255-453415bad9b6";
const S3_BUCKET: &str = "amplify-mindbytebackend-j-mindbyteappbucket40d036a-nhen0zx97aq3";

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("hmac key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

struct Cred {
    access_key: String,
    secret_key: String,
    session_token: String,
}

async fn get_credentials() -> Result<Cred, String> {
    let c = reqwest::Client::new();
    // GetId
    let id_resp: serde_json::Value = c
        .post(format!("https://cognito-identity.{}.amazonaws.com/", REGION))
                    .header("X-Amz-Target", "AWSCognitoIdentityService.GetId")
                    .header("Content-Type", "application/x-amz-json-1.1")
        .body(json!({ "IdentityPoolId": IDENTITY_POOL_ID }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let identity_id = id_resp
        .get("IdentityId")
        .and_then(|v| v.as_str())
        .ok_or("Cognito GetId failed")?
        .to_string();
    // GetCredentialsForIdentity
    let cred_resp: serde_json::Value = c
        .post(format!("https://cognito-identity.{}.amazonaws.com/", REGION))
                    .header("X-Amz-Target", "AWSCognitoIdentityService.GetCredentialsForIdentity")
                    .header("Content-Type", "application/x-amz-json-1.1")
        .body(json!({ "IdentityId": identity_id }).to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let creds = cred_resp
        .pointer("/Credentials")
        .ok_or("Cognito GetCredentialsForIdentity failed")?;
    Ok(Cred {
        access_key: creds.get("AccessKeyId").and_then(|v| v.as_str()).unwrap_or("").into(),
        secret_key: creds.get("SecretKey").and_then(|v| v.as_str()).unwrap_or("").into(),
        session_token: creds.get("SessionToken").and_then(|v| v.as_str()).unwrap_or("").into(),
    })
}

async fn s3_put(cred: &Cred, key: &str, body: Vec<u8>) -> Result<(), String> {
    let host = format!("{}.s3.amazonaws.com", S3_BUCKET);
    let now = chrono::Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let payload_hash = sha256_hex(&body);

    let canonical_request = format!(
        "PUT\n/{}\n\nhost:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\nx-amz-security-token:{}\n\nhost;x-amz-content-sha256;x-amz-date;x-amz-security-token\n{}",
        key, host, payload_hash, amz_date, cred.session_token, payload_hash
    );
    let scope = format!("{}/{}/s3/aws4_request", date_stamp, REGION);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        scope,
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac_sha256(format!("AWS4{}", cred.secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, REGION.as_bytes());
    let k_service = hmac_sha256(&k_region, b"s3");
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature={}",
        cred.access_key, scope, signature
    );

    let c = reqwest::Client::new();
    let resp = c
        .put(format!("https://{}/{}", host, key))
        .header("Host", &host)
        .header("x-amz-content-sha256", &payload_hash)
        .header("x-amz-date", &amz_date)
        .header("x-amz-security-token", &cred.session_token)
        .header("Authorization", authorization)
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("S3 upload failed (HTTP {})", resp.status()));
    }
    Ok(())
}

fn presigned_get(cred: &Cred, key: &str, expires: u64) -> String {
    let host = format!("{}.s3.amazonaws.com", S3_BUCKET);
    let now = chrono::Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let scope = format!("{}/{}/s3/aws4_request", date_stamp, REGION);
    let canonical_request = format!(
        "GET\n/{}\nX-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}%2F{}&X-Amz-Date={}&X-Amz-Expires={}&X-Amz-SignedHeaders=host\nhost:{}\n\nhost\nUNSIGNED-PAYLOAD",
        key,
        cred.access_key,
        scope.replace('/', "%2F"),
        amz_date,
        expires,
        host
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        scope,
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac_sha256(format!("AWS4{}", cred.secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, REGION.as_bytes());
    let k_service = hmac_sha256(&k_region, b"s3");
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    format!(
        "https://{}/{}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}%2F{}&X-Amz-Date={}&X-Amz-Expires={}&X-Amz-SignedHeaders=host&X-Amz-Signature={}",
        host, key, cred.access_key, scope.replace('/', "%2F"), amz_date, expires, signature
    )
}

async fn tinyurl_shorten(url: &str) -> Result<String, String> {
    let c = reqwest::Client::new();
    let text = c
        .get(format!("https://tinyurl.com/api-create.php?url={}", urlencoding::encode(url)))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let t = text.trim();
    if t.to_lowercase().starts_with("error") {
        return Err("Gagal memperpendek link dari layanan TinyURL".into());
    }
    Ok(t.to_string())
}

pub async fn handler(mut multipart: Multipart) -> Response {
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut filename = String::new();
    let mut mimetype = "application/octet-stream".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            filename = field.file_name().unwrap_or("upload").to_string();
            mimetype = field.content_type().unwrap_or("application/octet-stream").to_string();
            match field.bytes().await {
                Ok(b) => file_bytes = Some(b.to_vec()),
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, Json(json!({ "status": false, "message": e.to_string() })))
                        .into_response()
                }
            }
            break;
        }
    }

    let Some(bytes) = file_bytes else {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter file wajib (multipart/form-data, field: file)",
        })))
        .into_response();
    };
    if bytes.len() > 50 * 1024 * 1024 {
        return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({
            "status": false,
            "message": "Ukuran file terlalu besar (maksimal 50MB)",
        })))
        .into_response();
    }

    match async {
        let cred = get_credentials().await?;
        let size = bytes.len();
        let s3_key = format!("public/uploads/{}-{}", chrono::Utc::now().timestamp_millis(), filename);
        s3_put(&cred, &s3_key, bytes).await?;
        let cdn_url = presigned_get(&cred, &s3_key, 86_400);
        let short = tinyurl_shorten(&cdn_url).await?;
        Ok::<_, String>(json!({
            "status": true,
            "result": short,
            "cdnUrl": cdn_url,
            "filename": filename,
            "size": size,
            "mimetype": mimetype,
        }))
    }
    .await
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "status": false, "message": e })),
        )
            .into_response(),
    }
}

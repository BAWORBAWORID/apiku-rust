use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use regex::Regex;
use rand::Rng;
use std::sync::LazyLock;

static OOB_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:[?&]oobCode=|oobCode=)([a-zA-Z0-9_-]+)"#).unwrap()
});

pub const AM_API_KEY: &str = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
pub const AM_PRODUCT_ID: &str = "am.full.sub.annual.19q4";
pub const AM_TOKEN: &str = "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
pub const AM_SKU_TYPE: &str = "subs";
pub const AM_FIREBASE_INSTANCE_ID_TOKEN: &str = "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";

#[derive(Debug, Clone)]
pub struct AlightMotionService {
    client: reqwest::Client,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AmResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codeorder: Option<String>,
}

impl Default for AlightMotionService {
    fn default() -> Self {
        Self::new()
    }
}

impl AlightMotionService {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                
                .build()
                .unwrap_or_default(),
        }
    }

    fn default_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert("X-Android-Package", HeaderValue::from_static("com.alightcreative.motion"));
        headers.insert("X-Android-Cert", HeaderValue::from_static("ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8"));
        headers.insert(USER_AGENT, HeaderValue::from_static("Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)"));
        headers
    }

    pub fn generate_code_order(&self) -> String {
        let mut rng = rand::thread_rng();
        let r = |len: usize, rng: &mut rand::rngs::ThreadRng| -> String {
            (0..len).map(|_| rng.gen_range(0..10).to_string()).collect()
        };
        format!("GPA.{}.{}.{}.{}", r(4, &mut rng), r(4, &mut rng), r(4, &mut rng), r(5, &mut rng))
    }

    pub fn extract_oob_code(&self, full_url: &str) -> Option<String> {
        let clean_url = full_url.replace("&amp;", "&");
        let decoded = urlencoding::decode(&clean_url).unwrap_or_else(|_| clean_url.clone().into());

        if let Ok(parsed) = reqwest::Url::parse(&decoded) {
            if let Some(code) = parsed.query_pairs().find(|(k, _)| k == "oobCode").map(|(_, v)| v.to_string()) {
                let sanitized: String = code.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect();
                if !sanitized.is_empty() {
                    return Some(sanitized);
                }
            }
            // Nested query link/q/url
            for param in &["link", "q", "url"] {
                if let Some(nested) = parsed.query_pairs().find(|(k, _)| k == *param).map(|(_, v)| v.to_string()) {
                    if let Ok(inner) = reqwest::Url::parse(&nested) {
                        if let Some(code) = inner.query_pairs().find(|(k, _)| k == "oobCode").map(|(_, v)| v.to_string()) {
                            let sanitized: String = code.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect();
                            if !sanitized.is_empty() {
                                return Some(sanitized);
                            }
                        }
                    }
                }
            }
        }

        if let Some(caps) = OOB_RE.captures(&decoded) {
            if let Some(m) = caps.get(1) {
                return Some(m.as_str().to_string());
            }
        }
        None
    }

    pub async fn send_magic_link(&self, email: &str) -> AmResult {
        let url_auth = format!("https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri?key={}", AM_API_KEY);
        let body_auth = json!({
            "identifier": email,
            "continueUri": "http://localhost"
        });

        if let Err(e) = self.client.post(&url_auth)
            .headers(Self::default_headers())
            .json(&body_auth)
            .send()
            .await
        {
            return AmResult {
                success: false,
                message: None,
                error: Some(e.to_string()),
                id_token: None,
                user: None,
                data: None,
                codeorder: None,
            };
        }

        let url_oob = format!("https://www.googleapis.com/identitytoolkit/v3/relyingparty/getOobConfirmationCode?key={}", AM_API_KEY);
        let body_oob = json!({
            "requestType": 6,
            "email": email,
            "androidInstallApp": true,
            "canHandleCodeInApp": true,
            "continueUrl": "https://alightcreative.com?ui_sid=0366624874&ui_sd=0",
            "iosBundleId": "com.alightcreative.motion",
            "androidPackageName": "com.alightcreative.motion",
            "androidMinimumVersion": "585",
            "clientType": "CLIENT_TYPE_ANDROID"
        });

        match self.client.post(&url_oob)
            .headers(Self::default_headers())
            .json(&body_oob)
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => AmResult {
                success: true,
                message: Some("Link berhasil dikirim.".to_string()),
                error: None,
                id_token: None,
                user: None,
                data: None,
                codeorder: None,
            },
            Ok(res) => {
                let err_text = res.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                AmResult {
                    success: false,
                    message: None,
                    error: Some(err_text),
                    id_token: None,
                    user: None,
                    data: None,
                    codeorder: None,
                }
            }
            Err(e) => AmResult {
                success: false,
                message: None,
                error: Some(e.to_string()),
                id_token: None,
                user: None,
                data: None,
                codeorder: None,
            },
        }
    }

    pub async fn verify_and_fetch_profile(&self, email: &str, raw_link: &str) -> AmResult {
        let oob_code = match self.extract_oob_code(raw_link) {
            Some(c) => c,
            None => {
                return AmResult {
                    success: false,
                    message: None,
                    error: Some("Gagal mengekstrak oobCode.".to_string()),
                    id_token: None,
                    user: None,
                    data: None,
                    codeorder: None,
                }
            }
        };

        let signin_url = format!("https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key={}", AM_API_KEY);
        let signin_body = json!({
            "email": email,
            "oobCode": oob_code,
            "clientType": "CLIENT_TYPE_ANDROID"
        });

        let signin_res = match self.client.post(&signin_url)
            .headers(Self::default_headers())
            .json(&signin_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return AmResult {
                success: false,
                message: None,
                error: Some(e.to_string()),
                id_token: None,
                user: None,
                data: None,
                codeorder: None,
            },
        };

        let signin_val: Value = match signin_res.json().await {
            Ok(v) => v,
            Err(e) => return AmResult {
                success: false,
                message: None,
                error: Some(e.to_string()),
                id_token: None,
                user: None,
                data: None,
                codeorder: None,
            },
        };

        let id_token = match signin_val.get("idToken").and_then(|t| t.as_str()) {
            Some(t) => t.to_string(),
            None => return AmResult {
                success: false,
                message: None,
                error: Some(signin_val.to_string()),
                id_token: None,
                user: None,
                data: None,
                codeorder: None,
            },
        };

        let account_url = format!("https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key={}", AM_API_KEY);
        let account_res = self.client.post(&account_url)
            .headers(Self::default_headers())
            .json(&json!({ "idToken": id_token }))
            .send()
            .await;

        let account_val: Value = match account_res {
            Ok(r) => r.json().await.unwrap_or(json!({})),
            Err(_) => json!({}),
        };

        let user = account_val.get("users").and_then(|u| u.get(0)).cloned();

        AmResult {
            success: true,
            message: None,
            error: None,
            id_token: Some(id_token),
            user,
            data: None,
            codeorder: None,
        }
    }

    pub async fn apply_premium(&self, id_token: &str, custom_code_order: Option<String>) -> AmResult {
        let codeorder = custom_code_order.unwrap_or_else(|| self.generate_code_order());
        let url = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";

        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_str(&format!("Bearer {}", id_token)).unwrap_or_else(|_| HeaderValue::from_static("")));
        headers.insert("firebase-instance-id-token", HeaderValue::from_static(AM_FIREBASE_INSTANCE_ID_TOKEN));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
        headers.insert(USER_AGENT, HeaderValue::from_static("okhttp/3.12.1"));

        let body = json!({
            "data": {
                "productId": AM_PRODUCT_ID,
                "token": AM_TOKEN,
                "skuType": AM_SKU_TYPE,
                "orderId": codeorder
            }
        });

        match self.client.post(url).headers(headers).json(&body).send().await {
            Ok(res) if res.status().is_success() => {
                let data: Value = res.json().await.unwrap_or(json!({}));
                AmResult {
                    success: true,
                    message: None,
                    error: None,
                    id_token: None,
                    user: None,
                    data: Some(data),
                    codeorder: Some(codeorder),
                }
            }
            Ok(res) => {
                let err_text = res.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                AmResult {
                    success: false,
                    message: None,
                    error: Some(err_text),
                    id_token: None,
                    user: None,
                    data: None,
                    codeorder: Some(codeorder),
                }
            }
            Err(e) => AmResult {
                success: false,
                message: None,
                error: Some(e.to_string()),
                id_token: None,
                user: None,
                data: None,
                codeorder: Some(codeorder),
            },
        }
    }
}

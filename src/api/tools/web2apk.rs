// Web2Apk — native conversion of api/tools/web2apk.js (Code-V engine)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const BASE_URL: &str = "https://code-v-compiler-sr.vercel.app";

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
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

    let url = match get("url") {
        Some(u) if !u.is_empty() => u,
        _ => {
            return Json(json!({"status": false, "message": "Parameter 'url' wajib diisi"}))
                .into_response()
        }
    };
    let app_name = match get("appName").or_else(|| get("appname")) {
        Some(a) if !a.is_empty() => a,
        _ => {
            return Json(json!({"status": false, "message": "Parameter 'appName' wajib diisi"}))
                .into_response()
        }
    };
    let package_name = match get("packageName").or_else(|| get("package")) {
        Some(p) if !p.is_empty() => p,
        _ => return Json(
            json!({"status": false, "message": "Parameter 'packageName' (package) wajib diisi"}),
        )
        .into_response(),
    };
    let version_name = match get("versionName").or_else(|| get("version")) {
        Some(v) if !v.is_empty() => v,
        _ => return Json(
            json!({"status": false, "message": "Parameter 'versionName' (version) wajib diisi"}),
        )
        .into_response(),
    };
    let version_code = get("versionCode").or_else(|| get("versioncode"));
    if version_code
        .as_deref()
        .map(|v| v.is_empty())
        .unwrap_or(true)
    {
        return Json(json!({"status": false, "message": "Parameter 'versionCode' wajib diisi"}))
            .into_response();
    }
    let version_code_num: u64 = version_code
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(1);

    let payload = json!({
        "url": url,
        "appName": app_name,
        "packageName": package_name,
        "versionName": version_name,
        "versionCode": version_code_num,
        "options": {
            "splash": true,
            "splashType": "default",
            "splashText": app_name,
            "splashBg": "#0B0D10",
            "splashFg": "#3B82F6",
            "splashMs": 2000,
            "orientation": "auto",
            "js": true,
            "zoom": false,
            "permissions": ["INTERNET", "WAKE_LOCK"],
        }
    });

    let client = &state.client;
    let create_res =
        match client
            .post(format!("{}/api/build", BASE_URL))
                        .header("Content-Type", "application/json")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Json(
                json!({"status": false, "message": format!("Gagal mengirim build request: {}", e)}),
            )
            .into_response(),
        };

    if !create_res.status().is_success() {
        let status = create_res.status().as_u16();
        let err_text = create_res.text().await.unwrap_or_default();
        return Json(json!({"status": false, "message": format!("Gagal mengirim build request: {} {}", status, err_text)})).into_response();
    }

    let create_data: Value = match create_res.json().await {
        Ok(d) => d,
        Err(e) => return Json(json!({"status": false, "message": e.to_string()})).into_response(),
    };
    let build_id = match create_data
        .get("build_id")
        .and_then(|b| b.as_str())
        .map(|s| s.to_string())
    {
        Some(b) if !b.is_empty() => b,
        _ => {
            return Json(json!({
                "status": false,
                "message": format!("Respon server tidak memiliki build_id: {}", create_data)
            }))
            .into_response()
        }
    };

    // Poll build status — max 60 attempts x 2s
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let poll = client
            .get(format!("{}/api/build/{}", BASE_URL, build_id))
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .send()
            .await;
        let poll_data: Value = match poll {
            Ok(r) if r.status().is_success() => match r.json().await {
                Ok(d) => d,
                Err(_) => continue,
            },
            _ => continue,
        };

        let status = poll_data
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if status == "ready" || status == "completed" {
            let download_path = poll_data
                .get("download_url")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("/cdn/{}.apk", build_id));
            let download_url = if download_path.starts_with("http") {
                download_path
            } else {
                format!("{}{}", BASE_URL, download_path)
            };
            return Json(json!({
                "status": true,
                "message": "APK berhasil dibuat",
                "result": {
                    "buildId": build_id,
                    "appName": app_name,
                    "packageName": package_name,
                    "versionName": version_name,
                    "versionCode": version_code_num,
                    "targetUrl": url,
                    "fileSize": poll_data.get("file_size"),
                    "downloadUrl": download_url,
                }
            }))
            .into_response();
        }
        if status == "failed" || status == "error" {
            let err = poll_data
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("Unknown error");
            return Json(json!({"status": false, "message": format!("Build gagal: {}", err)}))
                .into_response();
        }
    }

    Json(json!({"status": false, "message": "Build timeout: Proses compile memakan waktu lebih dari 2 menit."})).into_response()
}

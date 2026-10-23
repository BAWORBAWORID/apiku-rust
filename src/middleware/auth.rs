use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use crate::state::AppState;

pub async fn require_api_key(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    let path = req.uri().path();
    let status_req = state.config.endpoints_status.get(path);

    if let Some(status) = status_req {
        if status == "offline" {
            let body = Json(json!({
                "status": false,
                "message": "This endpoint is currently offline"
            }));
            return Err((StatusCode::SERVICE_UNAVAILABLE, body).into_response());
        }
        if status == "maintenance" {
            let body = Json(json!({
                "status": false,
                "message": "This endpoint is under maintenance"
            }));
            return Err((StatusCode::SERVICE_UNAVAILABLE, body).into_response());
        }
        if status == "premium" || status == "vip" {
            let key_opt = req.headers().get("x-api-key")
                .and_then(|v| v.to_str().ok())
                .or_else(|| {
                    req.uri().query().and_then(|q| {
                        q.split('&').find_map(|pair| {
                            let mut parts = pair.split('=');
                            if parts.next()? == "apikey" {
                                parts.next()
                            } else {
                                None
                            }
                        })
                    })
                });

            let api_key = match key_opt {
                Some(k) if !k.is_empty() => k,
                _ => {
                    let body = Json(json!({
                        "success": false,
                        "error": "API key required",
                        "message": format!("This endpoint requires a {} API key. Get one at /admin/dashboard", status)
                    }));
                    return Err((StatusCode::UNAUTHORIZED, body).into_response());
                }
            };

            let valid_key = state.api_keys.get(api_key);
            match valid_key {
                Some(k) if k.enabled => {
                    if status == "vip" && k.role.as_deref() != Some("vip") {
                        let body = Json(json!({
                            "success": false,
                            "error": "VIP access required",
                            "message": "This endpoint requires a VIP API key."
                        }));
                        return Err((StatusCode::FORBIDDEN, body).into_response());
                    }
                }
                _ => {
                    let body = Json(json!({
                        "success": false,
                        "error": "Invalid API key",
                        "message": "The provided API key is invalid or disabled"
                    }));
                    return Err((StatusCode::FORBIDDEN, body).into_response());
                }
            }
        }
    }

    Ok(next.run(req).await)
}

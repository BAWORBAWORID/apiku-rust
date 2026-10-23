use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use crate::state::AppState;


/// Endpoint yang fundamentally butuh browser engine (Puppeteer) — dipaksa ke Node backend.
pub const BROWSER_PREFIXES: &[&str] = &[
    "/api/ephoto/",
    "/api/textpro/",
    "/api/photooxy/",
    "/api/maker/",
    "/api/canvas/",
    "/api/tools/ssweb",
    "/api/tools/html2img",
    "/api/tools/ocr",
    "/api/tools/cloneweb",
    "/api/tools/ilovepdf",
    "/api/tools/dummylabs",
    "/api/tools/aidetect",
    "/api/tools/qr2text",
    "/api/tools/text2qr",
    "/api/solve/cloudflare",
    "/api/solve/turnstile",
    "/api/solve/recaptcha-v2",
    "/api/solve/uam",
    "/api/bypass/ouo",
    "/api/bypass/bypasslink",
    "/api/bypass/wellbypass",
    "/api/games/akinator",
    "/api/search/tiktok-search",
    "/api/stalker/instagram",
    "/api/tempmail/tmailor",
    "/api/imageai/dezgo",
    "/api/imageai/quil-image",
    "/api/downloader/lk21",
    "/api/downloader/spotify",
    "/api/downloader/youtubev1",
    "/api/downloader/youtube-analytic",
];

pub fn is_browser_path(path: &str) -> bool {
    BROWSER_PREFIXES.iter().any(|p| path.starts_with(p))
}

pub async fn fallback_proxy(
    State(state): State<AppState>,
    req: Request,
) -> Result<Response, (StatusCode, String)> {
    proxy_to_node(state, req).await
}

pub async fn fallback_proxy_internal(req: Request) -> axum::response::Response {
    let node = std::env::var("NODE_BACKEND_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    let state = AppState::new(crate::utils::config::AppConfig::default());
    let mut state = state;
    state.node_backend_url = node;
    match proxy_to_node(state, req).await {
        Ok(r) => r,
        Err((st, msg)) => (st, msg).into_response(),
    }
}

async fn proxy_to_node(
    state: AppState,
    req: Request,
) -> Result<Response, (StatusCode, String)> {
    let path_and_query = req.uri().path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(req.uri().path());

    let target_url = format!("{}{}", state.node_backend_url, path_and_query);

    let method = req.method().clone();
    let headers = req.headers().clone();

    let body_bytes = match axum::body::to_bytes(req.into_body(), 50 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => return Err((StatusCode::BAD_REQUEST, format!("Failed reading request body: {}", e))),
    };

    let mut client_req = state.client.request(method, &target_url);

    for (name, val) in headers.iter() {
        if name != "host" && name != "content-length" {
            client_req = client_req.header(name.as_str(), val.as_bytes());
        }
    }

    if !body_bytes.is_empty() {
        client_req = client_req.body(body_bytes);
    }

    match client_req.send().await {
        Ok(res) => {
            let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let mut response_builder = Response::builder().status(status);

            for (name, val) in res.headers().iter() {
                if name != "transfer-encoding" && name != "content-encoding" {
                    response_builder = response_builder.header(name.as_str(), val.as_bytes());
                }
            }

            let res_bytes = res.bytes().await.unwrap_or_default();
            Ok(response_builder.body(Body::from(res_bytes)).unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response".to_string()).into_response()
            }))
        }
        Err(e) => {
            Err((StatusCode::BAD_GATEWAY, format!("Node backend proxy error: {}", e)))
        }
    }
}

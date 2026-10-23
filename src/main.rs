mod api;
mod middleware;
mod models;
mod routes;
mod state;
mod utils;

use axum::{
    middleware as axum_middleware,
    routing::get,
    Router,
};
use state::AppState;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

async fn browser_passthrough(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    if routes::proxy::is_browser_path(req.uri().path()) {
        return routes::proxy::fallback_proxy_internal(req).await;
    }
    next.run(req).await
}

#[tokio::main]
async fn main() {
    utils::logger::init_logger();
    let _ = dotenvy::dotenv();

    info!("🚀 Memulai APIKU Rust Engine (Arsitektur Selaras 1:1 dengan Node.js)...");

    let mut config = utils::config::load_config();
    let discovered_routes = routes::openapi::discover_active_routes();

    // Auto-sync configuration.json dengan endpoint baru di src/api/*
    let route_refs: Vec<&str> = discovered_routes.iter().map(|s| s.as_str()).collect();
    let updated = utils::config::sync_endpoints_status(&mut config, &route_refs);
    if updated {
        info!("🔄 configuration.json berhasil diperbarui secara otomatis dengan endpoint baru!");
    }

    info!(
        "Konfigurasi: {} v{} ({} endpoint Rust terdeteksi)",
        config.name.as_deref().unwrap_or("Apiku"),
        config.version.as_deref().unwrap_or("2.1.2"),
        discovered_routes.len()
    );

    let state = AppState::new(config);

    // Sub-router /api (Semua endpoint di src/api/*)
    let api_router = api::routes()
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            middleware::auth::require_api_key,
        ))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            middleware::response_formatter::format_response,
        ));

    let public_router = routes::public::routes();

    let app = Router::new()
        // 1. Health check, Stats & Native OpenAPI Docs
        .route("/health", get(routes::health::health_check))
        .route("/openapi.json", get(routes::openapi::handler))
        .route("/api/stats", get(routes::stats::api_stats))
        .route("/status", get(routes::stats::status_handler))
        .route("/configuration", get(routes::stats::configuration_handler))

        // Admin Panel & Session Management (Persistent in data/sessions)
        .route("/admin", get(routes::admin::login_page))
        .route("/admin/login", get(routes::admin::login_page))
        .route("/admin/dashboard", get(routes::admin::dashboard_page))
        .route("/admin/api/me", get(routes::admin::admin_me))
        .route("/admin/api/logout", axum::routing::post(routes::admin::admin_logout))
        .route("/admin/api/endpoints", get(routes::stats::admin_endpoints))

        // 2. Semua endpoint di /api (struktur 1:1 seperti Node.js)
        .nest("/api", api_router)
        .layer(axum::middleware::from_fn(browser_passthrough))

        // 3. Public static assets & HTML frontend (docs, landing, stats, dll)
        .merge(public_router)

        // 4. Fallback transparent proxy (teruskan endpoint yang belum dimigrasi ke Node backend)
        .fallback(routes::proxy::fallback_proxy)

        // Middlewares
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3005);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("⚡ Rust Server aktif di http://{}", addr);
    info!("📁 Struktur folder src/api/* selaras 100% dengan Node.js api/*");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("Gagal bind ke port {}: {}", port, e));

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    println!("Sinyal shutdown diterima, mematikan server Rust dengan aman...");
}

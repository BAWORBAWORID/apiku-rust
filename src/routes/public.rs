use axum::Router;
use std::path::{Path, PathBuf};
use tower_http::services::{ServeDir, ServeFile};
use crate::state::AppState;

pub fn find_public_dir() -> PathBuf {
    let candidates = [
        "./public",
        "../public",
        "/home/agentuser/apiku/public",
        "/home/agentuser/apiku/apiku-rs/public",
    ];

    for candidate in &candidates {
        let p = Path::new(candidate);
        if p.exists() && p.is_dir() {
            return p.to_path_buf();
        }
    }

    PathBuf::from("public")
}

pub fn routes() -> Router<AppState> {
    let pub_dir = find_public_dir();

    // Pages
    let index_file = pub_dir.join("index.html");
    let docs_file = pub_dir.join("docs.html");
    let stats_file = pub_dir.join("stats.html");
    let report_file = pub_dir.join("request-report.html");
    let support_file = pub_dir.join("support.html");
    let changelog_file = pub_dir.join("changelog.html");
    let donate_file = pub_dir.join("donate.html");
    let maintenance_file = pub_dir.join("maintenance.html");
    let notfound_file = pub_dir.join("404.html");
    let error_file = pub_dir.join("500.html");

    // Legal
    let privacy_file = pub_dir.join("legal/privacy-policy.html");
    let terms_file = pub_dir.join("legal/terms-of-service.html");

    // Metadata & SEO
    let sitemap_file = pub_dir.join("sitemap.xml");
    let robots_file = pub_dir.join("robots.txt");
    let llms_file = pub_dir.join("llms.txt");
    let security_file = pub_dir.join("security.txt");
    let well_known_sec = pub_dir.join(".well-known/security.txt");
    let manifest_file = pub_dir.join("site.webmanifest");
    let browserconfig_file = pub_dir.join("browserconfig.xml");

    Router::new()
        // Core Web UI Pages
        .route_service("/", ServeFile::new(index_file))
        .route_service("/docs", ServeFile::new(docs_file))
        .route_service("/stats", ServeFile::new(stats_file))
        .route_service("/request-report", ServeFile::new(report_file))
        .route_service("/support", ServeFile::new(support_file))
        .route_service("/changelog", ServeFile::new(changelog_file))
        .route_service("/donate", ServeFile::new(donate_file.clone()))
        .route_service("/donasi", ServeFile::new(donate_file))
        .route_service("/maintenance", ServeFile::new(maintenance_file))
        .route_service("/404", ServeFile::new(notfound_file))
        .route_service("/500", ServeFile::new(error_file))

        // Legal documents
        .route_service("/legal/privacy", ServeFile::new(privacy_file.clone()))
        .route_service("/legal/privacy-policy", ServeFile::new(privacy_file))
        .route_service("/legal/terms", ServeFile::new(terms_file.clone()))
        .route_service("/legal/terms-of-service", ServeFile::new(terms_file))

        // SEO, LLM, Web Manifest & Security files
        .route_service("/sitemap.xml", ServeFile::new(sitemap_file))
        .route_service("/robots.txt", ServeFile::new(robots_file))
        .route_service("/llms.txt", ServeFile::new(llms_file))
        .route_service("/security.txt", ServeFile::new(security_file))
        .route_service("/.well-known/security.txt", ServeFile::new(well_known_sec))
        .route_service("/site.webmanifest", ServeFile::new(manifest_file))
        .route_service("/browserconfig.xml", ServeFile::new(browserconfig_file))

        // Static Asset directories
        .nest_service("/assets", ServeDir::new(pub_dir.join("assets")))
        .nest_service("/public", ServeDir::new(pub_dir))
}

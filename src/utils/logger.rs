pub fn init_logger() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,apiku_rs=debug,tower_http=debug".into()),
        )
        .init();
}

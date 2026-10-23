use regex::Regex;
use std::sync::LazyLock;

static SUSPICIOUS_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?i)\.env($|/|\?)").unwrap(),
        Regex::new(r"(?i)/wp-admin").unwrap(),
        Regex::new(r"(?i)/wp-login").unwrap(),
        Regex::new(r"(?i)/phpmyadmin").unwrap(),
        Regex::new(r"(?i)/config\.php").unwrap(),
        Regex::new(r"(?i)^/tools/spam-otp").unwrap(),
        Regex::new(r#"['"]$"#).unwrap(),
    ]
});

pub fn is_suspicious_path(path: &str) -> bool {
    SUSPICIOUS_PATTERNS.iter().any(|re| re.is_match(path))
}

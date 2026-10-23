use serde_json::json;

pub const KATEGORI: &[&str] = &["Request Fitur", "Laporan Bug", "Feedback", "Lainnya"];

pub async fn send_report(
    kategori: &str,
    pesan: &str,
    nama: Option<&str>,
    kontak: Option<&str>,
    ip: Option<&str>,
) -> Result<bool, String> {
    if !KATEGORI.contains(&kategori) {
        return Err(format!("Kategori tidak valid. Pilihan: {}", KATEGORI.join(", ")));
    }
    if pesan.trim().is_empty() {
        return Err("Parameter 'pesan' tidak boleh kosong".to_string());
    }
    if pesan.len() > 5000 {
        return Err("Pesan terlalu panjang (maksimal 5000 karakter)".to_string());
    }

    let token = std::env::var("ID_TOKEN")
        .or_else(|_| std::env::var("TELEGRAM_TOKEN"))
        .unwrap_or_default();

    if token.is_empty() {
        return Err("Telegram token not configured".to_string());
    }

    let chat_id = std::env::var("CHAT_ID")
        .or_else(|_| std::env::var("TELEGRAM_CHAT_ID"))
        .unwrap_or_else(|_| "5323386592".to_string());

    let emoji = match kategori {
        "Request Fitur" => "🚀",
        "Laporan Bug" => "🐛",
        "Feedback" => "💬",
        _ => "📌",
    };

    let message = format!(
        "{} *{}*\n\n*Pengirim:* {}\n*Kontak:* {}\n*IP:* {}\n\n*Pesan:*\n{}",
        emoji,
        kategori.to_uppercase(),
        nama.unwrap_or("Anonim"),
        kontak.unwrap_or("-"),
        ip.unwrap_or("-"),
        pesan
    );

    let client = reqwest::Client::new();
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);

    let res = client.post(&url)
        .json(&json!({
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown"
        }))
        .send()
        .await
        .map_err(|e| format!("Telegram error: {}", e))?;

    Ok(res.status().is_success())
}

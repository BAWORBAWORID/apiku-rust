use axum::response::IntoResponse;
use axum::Json;
use rand::seq::SliceRandom;
use rand::Rng;
use serde_json::json;

pub async fn handler() -> impl IntoResponse {
    let mut rng = rand::thread_rng();

    let chrome_ver = format!(
        "{}.0.{}.{}",
        rng.gen_range(115..135),
        rng.gen_range(5000..7000),
        rng.gen_range(10..200)
    );
    let win_ver = rng.gen_range(10..11);
    let mac_ver = format!("{}_{}", rng.gen_range(13..15), rng.gen_range(0..6));
    let android_ver = rng.gen_range(11..15);

    let uas = [
        ("chrome", "windows", format!("Mozilla/5.0 (Windows NT {}.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{} Safari/537.36", win_ver, chrome_ver)),
        ("chrome", "mac", format!("Mozilla/5.0 (Macintosh; Intel Mac OS X {}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{} Safari/537.36", mac_ver, chrome_ver)),
        ("chrome", "linux", format!("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{} Safari/537.36", chrome_ver)),
        ("firefox", "windows", format!("Mozilla/5.0 (Windows NT {}.0; Win64; x64; rv:{}.0) Gecko/20100101 Firefox/{}.0", win_ver, rng.gen_range(120..135), rng.gen_range(120..135))),
        ("chrome", "android", format!("Mozilla/5.0 (Linux; Android {}; Pixel {}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{} Mobile Safari/537.36", android_ver, rng.gen_range(6..9), chrome_ver)),
        ("safari", "ios", format!("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1")),
    ];

    let choice = uas.choose(&mut rng).unwrap();

    Json(json!({
        "status": true,
        "result": {
            "browser": choice.0,
            "platform": choice.1,
            "useragent": choice.2
        },
    })).into_response()
}

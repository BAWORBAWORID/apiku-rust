// Font — native conversion of api/tools/font.js (unicode font styles)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const ALLOWED_STYLES: &[&str] = &[
    "bold",
    "italic",
    "script",
    "full",
    "smallcaps",
    "rounded",
    "squared",
];
const MAX_TEXT_LENGTH: usize = 1000;

fn font_map(style: &str, c: char) -> Option<&'static str> {
    let idx = |c: char| -> Option<usize> {
        if c.is_ascii_lowercase() {
            Some(c as usize - 'a' as usize)
        } else if c.is_ascii_uppercase() {
            Some(c as usize - 'A' as usize)
        } else {
            None
        }
    };

    match style {
        "bold" => {
            const L: [&str; 26] = [
                "𝗮", "𝗯", "𝗰", "𝗱", "𝗲", "𝗳", "𝗴", "𝗵", "𝗶", "𝗷", "𝗸", "𝗹", "𝗺", "𝗻", "𝗼", "𝗽",
                "𝗾", "𝗿", "𝘀", "𝘁", "𝘂", "𝘃", "𝘄", "𝘅", "𝘆", "𝘇",
            ];
            if c.is_ascii_digit() {
                const D: [&str; 10] = ["𝟬", "𝟭", "𝟮", "𝟯", "𝟰", "𝟱", "𝟲", "𝟳", "𝟴", "𝟵"];
                return D.get(c as usize - '0' as usize).copied();
            }
            idx(c).map(|i| L[i])
        }
        "italic" => {
            const L: [&str; 26] = [
                "𝘢", "𝘣", "𝘤", "𝘥", "𝘦", "𝘧", "𝘨", "𝘩", "𝘪", "𝘫", "𝘬", "𝘭", "𝘮", "𝘯", "𝘰", "𝘱",
                "𝘲", "𝘳", "𝘴", "𝘵", "𝘶", "𝘷", "𝘸", "𝘹", "𝘺", "𝘻",
            ];
            idx(c).map(|i| L[i])
        }
        "script" => {
            const L: [&str; 26] = [
                "𝓪", "𝓫", "𝓬", "𝓭", "𝓮", "𝓯", "𝓰", "𝓱", "𝓲", "𝓳", "𝓴", "𝓵", "𝓶", "𝓷", "𝓸", "𝓹",
                "𝓺", "𝓻", "𝓼", "𝓽", "𝓾", "𝓿", "𝔀", "𝔁", "𝔂", "𝔃",
            ];
            idx(c).map(|i| L[i])
        }
        "full" => {
            const L: [&str; 26] = [
                "ａ", "ｂ", "ｃ", "ｄ", "ｅ", "ｆ", "ｇ", "ｈ", "ｉ", "ｊ", "ｋ", "ｌ", "ｍ", "ｎ",
                "ｏ", "ｐ", "ｑ", "ｒ", "ｓ", "ｔ", "ｕ", "ｖ", "ｗ", "ｘ", "ｙ", "ｚ",
            ];
            if c == ' ' {
                return Some("　");
            }
            if c.is_ascii_digit() {
                const D: [&str; 10] = ["０", "１", "２", "３", "４", "５", "６", "７", "８", "９"];
                return D.get(c as usize - '0' as usize).copied();
            }
            idx(c).map(|i| L[i])
        }
        "smallcaps" => {
            const L: [&str; 26] = [
                "ᴀ", "ʙ", "ᴄ", "ᴅ", "ᴇ", "ꜰ", "ɢ", "ʜ", "ɪ", "ᴊ", "ᴋ", "ʟ", "ᴍ", "ɴ", "ᴏ", "ᴘ",
                "ǫ", "ʀ", "ꜱ", "ᴛ", "ᴜ", "ᴠ", "ᴡ", "x", "ʏ", "ᴢ",
            ];
            if c.is_ascii_digit() {
                const D: [&str; 10] = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
                return D.get(c as usize - '0' as usize).copied();
            }
            idx(c).map(|i| L[i])
        }
        "rounded" => {
            const L: [&str; 26] = [
                "🅐", "🅑", "🅒", "🅓", "🅔", "🅕", "🅖", "🅗", "🅘", "🅙", "🅚", "🅛", "🅜", "🅝", "🅞", "🅟",
                "🅠", "🅡", "🅢", "🅣", "🅤", "🅥", "🅦", "🅧", "🅨", "🅩",
            ];
            if c.is_ascii_digit() {
                const D: [&str; 10] = ["⓿", "❶", "❷", "❸", "❹", "❺", "❻", "❼", "❽", "❾"];
                return D.get(c as usize - '0' as usize).copied();
            }
            idx(c).map(|i| L[i])
        }
        "squared" => {
            const L: [&str; 26] = [
                "ﾑ", "乃", "ᄃ", "り", "乇", "ｷ", "ム", "ん", "ﾉ", "ﾌ", "ズ", "ﾚ", "ﾶ", "刀", "の",
                "ｱ", "ゐ", "尺", "丂", "ｲ", "ひ", "√", "W", "ﾒ", "ﾘ", "乙",
            ];
            if c == ' ' {
                return Some("　");
            }
            if c.is_ascii_digit() {
                const D: [&str; 10] = ["０", "１", "２", "３", "４", "５", "６", "７", "８", "９"];
                return D.get(c as usize - '0' as usize).copied();
            }
            idx(c).map(|i| L[i])
        }
        _ => None,
    }
}

fn convert_text(text: &str, style: &str) -> String {
    text.chars()
        .map(|c| {
            if let Some(m) = font_map(style, c) {
                return m.to_string();
            }
            c.to_lowercase()
                .next()
                .and_then(|lc| font_map(style, lc))
                .map(|s| s.to_string())
                .unwrap_or_else(|| c.to_string())
        })
        .collect()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    };

    let start = std::time::Instant::now();
    let request_id: String = {
        use rand::Rng;
        let b: [u8; 4] = rand::thread_rng().gen();
        b.iter().map(|x| format!("{:02x}", x)).collect()
    };

    let style_raw = get("style").unwrap_or_else(|| "bold".to_string());
    let style = style_raw.to_lowercase();

    if !ALLOWED_STYLES.contains(&style.as_str()) {
        return Json(json!({
            "success": false,
            "message": "Invalid parameters",
            "errors": [format!("Invalid style. Allowed: {}", ALLOWED_STYLES.join(", "))],
            "example": {
                "GET": "/api/tools/font?style=bold&text=Hello%20World",
                "POST": { "style": "bold", "text": "Hello World" }
            },
            "allowed": { "styles": ALLOWED_STYLES, "maxTextLength": MAX_TEXT_LENGTH },
        }))
        .into_response();
    }

    let text_raw = get("text").or_else(|| get("q"));
    let text: String = text_raw
        .map(|t| {
            t.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string()
        })
        .unwrap_or_default();

    if text.is_empty() {
        return Json(json!({
            "success": false,
            "message": "Invalid parameters",
            "errors": ["Parameter \"text\" is required"],
            "example": {
                "GET": "/api/tools/font?style=bold&text=Hello%20World",
                "POST": { "style": "bold", "text": "Hello World" }
            },
            "allowed": { "styles": ALLOWED_STYLES, "maxTextLength": MAX_TEXT_LENGTH },
        }))
        .into_response();
    }

    if text.len() > MAX_TEXT_LENGTH {
        return Json(json!({
            "success": false,
            "message": "Invalid parameters",
            "errors": [format!("Text too long. Maximum {} characters", MAX_TEXT_LENGTH)],
            "example": {
                "GET": "/api/tools/font?style=bold&text=Hello%20World",
                "POST": { "style": "bold", "text": "Hello World" }
            },
            "allowed": { "styles": ALLOWED_STYLES, "maxTextLength": MAX_TEXT_LENGTH },
        }))
        .into_response();
    }

    let converted = convert_text(&text, &style);

    Json(json!({
        "success": true,
        "message": "Text converted successfully",
        "requestId": request_id,
        "duration": format!("{}ms", start.elapsed().as_millis()),
        "data": {
            "original": text,
            "style": style,
            "converted": converted,
            "length": converted.chars().count(),
        }
    })).into_response()

}

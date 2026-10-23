// Translate — native conversion of api/tools/translate.js
// Universal translator: Google Translate -> DeepL Web -> Neural GTX -> MyMemory (fallback chain)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const SUPPORTED_LANGUAGES: &[(&str, &str)] = &[
    ("AR", "Arabic (Arab)"),
    ("BG", "Bulgarian"),
    ("CS", "Czech"),
    ("DA", "Danish"),
    ("DE", "German (Jerman)"),
    ("EL", "Greek"),
    ("EN", "English (Inggris)"),
    ("EN-GB", "English (British)"),
    ("EN-US", "English (American)"),
    ("ES", "Spanish (Spanyol)"),
    ("ET", "Estonian"),
    ("FI", "Finnish"),
    ("FR", "French (Prancis)"),
    ("HU", "Hungarian"),
    ("ID", "Indonesian (Indonesia)"),
    ("IT", "Italian (Italia)"),
    ("JA", "Japanese (Jepang)"),
    ("KO", "Korean (Korea)"),
    ("LT", "Lithuanian"),
    ("LV", "Latvian"),
    ("NB", "Norwegian Bokmål"),
    ("NL", "Dutch (Belanda)"),
    ("PL", "Polish"),
    ("PT", "Portuguese (Portugis)"),
    ("PT-BR", "Portuguese (Brazilian)"),
    ("PT-PT", "Portuguese (European)"),
    ("RO", "Romanian"),
    ("RU", "Russian (Rusia)"),
    ("SK", "Slovak"),
    ("SL", "Slovenian"),
    ("SV", "Swedish"),
    ("TR", "Turkish (Turki)"),
    ("UK", "Ukrainian"),
    ("ZH", "Chinese (Mandarin Simplified)"),
    ("ZH-HANT", "Chinese (Mandarin Traditional)"),
];

const REGIONAL_LANGUAGES: &[(&str, &str, &str)] = &[
    ("JW", "Jawa", "Javanese"),
    ("SU", "Sunda", "Sundanese"),
    ("BAN", "Bali", "Balinese"),
    ("MIN", "Minangkabau", "Minang"),
    ("AV", "Batak/Bugis (Avar)", "Avaric"),
    ("ACE", "Aceh", "Acehnese"),
    ("MAD", "Madura", "Madurese"),
    ("MS", "Melayu", "Malay"),
];

const LANGUAGE_ALIASES: &[(&str, &str)] = &[
    ("arab", "AR"),
    ("arabic", "AR"),
    ("inggris", "EN"),
    ("english", "EN"),
    ("indonesia", "ID"),
    ("indonesian", "ID"),
    ("jepang", "JA"),
    ("japanese", "JA"),
    ("korea", "KO"),
    ("korean", "KO"),
    ("mandarin", "ZH"),
    ("chinese", "ZH"),
    ("jerman", "DE"),
    ("german", "DE"),
    ("prancis", "FR"),
    ("french", "FR"),
    ("spanyol", "ES"),
    ("spanish", "ES"),
    ("italia", "IT"),
    ("italian", "IT"),
    ("rusia", "RU"),
    ("russian", "RU"),
    ("portugis", "PT"),
    ("portuguese", "PT"),
    ("brasil", "PT-BR"),
    ("turki", "TR"),
    ("turkish", "TR"),
    ("belanda", "NL"),
    ("dutch", "NL"),
    ("thailand", "TH"),
    ("vietnam", "VI"),
    ("jawa", "JW"),
    ("javanese", "JW"),
    ("sunda", "SU"),
    ("sundanese", "SU"),
    ("bali", "BAN"),
    ("balinese", "BAN"),
    ("minang", "MIN"),
    ("minangkabau", "MIN"),
    ("batak", "BTK"),
    ("aceh", "ACE"),
    ("acehnese", "ACE"),
    ("madura", "MAD"),
    ("madurese", "MAD"),
    ("melayu", "MS"),
    ("malay", "MS"),
];

fn normalize_language_code(input: &str) -> String {
    let raw = input.trim().to_uppercase();
    if SUPPORTED_LANGUAGES.iter().any(|(c, _)| *c == raw) {
        return raw;
    }
    if REGIONAL_LANGUAGES.iter().any(|(c, _, _)| *c == raw) {
        return raw;
    }
    if let Some((_, code)) = LANGUAGE_ALIASES
        .iter()
        .find(|(a, _)| *a == input.trim().to_lowercase())
    {
        return code.to_string();
    }
    let prefix = raw.split('-').next().unwrap_or("").to_string();
    if SUPPORTED_LANGUAGES.iter().any(|(c, _)| *c == prefix) {
        return prefix;
    }
    if REGIONAL_LANGUAGES.iter().any(|(c, _, _)| *c == prefix) {
        return prefix;
    }
    "EN".to_string()
}

fn language_name(code: &str) -> String {
    if let Some((c, name_id, name_en)) = REGIONAL_LANGUAGES.iter().find(|(cc, _, _)| *cc == code) {
        let _ = c;
        return format!("{} ({})", name_id, name_en);
    }
    SUPPORTED_LANGUAGES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| code.to_string())
}

fn to_google_lang(code: &str) -> String {
    match code {
        "EN-GB" | "EN-US" => "en".into(),
        "PT-BR" | "PT-PT" => "pt".into(),
        "ZH" => "zh-CN".into(),
        "ZH-HANT" => "zh-TW".into(),
        "BTK" => "jw".into(),
        _ => code
            .to_lowercase()
            .split('-')
            .next()
            .unwrap_or("en")
            .to_string(),
    }
}

fn get_voice_audio_url(text: &str, lang_code: &str) -> String {
    let lang = to_google_lang(lang_code);
    format!(
        "https://translate.google.com/translate_tts?ie=UTF-8&q={}&tl={}&client=tw-ob",
        urlencoding::encode(&text.chars().take(500).collect::<String>()),
        lang
    )
}

// ---- Engine 1: Google Translate ----
async fn translate_google(
    client: &reqwest::Client,
    text: &str,
    target: &str,
    source: &str,
) -> Result<Value, String> {
    let sl = if source != "auto" {
        to_google_lang(source)
    } else {
        "auto".into()
    };
    let tl = to_google_lang(target);

    let endpoints = [
        format!("https://translate.google.com/translate_a/single?client=dict-chrome-ex&sl={}&tl={}&dt=t&dt=bd&dt=rm&dt=at&dt=qc&q={}", urlencoding::encode(&sl), urlencoding::encode(&tl), urlencoding::encode(text)),
        format!("https://translate.google.co.id/translate_a/single?client=dict-chrome-ex&sl={}&tl={}&dt=t&dt=bd&dt=rm&dt=at&dt=qc&q={}", urlencoding::encode(&sl), urlencoding::encode(&tl), urlencoding::encode(text)),
        format!("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl={}&tl={}&q={}", urlencoding::encode(&sl), urlencoding::encode(&tl), urlencoding::encode(text)),
    ];

    let mut raw: Option<Value> = None;
    let mut last_err = String::from("koneksi");
    for ep in &endpoints {
        match client
            .get(ep)
                        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                        .header("Accept", "application/json, text/plain, */*")
                        .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
            
            .send()
            .await
        {
            Ok(r) => {
                if let Ok(data) = r.json::<Value>().await {
                    if !data.is_null() {
                        raw = Some(data);
                        break;
                    }
                }
            }
            Err(e) => last_err = e.to_string(),
        }
    }

    let raw = raw.ok_or_else(|| format!("Google Translate gagal: {}", last_err))?;

    // simple string-array format
    if let Some(arr) = raw.as_array() {
        if let Some(Value::String(_)) = arr.first() {
            let joined: String = arr.iter().filter_map(|v| v.as_str()).collect();
            return Ok(json!({
                "translatedText": joined,
                "sourceLanguage": if source != "auto" { source.to_string() } else { "AUTO".to_string() },
                "engine": "Google Translate",
            }));
        }
    }

    let sentences = raw
        .get(0)
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    let mut translated_text = String::new();
    let mut source_pron: Option<String> = None;
    let mut target_pron: Option<String> = None;
    for s in &sentences {
        if let Some(sa) = s.as_array() {
            if let Some(t) = sa.first().and_then(|v| v.as_str()) {
                translated_text.push_str(t);
            }
            if let Some(p) = sa.get(3).and_then(|v| v.as_str()) {
                source_pron = Some(p.to_string());
            }
            if let Some(p) = sa.get(2).and_then(|v| v.as_str()) {
                if sa
                    .first()
                    .map(|v| v.is_null() || v.as_str().map(|x| x.is_empty()).unwrap_or(true))
                    .unwrap_or(true)
                {
                    target_pron = Some(p.to_string());
                }
            }
        }
    }

    let detected_code = raw
        .get(2)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            if source != "auto" {
                Some(to_google_lang(source))
            } else {
                None
            }
        });
    let confidence = raw.get(6).and_then(|v| v.as_f64());

    let mut dictionary = Vec::new();
    if let Some(dict_raw) = raw.get(1).and_then(|d| d.as_array()) {
        for entry in dict_raw.iter().take(5) {
            if let Some(ea) = entry.as_array() {
                let word = ea.first().and_then(|v| v.as_str()).unwrap_or("");
                let pos = ea.get(1).and_then(|v| v.as_str());
                let translations: Vec<Value> = ea
                    .get(2)
                    .and_then(|v| v.as_array())
                    .map(|ts| {
                        ts.iter()
                            .take(5)
                            .map(|t| json!({ "word": t.get(0), "frequency": t.get(3) }))
                            .collect()
                    })
                    .unwrap_or_default();
                dictionary.push(
                    json!({ "word": word, "partOfSpeech": pos, "translations": translations }),
                );
            }
        }
    }

    let mut alternatives = Vec::new();
    for s in &sentences {
        if let Some(sa) = s.as_array() {
            if let Some(second) = sa.get(1) {
                if let Some(s2) = second.as_array() {
                    for a in s2.iter().take(5) {
                        if let Some(a_str) = a.as_str() {
                            alternatives.push(a_str.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(json!({
        "translatedText": translated_text,
        "sourceLanguage": detected_code.clone().or_else(|| if source != "auto" { Some(source.to_string()) } else { None }).unwrap_or_else(|| "AUTO".into()),
        "engine": "Google Translate",
        "detectedCode": detected_code,
        "confidence": confidence,
        "pronunciation": target_pron.or_else(|| source_pron.clone()),
        "romanization": source_pron,
        "alternatives": alternatives.into_iter().filter(|a| a != &translated_text).take(3).collect::<Vec<_>>(),
        "dictionary": dictionary,
        "spellCheck": Value::Null,
    }))
}

// ---- Engine 2: DeepL Web ----
async fn translate_deepl(
    client: &reqwest::Client,
    text: &str,
    target: &str,
    source: &str,
) -> Result<Value, String> {
    let i_count = text.chars().filter(|c| *c == 'i').count() as i64;
    let base = chrono::Utc::now().timestamp();
    let diff = i_count - (base % (i_count + 1)) + 1;
    let ts = base + diff;

    let source_u = if source == "auto" {
        "auto".to_string()
    } else {
        source.to_uppercase()
    };
    let target_u = target.to_uppercase();

    let payload = json!({
        "jsonrpc": "2.0",
        "method": "LMT_handle_texts",
        "params": {
            "splitting": "newlines",
            "lang": { "target_lang": target_u, "source_lang_user_selected": source_u },
            "texts": [{ "text": text, "requestAlternatives": 3 }],
            "timestamp": ts,
        },
        "id": rand::random::<u64>() % 90000 + 10000,
        "ver": "2.0",
    });

    let body = serde_json::to_string(&payload)
        .unwrap()
        .replace("\"method\":\"", "\"method\": \"");
    let res = client
        .post(format!(
            "https://www2.deepl.com/jsonrpc?jsonrpc=2.0&method=LMT_handle_texts&id={}&ver=2.0",
            rand::random::<u64>() % 90000 + 10000
        ))
                    .header("Content-Type", "application/json")
                    .header("Accept", "*/*")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
                    .header("Origin", "https://www.deepl.com")
                    .header("Referer", "https://www.deepl.com/translator")
        
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = res
        .json()
        .await
        .map_err(|_| "DeepL response tidak valid".to_string())?;
    let result = data
        .pointer("/result/texts/0/text")
        .and_then(|t| t.as_str())
        .ok_or("DeepL response tidak valid")?
        .to_string();

    let detected = data
        .pointer("/result/lang/detected_source_lang")
        .and_then(|d| d.as_str())
        .unwrap_or("AUTO");
    let alternatives: Vec<String> = data
        .pointer("/result/texts/0/alternatives")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.get("text").and_then(|t| t.as_str()))
                .take(3)
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "translatedText": result,
        "sourceLanguage": detected,
        "alternatives": alternatives,
        "engine": "DeepL Web Protocol",
    }))
}

// ---- Engine 3: Neural GTX ----
async fn translate_neural_gtx(
    client: &reqwest::Client,
    text: &str,
    target: &str,
    source: &str,
) -> Result<Value, String> {
    let body = format!(
        "text={}&to={}&from={}",
        urlencoding::encode(text),
        urlencoding::encode(&target.to_lowercase().split('-').next().unwrap_or("en")),
        if source == "auto" {
            "auto".to_string()
        } else {
            source
                .to_lowercase()
                .split('-')
                .next()
                .unwrap_or("en")
                .to_string()
        }
    );
    let res = client
        .post("https://translate.neuralgtx.dev/translate")
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
                    .header("Origin", "https://translate.neuralgtx.dev")
                    .header("Referer", "https://translate.neuralgtx.dev/")
        
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = res
        .json()
        .await
        .map_err(|_| "Neural GTX response tidak valid".to_string())?;
    let translated = data
        .get("translatedText")
        .or_else(|| data.get("translation"))
        .or_else(|| data.get("result"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .ok_or("Neural GTX response tidak valid")?;
    if translated.is_empty() {
        return Err("Neural GTX response tidak valid".into());
    }

    Ok(json!({
        "translatedText": translated,
        "sourceLanguage": source.to_uppercase(),
        "engine": "Neural GTX Engine",
    }))
}

// ---- Engine 4: MyMemory ----
async fn translate_mymemory(
    client: &reqwest::Client,
    text: &str,
    target: &str,
    source: &str,
) -> Result<Value, String> {
    let tl_owned = target.to_lowercase().split('-').next().unwrap_or("en").to_string();
    let tl = tl_owned.as_str();
    let sl = if source == "auto" {
        "id".to_string()
    } else {
        source
            .to_lowercase()
            .split('-')
            .next()
            .unwrap_or("id")
            .to_string()
    };

    let res = client
        .get("https://api.mymemory.translated.net/get")
        .query(&[("q", text), ("langpair", &format!("{}|{}", sl, tl))])
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
        
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = res
        .json()
        .await
        .map_err(|_| "MyMemory response tidak valid".to_string())?;
    let translated = data
        .pointer("/responseData/translatedText")
        .and_then(|t| t.as_str())
        .ok_or("MyMemory quota or rate limit")?
        .to_string();
    if translated.contains("MYMEMORY WARNING")
        || translated
            .to_uppercase()
            .contains("PLEASE SELECT TWO DISTINCT")
        || translated.to_uppercase().contains("QUERY LENGTH LIMIT")
        || translated.to_uppercase().contains("INVALID SOURCE")
        || translated.to_uppercase().contains("INVALID TARGET")
    {
        return Err("MyMemory quota or rate limit".into());
    }

    let alternatives: Vec<String> = data
        .get("matches")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("translation").and_then(|t| t.as_str()))
                .filter(|t| *t != translated)
                .take(3)
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "translatedText": translated,
        "sourceLanguage": source.to_uppercase(),
        "alternatives": alternatives,
        "engine": "MyMemory Corpus Engine",
    }))
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
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

    let text = match get("text") {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            return Json(json!({"status": false, "message": "Parameter 'text' wajib diisi"}))
                .into_response()
        }
    };

    let target_lang = normalize_language_code(&get("lang").unwrap_or_else(|| "EN".into()));
    let source_lang = get("source").unwrap_or_else(|| "auto".into());
    let want_voice = get("voice").as_deref() == Some("1");
    let want_detail = get("detail").as_deref() == Some("1");
    let started = std::time::Instant::now();

    let client = &state.client;

    let mut result_data: Option<Value> = None;
    let mut last_err: Option<String> = None;

    macro_rules! try_engine {
        ($f:expr) => {
            match $f(client, &text, &target_lang, &source_lang).await {
                Ok(r) => {
                    if r.get("translatedText")
                        .and_then(|t| t.as_str())
                        .map(|s| !s.is_empty())
                        .unwrap_or(false)
                    {
                        result_data = Some(r);
                    }
                }
                Err(e) => last_err = Some(e),
            }
        };
    }

    if result_data.is_none() {
        try_engine!(translate_google);
    }
    if result_data.is_none() {
        try_engine!(translate_deepl);
    }
    if result_data.is_none() {
        try_engine!(translate_neural_gtx);
    }
    if result_data.is_none() {
        try_engine!(translate_mymemory);
    }

    let result_data = match result_data {
        Some(d) => d,
        None => {
            return Json(json!({
                "status": false,
                "message": last_err.unwrap_or_else(|| "Gagal menghubungi layanan terjemahan bahasa.".into()),
            }))
            .into_response()
        }
    };

    let mut detected_source = result_data
        .get("sourceLanguage")
        .and_then(|s| s.as_str())
        .unwrap_or("AUTO")
        .to_string();
    if detected_source == "AUTO" || detected_source.is_empty() {
        detected_source = source_lang.to_uppercase();
    }

    let mut result = json!({
        "status": true,
        "result": {
            "original_text": text,
            "source_language": detected_source,
            "target_language": target_lang,
            "language_name": language_name(&target_lang),
            "translated_text": result_data.get("translatedText"),
            "engine": result_data.get("engine"),
            "durationMs": started.elapsed().as_millis(),
        }
    });

    if want_detail {
        if let Some(alt) = result_data
            .get("alternatives")
            .filter(|a| a.as_array().map(|x| !x.is_empty()).unwrap_or(false))
        {
            result["result"]["alternatives"] = alt.clone();
        }
        if let Some(p) = result_data.get("pronunciation") {
            if !p.is_null() {
                result["result"]["pronunciation"] = p.clone();
            }
        }
        if let Some(r) = result_data.get("romanization") {
            if !r.is_null() {
                result["result"]["romanization"] = r.clone();
            }
        }
        if let Some(d) = result_data
            .get("dictionary")
            .filter(|d| d.as_array().map(|x| !x.is_empty()).unwrap_or(false))
        {
            result["result"]["dictionary"] = d.clone();
        }
        if let Some(sc) = result_data.get("spellCheck") {
            if !sc.is_null() {
                result["result"]["spell_check"] = sc.clone();
            }
        }
        if let Some(c) = result_data.get("confidence") {
            if c.is_number() {
                result["result"]["confidence"] = c.clone();
            }
        }
        if let Some(dc) = result_data.get("detectedCode") {
            if !dc.is_null() {
                result["result"]["detected_lang_code"] = dc.clone();
            }
        }
    }

    if want_voice {
        result["result"]["voice_url"] = json!(get_voice_audio_url(
            result_data
                .get("translatedText")
                .and_then(|t| t.as_str())
                .unwrap_or(""),
            &target_lang
        ));
        result["result"]["original_voice_url"] =
            json!(get_voice_audio_url(&text, &detected_source));
    }

    Json(result).into_response()
}

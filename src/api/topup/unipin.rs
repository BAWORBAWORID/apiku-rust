// UniPin Topup — native conversion of api/topup/unipin.js
// Multi-action scraper: home / search / detail / check / order / status.
// Cookies tracked manually (region=id + session cookies). QRIS checkout page
// embeds the QR as absolutely-positioned 5px rects — rebuilt as SVG natively
// (the Node build rasterized via sharp; native returns the SVG data URL).
use axum::{
    extract::{Query},
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use reqwest::header;

const BASE_URL: &str = "https://www.unipin.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .build().unwrap_or_default()
}

fn merged(query: &HashMap<String, String>, body: &Option<Json<Value>>) -> Value {
    let mut m = json!({});
    if let Some(Json(b)) = body {
        if let Some(o) = b.as_object() { for (k, v) in o { m[k] = v.clone(); } }
    }
    for (k, v) in query { m[k] = json!(v); }
    m
}

fn str_param(m: &Value, key: &str) -> Option<String> {
    match m.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

type CookieMap = HashMap<String, String>;

fn cookie_header(c: &CookieMap) -> String {
    c.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("; ")
}

fn absorb(c: &mut CookieMap, res: &reqwest::Response) {
    for sc in res.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(s) = sc.to_str() {
            let kv = s.split(';').next().unwrap_or("");
            if let Some((k, v)) = kv.split_once('=') {
                if !k.trim().is_empty() { c.insert(k.trim().to_string(), v.trim().to_string()); }
            }
        }
    }
}

async fn fetch_with_cookies(url: &str, cookies: &mut CookieMap) -> Result<reqwest::Response, String> {
    client().get(url)
        .header("Cookie", cookie_header(cookies))
        .send().await
        .map(|r| { absorb(cookies, &r); r })
        .map_err(|e| e.to_string())
}

fn is_union_pay(name: &str) -> bool {
    let l = name.to_lowercase();
    l.contains("union pay") || l.contains("union payment") || l.eq_ignore_ascii_case("cup")
}

fn parse_channels(html: &str) -> Vec<Value> {
    let re = regex::Regex::new(r#"pc_amounts\s*\[\s*'"]([0-9]+)['"\s*\]\s*=\s*(\{[\s\S]*?\});"#).unwrap();
    let mut out = Vec::new();
    for m in re.captures_iter(html) {
        let raw = m.get(2).map(|x| x.as_str().replace('\'', "\"")).unwrap_or_default();
        if let Ok(p) = serde_json::from_str::<Value>(&raw) {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if is_union_pay(&name) { continue; }
            let amounts: Vec<i64> = p.get("amt").and_then(|v| v.as_str())
                .map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect())
                .unwrap_or_default();
            out.push(json!({
                "id": m.get(1).map(|x| x.as_str()).unwrap_or(""),
                "name": name,
                "currency": p.get("currency"),
                "status": p.get("status"),
                "amounts": amounts
            }));
        }
    }
    out
}

fn resolve_payment_channel(input_pid: &str, page_html: &str) -> (String, String) {
    let channels = parse_channels(page_html);
    let mut target: Option<String> = None;
    if !input_pid.is_empty() {
        let s = input_pid.trim().to_lowercase();
        const ALIASES: &[(&str, &str)] = &[
            ("qris", "522"), ("gopay", "104"), ("gopay-later", "619"), ("dana", "103"),
            ("shopeepay", "432"), ("spaylater", "432"), ("ovo", "56"), ("linkaja", "131"),
            ("isaku", "756"), ("jenius", "125"), ("indodana", "207"), ("sakuku", "92"),
            ("bca", "43"), ("bca-va", "43"), ("bri", "476"), ("bri-va", "476"),
            ("bni", "42"), ("bni-va", "42"), ("mandiri", "474"), ("mandiri-va", "474"),
            ("permata", "857"), ("permata-va", "857"), ("cimb", "478"), ("cimb-va", "478"),
            ("danamon", "137"), ("danamon-va", "137"), ("indomaret", "41"), ("alfamart", "48"),
            ("alfamidi", "1131"), ("telkomsel", "118"), ("xl", "172"), ("axis", "172"),
            ("xl-axis", "172"), ("indosat", "592"), ("tri", "54"), ("smartfren", "622"),
        ];
        target = ALIASES.iter().find(|(a, _)| *a == s).map(|(_, id)| id.to_string());
        if target.is_none() && s.chars().all(|c| c.is_ascii_digit()) {
            target = Some(s.clone());
        }
        if target.is_none() {
            let clean: String = s.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            if let Some(m) = channels.iter().find(|ch| {
                let name = ch.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase()
                    .chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>();
                name.contains(&clean) || clean.contains(&name)
            }) {
                target = m.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        }
    }
    let id = target.unwrap_or_else(|| "522".to_string());
    let name = channels.iter().find(|ch| ch.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
        .and_then(|ch| ch.get("name").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| if id == "522" { "QRIS".to_string() } else { id.clone() });
    (id, name)
}

async fn resolve_game_url(game: &str) -> String {
    if game.starts_with("http") { return game.to_string(); }
    let clean = if game.starts_with('/') { game.to_string() } else { format!("/{}", game) };
    let candidates = [
        format!("{}/id{}", BASE_URL, clean),
        format!("{}/id/game{}", BASE_URL, clean),
        format!("{}{}", BASE_URL, clean),
    ];
    let mut cookies = CookieMap::new();
    cookies.insert("region".into(), "id".into());
    for url in &candidates {
        if let Ok(res) = fetch_with_cookies(url, &mut cookies).await {
            if res.status().is_success() { return url.clone(); }
        }
    }
    candidates[0].clone()
}

fn capture1(html: &str, re: &regex::Regex) -> Option<String> {
    re.captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

async fn get_home() -> Result<Value, String> {
    let mut cookies = CookieMap::new();
    cookies.insert("region".into(), "id".into());
    let res = fetch_with_cookies(&format!("{}/", BASE_URL), &mut cookies).await?;
    if !res.status().is_success() { return Err(format!("Gagal mengambil halaman utama UniPin ({})", res.status())); }
    let html = res.text().await.unwrap_or_default();
    let li_re = regex::Regex::new(r#"<li[^>]*class="[^"]*splide__slide[^"]*"[^>]*>([\s\S]*?)</li>"#).unwrap();
    let href_re = regex::Regex::new(r#"href="([^"]+)""#).unwrap();
    let src_re = regex::Regex::new(r#"src="([^"]+)""#).unwrap();
    let lazy_re = regex::Regex::new(r#"data-splide-lazy="([^"]+)""#).unwrap();
    let mut banners = Vec::new();
    for m in li_re.captures_iter(&html) {
        let inner = m.get(1).map(|x| x.as_str()).unwrap_or("");
        if inner.contains("<img") && inner.contains("<a") {
            let href = capture1(inner, &href_re);
            let src = capture1(inner, &src_re).or_else(|| capture1(inner, &lazy_re));
            let title = href.as_ref().map(|h| h.rsplit('/').next().unwrap_or("").replace('-', " ")).unwrap_or_default();
            if let (Some(h), Some(s)) = (href, src) {
                banners.push(json!({ "url": h, "image": s, "title": title }));
            }
        }
    }
    let card_re = regex::Regex::new(r#"<a[^>]*href="([^"]*)"[^>]*class="[^"]*nextgen-product-card[^"]*"[^>]*>([\s\S]*?)</a>"#).unwrap();
    let img_re1 = regex::Regex::new(r#"<img[^>]*alt="([^"]*)"[^>]*data-src="([^"]*)""#).unwrap();
    let img_re2 = regex::Regex::new(r#"<img[^>]*data-src="([^"]*)"[^>]*alt="([^"]*)""#).unwrap();
    let mut popular = Vec::new();
    for m in card_re.captures_iter(&html) {
        let url = m.get(1).map(|x| x.as_str()).unwrap_or("");
        let inner = m.get(2).map(|x| x.as_str()).unwrap_or("");
        let (title, img) = if let Some(c) = img_re1.captures(inner) {
            let a = c.get(1).map(|x| x.as_str()).unwrap_or("");
            let s = c.get(2).map(|x| x.as_str()).unwrap_or("");
            if a.starts_with("http") { (s.to_string(), a.to_string()) } else { (a.to_string(), s.to_string()) }
        } else if let Some(c) = img_re2.captures(inner) {
            let s = c.get(1).map(|x| x.as_str()).unwrap_or("");
            let a = c.get(2).map(|x| x.as_str()).unwrap_or("");
            if a.starts_with("http") { (s.to_string(), a.to_string()) } else { (a.to_string(), s.to_string()) }
        } else { (String::new(), String::new()) };
        if !url.is_empty() && !title.is_empty() {
            let slug = url.trim_start_matches("/id/").trim_start_matches('/');
            popular.push(json!({
                "title": title.trim(),
                "url": if url.starts_with("http") { url.to_string() } else { format!("{}{}", BASE_URL, url) },
                "slug": slug,
                "icon": if img.is_empty() { Value::Null } else { json!(img) }
            }));
        }
    }
    Ok(json!({ "banners": banners, "popular": popular }))
}

async fn search_games(query: &str) -> Result<Value, String> {
    if query.is_empty() { return Err("Parameter 'query' wajib diisi untuk pencarian game".into()); }
    let mut cookies = CookieMap::new();
    cookies.insert("region".into(), "id".into());
    let url = format!("{}/games/search?search={}", BASE_URL, urlencode(query));
    let res = fetch_with_cookies(&url, &mut cookies).await?;
    if !res.status().is_success() { return Err(format!("Gagal mencari game ({})", res.status())); }
    let html = res.text().await.unwrap_or_default();
    let a_re = regex::Regex::new(r#"<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>"#).unwrap();
    let src_re = regex::Regex::new(r#"src="([^"]*)""#).unwrap();
    let alt_re = regex::Regex::new(r#"alt="([^"]*)""#).unwrap();
    let name_re = regex::Regex::new(r#"<span[^>]*class="[^"]*product-name[^"]*"[^>]*>([^<]+)</span>"#).unwrap();
    let mut results = Vec::new();
    for m in a_re.captures_iter(&html) {
        let url = m.get(1).map(|x| x.as_str()).unwrap_or("");
        let inner = m.get(2).map(|x| x.as_str()).unwrap_or("");
        if inner.contains("cdn.unipin.com/images/icon_product_pages/") {
            let img = capture1(inner, &src_re);
            let alt = capture1(inner, &alt_re).unwrap_or_default();
            let title = if !alt.is_empty() { alt } else { capture1(inner, &name_re).map(|t| t.trim().to_string()).unwrap_or_default() };
            if !title.is_empty() && !url.is_empty() {
                let slug = url.trim_start_matches("/id/").trim_start_matches('/');
                results.push(json!({
                    "title": title.trim(),
                    "url": if url.starts_with("http") { url.to_string() } else { format!("{}{}", BASE_URL, url) },
                    "slug": slug,
                    "icon": img
                }));
            }
        }
    }
    Ok(json!({ "query": query, "total": results.len(), "results": results }))
}

async fn get_game_detail(game: &str) -> Result<Value, String> {
    if game.is_empty() { return Err("Parameter 'game' (slug atau URL) wajib diisi".into()); }
    let target = resolve_game_url(game).await;
    let mut cookies = CookieMap::new();
    cookies.insert("region".into(), "id".into());
    let res = fetch_with_cookies(&target, &mut cookies).await?;
    if !res.status().is_success() { return Err(format!("Gagal memuat detail game ({})", res.status())); }
    let html = res.text().await.unwrap_or_default();
    let og_re = regex::Regex::new(r#"<meta property="og:title" content="([^"]+)""#).unwrap();
    let title_re = regex::Regex::new(r"<title>([^<]+)</title>").unwrap();
    let clean_title = capture1(&html, &og_re)
        .or_else(|| capture1(&html, &title_re))
        .unwrap_or_default()
        .replace("UniPin - ", "").replace("UniPin – ", "").replace("(New)", "").trim().to_string();
    let desc_re = regex::Regex::new(r#"<meta property="og:description" content="([^"]+)""#).unwrap();
    let description = capture1(&html, &desc_re).map(|s| s.trim().to_string()).unwrap_or_default();
    let mut fields = Vec::new();
    if let Some(f) = regex::Regex::new(r#"<form[^>]*id="form-webtopup"[^>]*>([\s\S]*?)</form>"#).unwrap().captures(&html) {
        let inner = f.get(1).map(|x| x.as_str()).unwrap_or("");
        let input_re = regex::Regex::new(r#"<input[^>]*name="([^"]+)"[^>]*>"#).unwrap();
        let type_re = regex::Regex::new(r#"type="([^"]+)""#).unwrap();
        let ph_re = regex::Regex::new(r#"placeholder="([^"]+)""#).unwrap();
        for c in input_re.captures_iter(inner) {
            let whole = c.get(0).map(|x| x.as_str()).unwrap_or("");
            let name = c.get(1).map(|x| x.as_str()).unwrap_or("").to_string();
            let typ = capture1(whole, &type_re).unwrap_or_else(|| "text".into()).to_lowercase();
            if typ != "hidden" && name != "_token" && name != "influencer" && name != "source" {
                let placeholder = capture1(whole, &ph_re).unwrap_or_default();
                fields.push(json!({ "name": name, "label": if placeholder.trim().is_empty() { name.clone() } else { placeholder.trim().to_string() } }));
            }
        }
    }
    let mut denoms = Vec::new();
    let denom_re = regex::Regex::new(r#"data-id="([0-9]+)"\s+data-name="([^"]+)"(?:\s+data-amount="([0-9]+)")?"#).unwrap();
    for c in denom_re.captures_iter(&html) {
        denoms.push(json!({
            "id": c.get(1).map(|x| x.as_str()).unwrap_or(""),
            "name": c.get(2).map(|x| x.as_str()).unwrap_or(""),
            "amount": c.get(3).and_then(|x| x.as_str().parse::<i64>().ok())
        }));
    }
    Ok(json!({
        "title": clean_title,
        "description": description,
        "url": target,
        "fields": fields,
        "denominations": denoms,
        "payment_channels": parse_channels(&html)
    }))
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        b' ' => "+".into(),
        _ => format!("%{:02X}", b),
    }).collect()
}

async fn inquiry(target_url: &str, html: &str, cookies: &CookieMap, did: &str, pid: &str, email: &str, user_inputs: &HashMap<String, String>) -> Result<(Value, String), String> {
    let inq_re = regex::Regex::new(r#"url:\s*['"]([^'"]*inquiry[^'"]*)['"]"#).unwrap();
    let inq_url = capture1(html, &inq_re).ok_or("Game ini tidak memerlukan verifikasi User ID / Inquiry pada UniPin")?;
    let token_re = regex::Regex::new(r#"name="_token" type="hidden" value="([^"]+)""#).unwrap();
    let rgid_re = regex::Regex::new(r"'rgid':\s*'([^']+)'").unwrap();
    let csrf_re = regex::Regex::new(r"'X-CSRF-TOKEN':\s*'([^']+)'").unwrap();
    let did_re = regex::Regex::new(r#"data-id="([0-9]+)""#).unwrap();
    let game_re = regex::Regex::new(r#"<input[^>]*name="game"[^>]*value="([^"]+)""#).unwrap();
    let token = capture1(html, &token_re).unwrap_or_default();
    let rgid = capture1(html, &rgid_re).unwrap_or_default();
    let csrf = capture1(html, &csrf_re).unwrap_or_default();
    let default_did = capture1(html, &did_re).unwrap_or_else(|| "8227".into());
    let default_game = capture1(html, &game_re);
    let player_id = user_inputs.get("player_id").or_else(|| user_inputs.get("playerid"))
        .or_else(|| user_inputs.get("userid")).or_else(|| user_inputs.get("userId")).or_else(|| user_inputs.get("id")).cloned();

    let mut form: Vec<(String, String)> = vec![
        ("_token".into(), token.clone()), ("rgid".into(), rgid), ("did".into(), did.to_string()),
        ("pid".into(), pid.to_string()), ("influencer".into(), String::new()), ("source".into(), String::new()),
        ("cust_email".into(), email.to_string()),
    ];
    for (k, v) in user_inputs {
        if k == "action" || k == "game" || k == "slug" { continue; }
        if !form.iter().any(|(fk, _)| fk == k) { form.push((k.clone(), v.clone())); }
    }
    if let Some(g) = &default_game { form.push(("game".into(), g.clone())); }
    if let Some(p) = &player_id {
        form.retain(|(k, _)| k != "playerid" && k != "userid");
        form.push(("playerid".into(), p.clone()));
        form.push(("userid".into(), p.clone()));
    }
    let body = form.iter().map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v))).collect::<Vec<_>>().join("&");
    let res = client().post(&inq_url)
        .header("Cookie", cookie_header(cookies))
                    .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    .header("X-Requested-With", "XMLHttpRequest")
        .header("X-CSRF-TOKEN", if csrf.is_empty() { token } else { csrf })
        .header("Origin", BASE_URL)
        .header("Referer", target_url)
        .body(body)
        .send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        let t = res.text().await.unwrap_or_default();
        return Err(format!("Inquiry request failed ({}): {}", code, t.chars().take(200).collect::<String>()));
    }
    let j: Value = res.json().await.unwrap_or(Value::Null);
    Ok((j, inq_url))
}

async fn check_id(game: &str, user_inputs: &HashMap<String, String>) -> Result<Value, String> {
    let target = resolve_game_url(game).await;
    let mut cookies = CookieMap::new();
    cookies.insert("region".into(), "id".into());
    let res = fetch_with_cookies(&target, &mut cookies).await?;
    if !res.status().is_success() { return Err(format!("Gagal membuka halaman game ({})", res.status())); }
    let html = res.text().await.unwrap_or_default();
    let (j, _) = inquiry(&target, &html, &cookies, "8227", "103", "customer@unipin.com", user_inputs).await?;
    let status = j.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(json!({
        "valid": status == "1",
        "code": j.get("status"),
        "message": j.get("message").cloned().unwrap_or(json!("")),
        "raw": j
    }))
}

#[allow(clippy::too_many_arguments)]
async fn create_order(game: &str, did: &str, pid_in: &str, email: &str, phone: &str, user_inputs: &HashMap<String, String>) -> Result<Value, String> {
    if game.is_empty() { return Err("Parameter 'game' (slug atau URL) wajib diisi".into()); }
    if did.is_empty() { return Err("Parameter 'did' (ID item/diamond) wajib diisi".into()); }
    let target = resolve_game_url(game).await;
    let mut cookies = CookieMap::new();
    cookies.insert("region".into(), "id".into());
    let page_res = fetch_with_cookies(&target, &mut cookies).await?;
    if !page_res.status().is_success() { return Err(format!("Gagal membuka halaman game ({})", page_res.status())); }
    let html = page_res.text().await.unwrap_or_default();
    let (pid, payment_name) = resolve_payment_channel(pid_in, &html);

    let csrf_re = regex::Regex::new(r"'X-CSRF-TOKEN':\s*'([^']+)'").unwrap();
    let token_re = regex::Regex::new(r#"name="_token" type="hidden" value="([^"]+)""#).unwrap();
    let csrf = capture1(&html, &csrf_re);
    let token = capture1(&html, &token_re);
    let inq_re = regex::Regex::new(r#"url:\s*['"]([^'"]*inquiry[^'"]*)['"]"#).unwrap();
    let has_inquiry = inq_re.is_match(&html);

    let checkout_url: String;
    if has_inquiry {
        let (j, inq_url) = inquiry(&target, &html, &cookies, did, &pid, email, user_inputs).await?;
        let status = j.get("status").and_then(|v| v.as_str()).unwrap_or("");
        if status != "1" {
            return Err(format!("Inquiry gagal: {}", j.get("message").and_then(|v| v.as_str()).unwrap_or("Data akun atau pilihan item tidak valid")));
        }
        let inq_base = inq_url.split("/inquiry").next().unwrap_or("").to_string();
        checkout_url = format!("{}/checkout/{}", inq_base, j.get("message").and_then(|v| v.as_str()).unwrap_or(""));
    } else {
        let gameid_re1 = regex::Regex::new(r#"name="gameid"[^>]*value="([^"]+)""#).unwrap();
        let gameid_re2 = regex::Regex::new(r#"gameid\s*=\s*['"]?([0-9]+)"#).unwrap();
        let gid = capture1(&html, &gameid_re1).or_else(|| capture1(&html, &gameid_re2)).unwrap_or_else(|| "159".into());
        let body = format!("pid={}&did={}&gameid={}&email={}&offer=",
            urlencode(&pid), urlencode(did), urlencode(&gid), urlencode(email));
        let res = client().post(format!("{}/game/check-email", BASE_URL))
            .header("Cookie", cookie_header(&cookies))
                        .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                        .header("X-Requested-With", "XMLHttpRequest")
            .header("X-CSRF-TOKEN", csrf.unwrap_or_default())
            .header("Origin", BASE_URL)
            .header("Referer", &target)
            .body(body)
            .send().await.map_err(|e| e.to_string())?;
        absorb(&mut cookies, &res);
        let j: Value = res.json().await.unwrap_or(Value::Null);
        if j.get("status").and_then(|v| v.as_str()) != Some("1") {
            return Err(format!("Verifikasi email gagal: {}", j.get("message").and_then(|v| v.as_str()).unwrap_or("Periksa format email")));
        }
        checkout_url = format!("{}/game/checkout/{}/{}/{}?ifc=", BASE_URL, gid, pid, did);
    }

    let mut res = fetch_with_cookies(&checkout_url, &mut cookies).await?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        // Fallback candidates
        let candidates: Vec<String> = if has_inquiry {
            let inq_base = inq_re.captures(&html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
                .map(|u| u.split("/inquiry").next().unwrap_or("").to_string()).unwrap_or_default();
            let slug = target.replace(BASE_URL, "").trim_start_matches("/id/").trim_start_matches('/').to_string();
            let last = checkout_url.rsplit('/').next().unwrap_or("").to_string();
            vec![format!("{}/checkout/{}", inq_base, last), format!("{}/id/{}/checkout/{}", BASE_URL, slug, last), format!("{}/{}/checkout/{}", BASE_URL, slug, last)]
        } else {
            let gid_re = regex::Regex::new(r"game/checkout/([0-9]+)").unwrap();
            let gid = capture1(&html, &gid_re).unwrap_or_else(|| "159".into());
            vec![format!("{}/id/game/checkout/{}/{}/{}?ifc=", BASE_URL, gid, pid, did), format!("{}/game/checkout/{}/{}/{}?ifc=", BASE_URL, gid, pid, did)]
        };
        for alt in candidates {
            if alt == checkout_url { continue; }
            let try_res = fetch_with_cookies(&alt, &mut cookies).await?;
            if try_res.status().is_success() { res = try_res; break; }
        }
    }
    if !res.status().is_success() { return Err(format!("Gagal membuka halaman checkout ({})", res.status())); }
    let checkout_html = res.text().await.unwrap_or_default();

    let ft_re1 = regex::Regex::new(r#"name="_token"[^>]*value="([^"]*)""#).unwrap();
    let ft_re2 = regex::Regex::new(r#"value="([^"]*)"[^>]*name="_token""#).unwrap();
    let form_token = capture1(&checkout_html, &ft_re1).or_else(|| capture1(&checkout_html, &ft_re2)).unwrap_or_default();
    let fa_re = regex::Regex::new(r#"<form[^>]*action="([^"]*)"[^>]*>"#).unwrap();
    let form_action = capture1(&checkout_html, &fa_re).unwrap_or_else(|| checkout_url.split('?').next().unwrap_or("").to_string());

    let submit_body = format!("_token={}&customer_email={}&customer_tel={}&remember_me=1&ifc=",
        urlencode(&form_token), urlencode(email), urlencode(phone));
    let submit = client().post(&form_action)
        .header("Cookie", cookie_header(&cookies))
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Referer", &checkout_url)
        .header("Origin", BASE_URL)
        .body(submit_body)
        .send().await.map_err(|e| e.to_string())?;
    absorb(&mut cookies, &submit);
    let pe_location = submit.headers().get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let Some(pe_location) = pe_location else {
        return Err("Gagal melanjutkan ke payment engine UniPin".into());
    };
    if pe_location.contains("/timeout") {
        return Err("Metode pembayaran atau nominal tidak didukung untuk produk ini".into());
    }
    if pid != "522" {
        return Ok(json!({
            "type": "redirect",
            "payment_method": payment_name,
            "payment_channel_id": pid,
            "payment_url": pe_location,
            "instruction": "Buka tautan pembayaran untuk menyelesaikan transaksi."
        }));
    }

    // QRIS: follow payment engine page
    let pe_res = client().get(&pe_location)
        .header("Cookie", cookie_header(&cookies))
        .header("Referer", &checkout_url)
        .send().await.map_err(|e| e.to_string())?;
    let pe_html = pe_res.text().await.unwrap_or_default();
    let api_re1 = regex::Regex::new(r"action='([^']+)'").unwrap();
    let api_re2 = regex::Regex::new(r#"action="([^"]+)""#).unwrap();
    let p_re1 = regex::Regex::new(r"name='p'\s+value='([^']+)'").unwrap();
    let p_re2 = regex::Regex::new(r#"name="p"\s+value="([^"]+)""#).unwrap();
    let api_action = capture1(&pe_html, &api_re1).or_else(|| capture1(&pe_html, &api_re2));
    let p_val = capture1(&pe_html, &p_re1).or_else(|| capture1(&pe_html, &p_re2));
    let (Some(api_action), Some(p_val)) = (api_action, p_val) else {
        return Ok(json!({
            "type": "redirect",
            "payment_method": payment_name,
            "payment_channel_id": pid,
            "payment_url": pe_location,
            "instruction": "Buka tautan pembayaran untuk menyelesaikan transaksi."
        }));
    };
    let api_res = client().post(&api_action)
                    .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Referer", &pe_location)
        .body(format!("p={}", urlencode(&p_val)))
        .send().await.map_err(|e| e.to_string())?;
    let final_url = api_res.headers().get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok()).map(|s| s.to_string()).unwrap_or_else(|| api_action.clone());
    let mut pe_cookies = CookieMap::new();
    absorb(&mut pe_cookies, &api_res);

    if final_url.contains("doku_qris") {
        let qris_res = client().get(&final_url)
            .header("Referer", &api_action)
            .header("Cookie", cookie_header(&pe_cookies))
            .send().await.map_err(|e| e.to_string())?;
        let qris_html = qris_res.text().await.unwrap_or_default();
        let trx_re = regex::Regex::new(r#"data:\s*\{\s*id:\s*"([0-9]+)"\s*\}"#).unwrap();
        let trx_re2 = regex::Regex::new(r#"id:\s*"([0-9]+)""#).unwrap();
        let trx_id = capture1(&qris_html, &trx_re).or_else(|| capture1(&qris_html, &trx_re2));
        let container_re = regex::Regex::new(r#"width:([0-9]+)px;height:([0-9]+)px;">([\s\S]*?)</div>\s*</div>"#).unwrap();
        let mut data_url = Value::Null;
        if let Some(c) = container_re.captures(&qris_html) {
            let (w, h) = (c.get(1).map(|x| x.as_str()).unwrap_or("0"), c.get(2).map(|x| x.as_str()).unwrap_or("0"));
            let inner = c.get(3).map(|x| x.as_str()).unwrap_or("");
            let rect_re = regex::Regex::new(r"left:([0-9]+)px;top:([0-9]+)px;").unwrap();
            let mut rects = String::new();
            for m in rect_re.captures_iter(inner) {
                rects.push_str(&format!("<rect x=\"{}\" y=\"{}\" width=\"5\" height=\"5\" fill=\"#000000\"/>",
                    m.get(1).map(|x| x.as_str()).unwrap_or("0"), m.get(2).map(|x| x.as_str()).unwrap_or("0")));
            }
            let svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {} {}\" width=\"{}\" height=\"{}\"><rect width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>{}</svg>", w, h, w, h, w, h, rects);
            data_url = json!(format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())));
        }
        return Ok(json!({
            "type": "qris",
            "payment_method": payment_name,
            "payment_channel_id": pid,
            "transaction_id": trx_id,
            "payment_url": final_url,
            "qr_url": Value::Null,
            "filename": Value::Null,
            "qr_data_url": data_url,
            "check_url": trx_id.as_ref().map(|t| format!("https://www.paymentengine.online/doku_qris/redis_inquiry?id={}", t)),
            "expires_in": "3 menit",
            "expires_in_seconds": 180,
            "expires_at": (chrono::Utc::now() + chrono::Duration::milliseconds(180000)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "instruction": "Scan QRIS berikut menggunakan aplikasi m-Banking atau E-Wallet mana pun untuk menyelesaikan pembayaran."
        }));
    }
    Ok(json!({
        "type": "redirect",
        "payment_method": payment_name,
        "payment_channel_id": pid,
        "payment_url": final_url,
        "instruction": "Buka tautan pembayaran untuk menyelesaikan transaksi."
    }))
}

async fn check_payment_status(trx_id: &str) -> Result<Value, String> {
    if trx_id.is_empty() { return Err("Parameter 'trx_id' (Transaction ID DOKU QRIS) wajib diisi".into()); }
    let url = format!("https://www.paymentengine.online/doku_qris/redis_inquiry?id={}", urlencode(trx_id));
    let res = client().get(&url)
                    .header("X-Requested-With", "XMLHttpRequest")
        .send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() { return Err(format!("Gagal memeriksa status pembayaran ({})", res.status())); }
    let j: Value = res.json().await.unwrap_or(Value::Null);
    let paid = j.get("status").and_then(|v| v.as_bool()).unwrap_or(false);
    let status = if paid { "SUCCESS" } else if j.get("redis").and_then(|v| v.as_str()) == Some("valid") { "PENDING" } else { "EXPIRED_OR_FAILED" };
    Ok(json!({ "transaction_id": trx_id, "paid": paid, "status": status, "raw": j }))
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let m = merged(&query, &body);
    let get = |k: &str| str_param(&m, k).unwrap_or_default();
    let action = get("action");
    if action.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "status": false,
            "message": "Parameter 'action' wajib diisi",
            "available_actions": {
                "home": "Ambil banner promosi dan daftar game populer UniPin",
                "search": "Cari katalog game berdasarkan nama (?action=search&query=mobile+legends)",
                "detail": "Ambil denominasi (diamond/voucher), form input ID, dan channel pembayaran (?action=detail&game=garena/free-fire)",
                "check": "Validasi User ID via inquiry UniPin (?action=check&game=garena/free-fire&user_id=123)",
                "order": "Buat order topup (?action=order&game=garena/free-fire&did=238&pid=qris&user_id=123)",
                "status": "Cek status pembayaran QRIS (?action=status&trx_id=123)"
            }
        }))).into_response();
    }
    let result: Result<Value, String> = match action.as_str() {
        "home" => get_home().await,
        "search" => {
            let q = get("query");
            if q.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'query' wajib diisi untuk action=search"}))).into_response();
            }
            search_games(&q).await
        }
        "detail" => {
            let g = get("game");
            let g = if g.is_empty() { get("query") } else { g };
            if g.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'game' wajib diisi untuk action=detail"}))).into_response();
            }
            get_game_detail(&g).await
        }
        "check" => {
            let g = get("game");
            if g.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'game' wajib diisi untuk action=check"}))).into_response();
            }
            let player_id = get("user_id");
            let player_id = if player_id.is_empty() { get("player_id") } else { player_id };
            let player_id = if player_id.is_empty() { get("userid") } else { player_id };
            let player_id = if player_id.is_empty() { get("id") } else { player_id };
            if player_id.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'user_id' wajib diisi untuk action=check"}))).into_response();
            }
            let mut inputs = HashMap::new();
            inputs.insert("player_id".to_string(), player_id.clone());
            inputs.insert("playerid".to_string(), player_id.clone());
            inputs.insert("userid".to_string(), player_id);
            let zone = get("zone_id");
            if !zone.is_empty() {
                inputs.insert("zone_id".to_string(), zone.clone());
                inputs.insert("zoneid".to_string(), zone.clone());
                inputs.insert("serverid".to_string(), zone);
            }
            for (k, v) in m.as_object().into_iter().flatten() {
                if let Some(s) = v.as_str() { inputs.entry(k.clone()).or_insert_with(|| s.to_string()); }
            }
            check_id(&g, &inputs).await
        }
        "order" => {
            let g = get("game");
            let g = if g.is_empty() { get("slug") } else { g };
            if g.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'game' wajib diisi untuk action=order"}))).into_response();
            }
            let did = get("did");
            if did.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"status": false, "message": "Parameter 'did' (ID item) wajib diisi untuk action=order"}))).into_response();
            }
            let player_id = get("user_id");
            let player_id = if player_id.is_empty() { get("player_id") } else { player_id };
            let player_id = if player_id.is_empty() { get("userid") } else { player_id };
            let player_id = if player_id.is_empty() { get("id") } else { player_id };
            let mut inputs = HashMap::new();
            if !player_id.is_empty() {
                inputs.insert("player_id".to_string(), player_id.clone());
                inputs.insert("playerid".to_string(), player_id.clone());
                inputs.insert("userid".to_string(), player_id.clone());
                inputs.insert("id".to_string(), player_id);
            }
            let zone = get("zone_id");
            if !zone.is_empty() {
                inputs.insert("zone_id".to_string(), zone.clone());
                inputs.insert("zoneid".to_string(), zone.clone());
                inputs.insert("serverid".to_string(), zone);
            }
            for (k, v) in m.as_object().into_iter().flatten() {
                if let Some(s) = v.as_str() { inputs.entry(k.clone()).or_insert_with(|| s.to_string()); }
            }
            let email = { let e = get("email"); if e.is_empty() { "customer@unipin.com".to_string() } else { e } };
            let phone = { let p = get("phone"); if p.is_empty() { "081234567890".to_string() } else { p } };
            let pid = { let p = get("pid"); if p.is_empty() { "qris".to_string() } else { p } };
            create_order(&g, &did, &pid, &email, &phone, &inputs).await
        }
        "status" => {
            let t = get("trx_id");
            let t = if t.is_empty() { get("id") } else { t };
            let t = if t.is_empty() { get("orderId") } else { t };
            let t = if t.is_empty() { get("transaction_id") } else { t };
            check_payment_status(&t).await
        }
        other => {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "status": false,
                "message": format!("Action '{}' tidak valid", other),
                "available_actions": ["home", "search", "detail", "check", "order", "status"]
            }))).into_response();
        }
    };
    match result {
        Ok(r) => Json(json!({ "status": true, "action": action, "result": r })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "status": false, "message": e }))).into_response(),
    }
}

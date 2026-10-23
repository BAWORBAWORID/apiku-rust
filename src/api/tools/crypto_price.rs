use crate::state::AppState;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_SYMBOLS: &[&str] = &[
    "BTCUSD", "ETHUSD", "SOLUSD", "BNBUSD", "XRPUSD", "ADAUSD", "DOGEUSD", "AVAXUSD", "DOTUSD",
    "MATICUSD", "LTCUSD", "LINKUSD", "UNIUSD", "ATOMUSD", "TRXUSD",
];

#[derive(Debug, Deserialize)]
pub struct CryptoParams {
    pub symbol: Option<String>,
    pub symbols: Option<String>,
}

fn parse_symbol_list(raw: Option<String>) -> Vec<String> {
    match raw {
        Some(s) if !s.trim().is_empty() => s
            .split(',')
            .map(|item| {
                let mut sym = item.trim().to_uppercase();
                if !sym.ends_with("USD") && !sym.ends_with("USDT") {
                    sym = format!("{}USD", sym);
                }
                sym
            })
            .filter(|s| !s.is_empty())
            .take(30)
            .collect(),
        _ => DEFAULT_SYMBOLS.iter().map(|s| s.to_string()).collect(),
    }
}

async fn fetch_single_crypto(client: &reqwest::Client, symbol: &str) -> Value {
    let url = format!("https://www.tradingview.com/symbols/{}/", symbol);
    let resp = match client
        .get(&url)
        .header("User-Agent", UA)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
                    .header("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return json!({
                "symbol": symbol,
                "name": symbol.replace("USD", "").replace("USDT", ""),
                "price": null,
                "change_pct": null,
                "high_24h": null,
                "low_24h": null,
                "volume": null,
                "market_cap": null,
                "source": "tradingview.com"
            });
        }
    };

    let html = match resp.text().await {
        Ok(h) => h,
        Err(_) => {
            return json!({
                "symbol": symbol,
                "name": symbol.replace("USD", "").replace("USDT", ""),
                "price": null,
                "change_pct": null,
                "high_24h": null,
                "low_24h": null,
                "volume": null,
                "market_cap": null,
                "source": "tradingview.com"
            });
        }
    };

    let re_price = Regex::new(r#""(?:price|last)"\s*:\s*"?([\d.]+)"?"#).unwrap();
    let re_change = Regex::new(r#"(?:"(?:change_pct|percentChange)"\s*:\s*"?([-\d.]+)"?|class="[^"]*change[^"]*"[^>]*>([-+]?[\d.]+)%)"#).unwrap();
    let re_high = Regex::new(r#""(?:high|dayHigh)"\s*:\s*"?([\d.]+)"?"#).unwrap();
    let re_low = Regex::new(r#""(?:low|dayLow)"\s*:\s*"?([\d.]+)"?"#).unwrap();
    let re_vol = Regex::new(r#""(?:volume|volume24h)"\s*:\s*"?([\d.]+)"?"#).unwrap();
    let re_mcap = Regex::new(r#""(?:market_cap|marketCap)"\s*:\s*"?([\d]+)"?"#).unwrap();
    let re_title = Regex::new(r#"<title>([^<]+)</title>"#).unwrap();

    let price = re_price
        .captures(&html)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok());
    let change_pct = re_change
        .captures(&html)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .and_then(|m| m.as_str().parse::<f64>().ok());
    let high_24h = re_high
        .captures(&html)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok());
    let low_24h = re_low
        .captures(&html)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok());
    let volume = re_vol
        .captures(&html)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok());
    let market_cap = re_mcap
        .captures(&html)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok());

    let mut coin_name = symbol.replace("USD", "").replace("USDT", "");
    if let Some(caps) = re_title.captures(&html) {
        if let Some(t) = caps.get(1) {
            let title_str = t.as_str();
            let re_name = Regex::new(r#"^(.+?)\s*(?:—|USD|ke USD)"#).unwrap();
            if let Some(n_caps) = re_name.captures(title_str) {
                if let Some(n) = n_caps.get(1) {
                    coin_name = n.as_str().trim().to_string();
                }
            }
        }
    }

    json!({
        "symbol": symbol,
        "name": coin_name,
        "price": price,
        "change_pct": change_pct,
        "high_24h": high_24h,
        "low_24h": low_24h,
        "volume": volume,
        "market_cap": market_cap,
        "source": "tradingview.com"
    })
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<CryptoParams>,
    body: Option<Json<CryptoParams>>,
) -> impl IntoResponse {
    let client = &state.client;
    let raw_symbols = query.symbols.or(query.symbol).or_else(|| {
        body.as_ref()
            .and_then(|b| b.symbols.clone().or_else(|| b.symbol.clone()))
    });

    let symbol_list = parse_symbol_list(raw_symbols);
    let mut tasks = Vec::new();

    for sym in &symbol_list {
        tasks.push(fetch_single_crypto(client, sym));
    }

    let results = futures_util::future::join_all(tasks).await;

    let is_single = results.len() == 1;
    let single_result = results.first().cloned();

    Json(json!({
        "status": true,
        "total": results.len(),
        "data": results,
        "result": if is_single { single_result } else { None },
        "attribution": "@zyvorapi"
    })).into_response()
}

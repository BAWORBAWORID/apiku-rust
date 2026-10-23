// Crypto — native conversion of api/tools/crypto.js (fiat & crypto converter)
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::state::AppState;

const FIAT_APIS: &[&str] = &[
    "https://api.exchangerate-api.com/v4/latest/USD",
    "https://open.er-api.com/v6/latest/USD",
    "https://api.fxratesapi.com/latest?base=USD",
    "https://api.exchangerate.host/latest?base=USD",
];

async fn fetch_exchange_rates(
    client: &reqwest::Client,
) -> Result<serde_json::Map<String, Value>, String> {
    for api in FIAT_APIS {
        if let Ok(data) = client
            .get(*api)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            
            .send()
            .await
        {
            if let Ok(v) = data.json::<Value>().await {
                if let Some(rates) = v.get("rates").and_then(|r| r.as_object()) {
                    if rates.len() > 100 {
                        return Ok(rates.clone());
                    }
                }
                if let Some(d) = v.get("data").and_then(|r| r.as_object()) {
                    if d.len() > 100 {
                        return Ok(d.clone());
                    }
                }
            }
        }
    }
    Err("All fiat currency APIs failed".into())
}

async fn fetch_crypto_prices(
    client: &reqwest::Client,
) -> Result<serde_json::Map<String, Value>, String> {
    let mut prices = serde_json::Map::new();

    // Binance
    if let Ok(data) = client
        .get("https://api.binance.com/api/v3/ticker/price")
        
        .send()
        .await
    {
        if let Ok(v) = data.json::<Value>().await {
            if let Some(arr) = v.as_array() {
                for item in arr {
                    let symbol = item.get("symbol").and_then(|s| s.as_str()).unwrap_or("");
                    let price = item
                        .get("price")
                        .and_then(|p| p.as_str())
                        .and_then(|p| p.parse::<f64>().ok());
                    if let Some(p) = price {
                        if p > 0.0 {
                            if let Some(sym) = symbol
                                .strip_suffix("USDT")
                                .or_else(|| symbol.strip_suffix("BUSD"))
                            {
                                prices.insert(sym.to_string(), json!(p));
                            }
                        }
                    }
                }
            }
        }
    }

    if prices.len() <= 50 {
        // CoinGecko fallback
        if let Ok(v) = client
            .get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1")
            
            .send()
            .await
        {
            if let Ok(data) = v.json::<Value>().await {
                if let Some(arr) = data.as_array() {
                    for item in arr {
                        if let (Some(sym), Some(p)) = (
                            item.get("symbol").and_then(|s| s.as_str()),
                            item.get("current_price").and_then(|p| p.as_f64()),
                        ) {
                            prices.insert(sym.to_uppercase(), json!(p));
                        }
                    }
                }
            }
        }
    }

    if prices.is_empty() {
        return Err("All cryptocurrency APIs failed".into());
    }
    Ok(prices)
}

async fn fetch_indodax(client: &reqwest::Client) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    if let Ok(v) = client
        .get("https://indodax.com/api/ticker_all")
        
        .send()
        .await
    {
        if let Ok(data) = v.json::<Value>().await {
            if let Some(tickers) = data.get("tickers").and_then(|t| t.as_object()) {
                for (pair, info) in tickers {
                    let parts: Vec<&str> = pair.split('_').collect();
                    if parts.len() == 2 && parts[1] == "idr" {
                        if let Some(last) = info
                            .get("last")
                            .and_then(|l| l.as_str())
                            .and_then(|l| l.parse::<f64>().ok())
                        {
                            out.insert(
                                parts[0].to_uppercase(),
                                json!({
                                    "price_idr": last,
                                    "high": info.get("high").and_then(|h| h.as_str()).and_then(|h| h.parse::<f64>().ok()),
                                    "low": info.get("low").and_then(|l| l.as_str()).and_then(|l| l.parse::<f64>().ok()),
                                    "buy": info.get("buy").and_then(|b| b.as_str()).and_then(|b| b.parse::<f64>().ok()),
                                    "sell": info.get("sell").and_then(|s| s.as_str()).and_then(|s| s.parse::<f64>().ok()),
                                }),
                            );
                        }
                    }
                }
            }
        }
    }
    out
}

struct Market {
    fiat: serde_json::Map<String, Value>,
    crypto: serde_json::Map<String, Value>,
    indodax: serde_json::Map<String, Value>,
}

impl Market {
    fn is_fiat(&self, c: &str) -> bool {
        c == "USD" || self.fiat.contains_key(c)
    }
    fn is_crypto(&self, c: &str) -> bool {
        self.crypto.contains_key(c) || self.indodax.contains_key(c)
    }
    fn crypto_price(&self, c: &str) -> Option<f64> {
        if let Some(p) = self.crypto.get(c).and_then(|p| p.as_f64()) {
            return Some(p);
        }
        let idr_rate = self.fiat.get("IDR").and_then(|p| p.as_f64())?;
        self.indodax
            .get(c)
            .and_then(|d| d.get("price_idr"))
            .and_then(|p| p.as_f64())
            .map(|p| p / idr_rate)
    }
}

async fn load_market(client: &reqwest::Client) -> Result<Market, String> {
    let (fiat, crypto, indodax) = tokio::join!(
        fetch_exchange_rates(client),
        fetch_crypto_prices(client),
        fetch_indodax(client)
    );
    Ok(Market {
        fiat: fiat?,
        crypto: crypto?,
        indodax,
    })
}

pub async fn handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref().and_then(|b| b.get(k)).and_then(|v| {
                v.as_str().map(|s| s.to_string()).or_else(|| {
                    if v.is_null() {
                        None
                    } else {
                        Some(v.to_string())
                    }
                })
            })
        })
    };

    let action =
        match get("action") {
            Some(a) => a,
            None => return Json(json!({
                "status": false,
                "message": "Parameter 'action' wajib diisi. Pilihan: convert, market, currencies"
            }))
            .into_response(),
        };

    if !["convert", "market", "currencies"].contains(&action.as_str()) {
        return Json(json!({
            "status": false,
            "message": format!("Invalid action '{}'. Pilihan: convert, market, currencies", action)
        }))
        .into_response();
    }

    let start = std::time::Instant::now();
    let client = &state.client;

    if action == "convert" {
        let amount = match get("amount") {
            Some(a) => a,
            None => return Json(json!({"status": false, "message": "Parameter 'amount' wajib diisi untuk action=convert"})).into_response(),
        };
        let from = match get("from") {
            Some(f) => f,
            None => return Json(json!({"status": false, "message": "Parameter 'from' wajib diisi untuk action=convert"})).into_response(),
        };
        let to = match get("to") {
            Some(t) => t,
            None => return Json(json!({"status": false, "message": "Parameter 'to' wajib diisi untuk action=convert"})).into_response(),
        };

        let amount_num: f64 = match amount.trim().parse() {
            Ok(a) if a > 0.0 => a,
            _ => {
                return Json(json!({"status": false, "message": "Invalid amount"})).into_response()
            }
        };

        let market = match load_market(client).await {
            Ok(m) => m,
            Err(e) => return Json(json!({"status": false, "message": e})).into_response(),
        };

        let from_u = from.to_uppercase();
        let to_u = to.to_uppercase();

        let fiat_f = market.is_fiat(&from_u);
        let fiat_t = market.is_fiat(&to_u);
        let crypto_f = market.is_crypto(&from_u);
        let crypto_t = market.is_crypto(&to_u);

        if !fiat_f && !crypto_f {
            return Json(
                json!({"status": false, "message": format!("Currency {} not found", from_u)}),
            )
            .into_response();
        }
        if !fiat_t && !crypto_t {
            return Json(
                json!({"status": false, "message": format!("Currency {} not found", to_u)}),
            )
            .into_response();
        }

        let rate_of = |c: &str| -> Option<f64> {
            if c == "USD" {
                Some(1.0)
            } else {
                market.fiat.get(c).and_then(|v| v.as_f64())
            }
        };

        let converted = if fiat_f && fiat_t {
            rate_of(&from_u).and_then(|fr| rate_of(&to_u).map(|tr| (amount_num / fr) * tr))
        } else if fiat_f && crypto_t {
            rate_of(&from_u).and_then(|fr| market.crypto_price(&to_u).map(|cp| (amount_num / fr) / cp))
        } else if crypto_f && fiat_t {
            market.crypto_price(&from_u).and_then(|cp| rate_of(&to_u).map(|tr| amount_num * cp * tr))
        } else if crypto_f && crypto_t {
            market.crypto_price(&from_u).and_then(|fp| market.crypto_price(&to_u).map(|tp| (amount_num * fp) / tp))
        } else {
            None
        };

        match converted {
            Some(result) => {
                return Json(json!({
                    "status": true,
                    "result": {
                        "amount": amount_num,
                        "from": from_u,
                        "to": to_u,
                        "result": result,
                        "rate": result / amount_num,
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    },
                    "responseTime": format!("{}ms", start.elapsed().as_millis()),
                }))
                .into_response();
            }
            None => {
                return Json(json!({
                    "status": false,
                    "message": format!("Could not get prices for crypto {} or {}", from_u, to_u)
                }))
                .into_response();
            }
        }
    }

    let market = match load_market(client).await {
        Ok(m) => m,
        Err(e) => return Json(json!({"status": false, "message": e})).into_response(),
    };

    if action == "currencies" {
        let mut fiat: Vec<String> = vec!["USD".into()];
        fiat.extend(market.fiat.keys().cloned());
        fiat.sort();
        let mut crypto: Vec<String> = market.crypto.keys().cloned().collect();
        crypto.extend(market.indodax.keys().cloned());
        crypto.sort();
        crypto.dedup();
        let total = fiat.len() + crypto.len();
        return Json(json!({
            "status": true,
            "result": {
                "fiat": fiat,
                "crypto": crypto,
                "total": total,
                "fiat_count": fiat.len(),
                "crypto_count": crypto.len(),
            },
            "responseTime": format!("{}ms", start.elapsed().as_millis()),
        }))
        .into_response();
    }

    // action == "market"
    let mut fiat_rates = serde_json::Map::new();
    fiat_rates.insert("USD".to_string(), json!(1.0));
    for (k, v) in &market.fiat {
        fiat_rates.insert(k.clone(), v.clone());
    }
    Json(json!({
        "status": true,
        "result": {
            "fiat_rates": fiat_rates,
            "crypto_prices": market.crypto,
            "indodax_data": market.indodax,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        },
        "responseTime": format!("{}ms", start.elapsed().as_millis()),
    })).into_response()

}

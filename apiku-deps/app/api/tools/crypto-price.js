/**
 * Crypto Price — TradingView Scraper
 * Harga real-time cryptocurrency dari TradingView
 * Support custom coin symbol (BTC, ETH, PEPE, SHIB, dll)
 *
 * GET /api/tools/crypto-price?symbols=BTC,ETH,TRX
 * GET /api/tools/crypto-price?symbols=PEPE&list=default
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

const DEFAULT_SYMBOLS = [
  { symbol: "BTCUSD", name: "Bitcoin" },
  { symbol: "ETHUSD", name: "Ethereum" },
  { symbol: "SOLUSD", name: "Solana" },
  { symbol: "BNBUSD", name: "BNB" },
  { symbol: "XRPUSD", name: "Ripple" },
  { symbol: "ADAUSD", name: "Cardano" },
  { symbol: "DOGEUSD", name: "Dogecoin" },
  { symbol: "AVAXUSD", name: "Avalanche" },
  { symbol: "DOTUSD", name: "Polkadot" },
  { symbol: "MATICUSD", name: "Polygon" },
  { symbol: "LTCUSD", name: "Litecoin" },
  { symbol: "LINKUSD", name: "Chainlink" },
  { symbol: "UNIUSD", name: "Uniswap" },
  { symbol: "ATOMUSD", name: "Cosmos" },
  { symbol: "TRXUSD", name: "TRON" },
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

// ── Cache ──
const cache = new Map();
const CACHE_TTL = 60_000; // 1 menit

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() < item.expires) return item.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

// ── Scraper ──
async function fetchPrice(symbol) {
  const cacheKey = `price:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://www.tradingview.com/symbols/${symbol}/`;
  const res = await axios.get(url, { headers: HEADERS, timeout: 15_000 });
  const html = res.data;

  // Extract price from various patterns
  const priceMatch =
    html.match(/"price"\s*:\s*"?([\d.]+)"?/) ||
    html.match(/"last"\s*:\s*"?([\d.]+)"?/) ||
    html.match(/class="[^"]*lastPrice[^"]*"[^>]*>([\d,.]+)/) ||
    html.match(/\"close\"\s*:\s*\"?([\d.]+)/);

  // Extract title for coin name
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);

  // Try to extract change percentage
  const changeMatch =
    html.match(/"change_pct"\s*:\s*"?([-\d.]+)"?/) ||
    html.match(/"percentChange"\s*:\s*"?([-\d.]+)"?/) ||
    html.match(/class="[^"]*change[^"]*"[^>]*>([-+]?[\d.]+)%/);

  // Try to extract high/low
  const highMatch =
    html.match(/"high"\s*:\s*"?([\d.]+)"?/) ||
    html.match(/"dayHigh"\s*:\s*"?([\d.]+)"?/);
  const lowMatch =
    html.match(/"low"\s*:\s*"?([\d.]+)"?/) ||
    html.match(/"dayLow"\s*:\s*"?([\d.]+)"?/);

  // Extract volume
  const volumeMatch =
    html.match(/"volume"\s*:\s*"?([\d.]+)"?/) ||
    html.match(/"volume24h"\s*:\s*"?([\d.]+)"?/);

  // Extract market cap
  const mcapMatch =
    html.match(/"market_cap"\s*:\s*"?([\d]+)"?/) ||
    html.match(/"marketCap"\s*:\s*"?([\d]+)"?/);

  // Parse coin name from title
  let coinName = symbol.replace("USD", "");
  if (titleMatch) {
    const title = titleMatch[1];
    // Try to extract name before " — " or " USD"
    const nameMatch = title.match(/^(.+?)\s*(?:—|USD|ke USD)/i);
    if (nameMatch) coinName = nameMatch[1].trim();
  }

  const result = {
    symbol,
    name: coinName,
    price: priceMatch ? parseFloat(priceMatch[1]) : null,
    change_pct: changeMatch ? parseFloat(changeMatch[1]) : null,
    high_24h: highMatch ? parseFloat(highMatch[1]) : null,
    low_24h: lowMatch ? parseFloat(lowMatch[1]) : null,
    volume: volumeMatch ? parseFloat(volumeMatch[1]) : null,
    market_cap: mcapMatch ? parseFloat(mcapMatch[1]) : null,
    source: "tradingview.com",
  };

  setCache(cacheKey, result);
  return result;
}

// ── Parse symbols from input ──
function parseSymbols(input) {
  if (!input) return DEFAULT_SYMBOLS.map((s) => s.symbol);

  return input
    .split(",")
    .map((s) => {
      s = s.trim().toUpperCase();
      // Auto-append USD if only coin symbol given
      if (!s.endsWith("USD")) {
        // Check if it's a known symbol
        const known = DEFAULT_SYMBOLS.find(
          (d) => d.symbol === s || d.symbol === s + "USD"
        );
        if (known) return known.symbol;
        return s + "USD";
      }
      return s;
    })
    .filter(Boolean);
}

// ── Endpoint ──
export default {
  name: "Crypto Price",
  description:
    "Harga real-time cryptocurrency — support custom coin symbol (BTC, ETH, PEPE, SHIB, dll)",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["symbols"],
  paramsSchema: {
    symbols: {
      type: "string",
      required: false,
      description:
        "Comma-separated coin symbols (auto-append USD). Contoh: BTC,ETH,TRX,PEPE,SHIB. Kosongkan untuk default 15 coin.",
      example: "BTC,ETH,TRX",
    },
  },

  async run(req, res) {
    const { symbols } = { ...req.query, ...req.body };

    try {
      const symbolList = parseSymbols(symbols);
      const limit = Math.min(symbolList.length, 50); // max 50
      const toFetch = symbolList.slice(0, limit);

      const results = [];
      const errors = [];

      for (const sym of toFetch) {
        try {
          const data = await fetchPrice(sym);
          results.push(data);
        } catch (err) {
          errors.push({ symbol: sym, error: err.message });
        }
        // Small delay to avoid rate limit
        if (toFetch.length > 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      return res.json({
        status: true,
        total: results.length,
        errors: errors.length > 0 ? errors : undefined,
        data: results,
      });
    } catch (err) {
      logger.error(`[CryptoPrice] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to fetch crypto prices",
      });
    }
  },
};

/**
 * Crypto & Fiat Currency Converter
 * Supports: fiat-to-fiat, fiat-to-crypto, crypto-to-fiat, crypto-to-crypto
 * Data sources: ExchangeRate-API, Open ER API, Binance, CoinGecko, Indodax
 *
 * GET  /api/tools/crypto?action=convert&amount=1&from=USD&to=BTC
 * POST /api/tools/crypto
 *
 * Actions:
 *   - convert   : Convert between currencies
 *   - market    : Get all market data (rates + prices)
 *   - currencies: Get list of supported currencies
 */

import axios from "axios";

class UniversalConverter {
  constructor() {
    this.exchangeRates = {};
    this.cryptoPrices = {};
    this.indodaxData = {};
  }

  async httpRequest(url, timeout = 8000) {
    try {
      const response = await axios.get(url, {
        timeout,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`API request failed: ${error.message}`);
    }
  }

  async fetchExchangeRates() {
    const apis = [
      "https://api.exchangerate-api.com/v4/latest/USD",
      "https://open.er-api.com/v6/latest/USD",
      "https://api.fxratesapi.com/latest?base=USD",
      "https://api.exchangerate.host/latest?base=USD",
    ];
    for (const api of apis) {
      try {
        const data = await this.httpRequest(api, 5000);
        if (data.rates && Object.keys(data.rates).length > 100) {
          this.exchangeRates = data.rates;
          return true;
        }
        if (data.data && Object.keys(data.data).length > 100) {
          this.exchangeRates = data.data;
          return true;
        }
      } catch (error) {
        continue;
      }
    }
    throw new Error("All fiat currency APIs failed");
  }

  async fetchCryptoPrices() {
    const endpoints = [
      async () => {
        const data = await this.httpRequest("https://api.binance.com/api/v3/ticker/price", 6000);
        if (Array.isArray(data)) {
          return data.filter((item) => item.symbol.endsWith("USDT"));
        }
        return [];
      },
      async () => {
        return await this.httpRequest(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1",
          8000
        );
      },
    ];
    this.cryptoPrices = {};
    for (const endpoint of endpoints) {
      try {
        const data = await endpoint();
        if (Array.isArray(data)) {
          if (data[0] && data[0].symbol && data[0].symbol.includes("USDT")) {
            data.forEach((item) => {
              if (item.symbol && item.price) {
                const symbol = item.symbol.replace("USDT", "").replace("BUSD", "");
                const price = parseFloat(item.price);
                if (price > 0) {
                  this.cryptoPrices[symbol] = price;
                }
              }
            });
          } else if (data[0] && data[0].current_price) {
            data.forEach((item) => {
              if (item.symbol && item.current_price) {
                this.cryptoPrices[item.symbol.toUpperCase()] = parseFloat(item.current_price);
              }
            });
          }
        }
        if (Object.keys(this.cryptoPrices).length > 50) {
          break;
        }
      } catch (error) {
        continue;
      }
    }
    if (Object.keys(this.cryptoPrices).length === 0) {
      throw new Error("All cryptocurrency APIs failed");
    }
  }

  async fetchIndodaxData() {
    try {
      const data = await this.httpRequest("https://indodax.com/api/ticker_all", 5000);
      this.indodaxData = {};
      if (data && data.tickers) {
        for (const [pair, info] of Object.entries(data.tickers)) {
          const [crypto, fiat] = pair.split("_");
          if (fiat === "idr" && info.last) {
            this.indodaxData[crypto.toUpperCase()] = {
              price_idr: parseFloat(info.last),
              high: parseFloat(info.high),
              low: parseFloat(info.low),
              volume: parseFloat(info[`vol_${crypto}`]),
              buy: parseFloat(info.buy),
              sell: parseFloat(info.sell),
            };
          }
        }
      }
    } catch (error) {
      this.indodaxData = {};
    }
  }

  async getAllData() {
    await Promise.all([
      this.fetchExchangeRates(),
      this.fetchCryptoPrices(),
      this.fetchIndodaxData(),
    ]);
  }

  isCrypto(currency) {
    currency = currency.toUpperCase();
    return this.cryptoPrices.hasOwnProperty(currency) || this.indodaxData.hasOwnProperty(currency);
  }

  isFiat(currency) {
    currency = currency.toUpperCase();
    return currency === "USD" || this.exchangeRates.hasOwnProperty(currency);
  }

  getCryptoPrice(currency) {
    currency = currency.toUpperCase();
    if (this.cryptoPrices[currency]) {
      return this.cryptoPrices[currency];
    }
    if (this.indodaxData[currency] && this.exchangeRates.IDR) {
      return this.indodaxData[currency].price_idr / this.exchangeRates.IDR;
    }
    return null;
  }

  async convert(amount, fromCurrency, toCurrency) {
    await this.getAllData();
    fromCurrency = fromCurrency.toUpperCase();
    toCurrency = toCurrency.toUpperCase();

    if (!amount || isNaN(amount) || amount <= 0) {
      throw new Error("Invalid amount");
    }
    const amountNum = parseFloat(amount.toString());

    if (!this.isFiat(fromCurrency) && !this.isCrypto(fromCurrency)) {
      throw new Error(`Currency ${fromCurrency} not found`);
    }
    if (!this.isFiat(toCurrency) && !this.isCrypto(toCurrency)) {
      throw new Error(`Currency ${toCurrency} not found`);
    }

    let convertedAmount = 0;

    if (this.isFiat(fromCurrency) && this.isFiat(toCurrency)) {
      const fromRate = fromCurrency === "USD" ? 1 : this.exchangeRates[fromCurrency];
      const toRate = toCurrency === "USD" ? 1 : this.exchangeRates[toCurrency];
      convertedAmount = (amountNum / fromRate) * toRate;
    } else if (this.isFiat(fromCurrency) && this.isCrypto(toCurrency)) {
      const fromRate = fromCurrency === "USD" ? 1 : this.exchangeRates[fromCurrency];
      const cryptoPrice = this.getCryptoPrice(toCurrency);
      if (!cryptoPrice) {
        throw new Error(`Could not get price for crypto ${toCurrency}`);
      }
      const usdAmount = amountNum / fromRate;
      convertedAmount = usdAmount / cryptoPrice;
    } else if (this.isCrypto(fromCurrency) && this.isFiat(toCurrency)) {
      const cryptoPrice = this.getCryptoPrice(fromCurrency);
      if (!cryptoPrice) {
        throw new Error(`Could not get price for crypto ${fromCurrency}`);
      }
      const toRate = toCurrency === "USD" ? 1 : this.exchangeRates[toCurrency];
      const usdAmount = amountNum * cryptoPrice;
      convertedAmount = usdAmount * toRate;
    } else if (this.isCrypto(fromCurrency) && this.isCrypto(toCurrency)) {
      const fromPrice = this.getCryptoPrice(fromCurrency);
      const toPrice = this.getCryptoPrice(toCurrency);
      if (!fromPrice || !toPrice) {
        throw new Error(`Could not get prices for crypto ${fromCurrency} or ${toCurrency}`);
      }
      convertedAmount = (amountNum * fromPrice) / toPrice;
    }

    return {
      amount: amountNum,
      from: fromCurrency,
      to: toCurrency,
      result: convertedAmount,
      rate: convertedAmount / amountNum,
      timestamp: new Date().toISOString(),
    };
  }

  async getSupportedCurrencies() {
    await this.getAllData();
    const fiat = ["USD", ...Object.keys(this.exchangeRates)].sort();
    const crypto = [...Object.keys(this.cryptoPrices), ...Object.keys(this.indodaxData)].sort();
    const uniqueCrypto = [...new Set(crypto)];
    return {
      fiat: fiat,
      crypto: uniqueCrypto,
      total: fiat.length + uniqueCrypto.length,
      fiat_count: fiat.length,
      crypto_count: uniqueCrypto.length,
    };
  }

  async getMarketData() {
    await this.getAllData();
    return {
      fiat_rates: { USD: 1, ...this.exchangeRates },
      crypto_prices: this.cryptoPrices,
      indodax_data: this.indodaxData,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── ENDPOINT ────────────────────────────────────────────────

export default {
  name: "Crypto & Fiat Converter",
  description:
    "Konversi mata uang fiat dan cryptocurrency — support fiat-to-fiat, fiat-to-crypto, crypto-to-fiat, crypto-to-crypto.",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["action", "amount", "from", "to"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["convert", "market", "currencies"],
      description: "Aksi yang akan dijalankan: convert, market, atau currencies",
      example: "convert",
    },
    amount: {
      type: "number",
      required: false,
      description: "Jumlah yang akan dikonversi (required untuk action=convert)",
      example: 1,
    },
    from: {
      type: "string",
      required: false,
      description: "Mata uang asal (required untuk action=convert). Contoh: USD, BTC, IDR",
      example: "USD",
    },
    to: {
      type: "string",
      required: false,
      description: "Mata uang tujuan (required untuk action=convert). Contoh: BTC, IDR, ETH",
      example: "BTC",
    },
  },

  async run(req, res) {
    try {
      const { action, amount, from, to } = { ...req.query, ...req.body };

      if (!action) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' wajib diisi. Pilihan: convert, market, currencies",
        });
      }

      const validActions = ["convert", "market", "currencies"];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          status: false,
          message: `Invalid action '${action}'. Pilihan: ${validActions.join(", ")}`,
        });
      }

      const converter = new UniversalConverter();
      const startTime = Date.now();

      if (action === "convert") {
        if (!amount) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'amount' wajib diisi untuk action=convert",
          });
        }
        if (!from) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'from' wajib diisi untuk action=convert",
          });
        }
        if (!to) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'to' wajib diisi untuk action=convert",
          });
        }

        const result = await converter.convert(parseFloat(amount), from, to);
        return res.json({
          status: true,
          result,
          responseTime: `${Date.now() - startTime}ms`,
        });
      }

      if (action === "market") {
        const result = await converter.getMarketData();
        return res.json({
          status: true,
          result,
          responseTime: `${Date.now() - startTime}ms`,
        });
      }

      if (action === "currencies") {
        const result = await converter.getSupportedCurrencies();
        return res.json({
          status: true,
          result,
          responseTime: `${Date.now() - startTime}ms`,
        });
      }
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message || "Failed to process request",
      });
    }
  },
};

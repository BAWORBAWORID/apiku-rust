/**
 * Random Anime Quotes API - Get random anime quotes
 * 
 * GET /api/random/quotesanime
 * 
 * result: 
 * - JSON response dengan random quote anime (205 koleksi)
 */

import logger from "../../src/utils/logger.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUOTES_FILE = path.join(__dirname, "assets", "quotesanime.json");

// Simple in-memory cache (baca dari file lokal, tidak perlu network)
let _cache = null;

function loadQuotes() {
    if (_cache) return _cache;

    const raw = readFileSync(QUOTES_FILE, "utf-8");
    const data = JSON.parse(raw);

    const list = Array.isArray(data) ? data
        : Array.isArray(data.quotes) ? data.quotes
        : Array.isArray(data.result) ? data.result
        : Array.isArray(data.data) ? data.data
        : [];

    if (!list.length) throw new Error("Data quotes kosong");

    _cache = list;
    return list;
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Random Anime Quotes",
    description: "Get random anime quotes dari koleksi 205+ quotes anime",
    category: "Random",
    methods: ["GET"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        try {
            const quotes = loadQuotes();
            const idx = Math.floor(Math.random() * quotes.length);
            const selected = quotes[idx];

            logger.info(
                `[QUOTESANIME] Success | ip=${req.ip} | ` +
                `idx=${idx} | total=${quotes.length} | ` +
                `anime="${selected.anime}" | char="${selected.character}"`
            );

            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");

            return res.json({
                status: true,
                result: {
                    quotes: selected.quote || selected.text || selected.kata || null,
                    karakter: selected.character || selected.char || selected.tokoh || null,
                    anime: selected.anime || selected.title || selected.source || null
                }
            });

        } catch (err) {
            logger.error(`[QUOTESANIME] Error | ip=${req.ip} | message=${err.message}`);

            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan quotes anime random",
                attribution: "@zyvorapi"
            });
        }
    },
};

/**
 * ApkCombo Search API
 * GET /api/search/apkcombo?query=whatsapp
 * POST /api/search/apkcombo
 */

import axios from "axios";
import * as cheerio from "cheerio";

const BASE = "https://apkcombo.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: `${BASE}/id/`,
};

function parseAppText(raw) {
  if (!raw) return {};

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const name = lines[0] || null;

  let developer = null;
  let category = null;
  let installs = null;
  let rating = null;
  let size = null;

  for (const line of lines) {
    if (line.includes("·")) {
      const parts = line.split("·").map((p) => p.trim());
      if (parts.length >= 2) {
        developer = parts[0];
        category = parts[1];
      }
    }

    const ratingMatch = line.match(/([\d,\.]+|N\/A)\s*★/);
    if (ratingMatch) rating = ratingMatch[1];

    const sizeMatch = line.match(/([\d\.,]+\s*(?:MB|GB|KB))/i);
    if (sizeMatch) size = sizeMatch[1];

    const instMatch = line.match(/([\d\.,]+\s*(?:M|jt|rb|K)\+)/i);
    if (instMatch) installs = instMatch[1];
  }

  return { name, developer, category, installs, rating, size };
}

async function apkcomboSearch(query) {
  if (!query) throw new Error("query wajib diisi");

  const url = `${BASE}/id/search/${encodeURIComponent(query)}`;

  const { data, status } = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (status !== 200) throw new Error(`HTTP ${status}`);

  const $ = cheerio.load(data);
  const results = [];
  const seen = new Set();

  $("a").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";

    if (!/^\/id\/[^\/]+\/[^\/]+\/?$/.test(href)) return;
    if (/\/(topic|search|how-to-install)\//i.test(href)) return;

    const fullLink = BASE + href;
    if (seen.has(fullLink)) return;
    seen.add(fullLink);

    const rawText = $a.text();
    const info = parseAppText(rawText);

    if (!info.name || !info.developer || !info.category) return;

    let icon =
      $a.find("img").attr("data-src") ||
      $a.find("img").attr("src") ||
      null;

    if (icon && (icon.endsWith("/1.gif") || icon.includes("placeholder"))) {
      icon = null;
    }
    if (icon && !icon.startsWith("http")) icon = BASE + icon;

    results.push({
      name: info.name,
      developer: info.developer,
      category: info.category,
      installs: info.installs,
      rating: info.rating,
      size: info.size,
      icon,
      link: fullLink,
    });
  });

  return results;
}

export default {
  name: "ApkCombo Search",
  description: "Cari aplikasi dan game Android di ApkCombo",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian aplikasi / game",
      example: "whatsapp",
    },
  },

  async run(req, res) {
    try {
      const { query } = { ...req.query, ...req.body };

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        });
      }

      const cleanQuery = query.trim();
      const results = await apkcomboSearch(cleanQuery);

      return res.json({
        status: true,
        query: cleanQuery,
        total: results.length,
        result: results,
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mencari di ApkCombo",
      });
    }
  },
};

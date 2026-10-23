/**
 * DuckDuckGo Search API
 * GET  /api/search/duckduckgo?query=Indonesia&max=10&region=wt-wt
 * POST /api/search/duckduckgo
 */

import logger from "../../src/utils/logger.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decodeHtml(text = "") {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/\s+/g, " ")
    .trim();
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function unwrapDdgUrl(url) {
  if (!url) return url;
  const m = url.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* keep */
    }
  }
  const m2 = url.match(/\/l\/\?[^"]*uddg=([^&"]+)/);
  if (m2) {
    try {
      return decodeURIComponent(m2[1]);
    } catch {
      /* keep */
    }
  }
  return url;
}

function parseResults(html) {
  const results = [];
  const seen = new Set();

  // Pattern 1: div.result (html.duckduckgo.com)
  const blocks = html.split(/<div[^>]*class="[^"]*result\s[^"]*"[^>]*>/i).slice(1);

  for (const block of blocks) {
    const titleMatch =
      block.match(
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
      ) ||
      block.match(
        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );

    if (!titleMatch) continue;

    let url = unwrapDdgUrl(titleMatch[1]);
    const title = decodeHtml(titleMatch[2].replace(/<[^>]+>/g, ""));

    const snippetMatch =
      block.match(
        /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
      ) ||
      block.match(
        /<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i
      );

    const description = snippetMatch
      ? decodeHtml(snippetMatch[1].replace(/<[^>]+>/g, ""))
      : "";

    const faviconMatch = block.match(
      /src="(\/\/external-content\.duckduckgo\.com\/ip3\/[^"]+)"/i
    );
    const favicon = faviconMatch
      ? "https:" + faviconMatch[1]
      : undefined;

    if (
      title &&
      url &&
      url.startsWith("http") &&
      !url.includes("duckduckgo.com") &&
      !seen.has(url)
    ) {
      seen.add(url);
      results.push({
        title,
        url,
        description,
        domain: extractDomain(url),
        ...(favicon && { favicon }),
      });
    }
  }

  // Pattern 2: Fallback (lite.duckduckgo.com)
  if (results.length === 0) {
    const links = [
      ...html.matchAll(
        /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
      ),
    ];

    for (const m of links) {
      let url = unwrapDdgUrl(m[1]);
      const title = decodeHtml(m[2].replace(/<[^>]+>/g, ""));

      if (
        title &&
        url &&
        url.startsWith("http") &&
        !url.includes("duckduckgo.com") &&
        !seen.has(url)
      ) {
        seen.add(url);
        results.push({
          title,
          url,
          description: "",
          domain: extractDomain(url),
        });
      }
    }
  }

  return results.map((r, i) => ({
    position: i + 1,
    ...r,
  }));
}

async function searchDuckDuckGo(query, opts = {}) {
  const { maxResults = 10, region = "wt-wt", signal } = opts;

  if (!query || typeof query !== "string") {
    throw new Error("query harus berupa string non-kosong");
  }

  const params = new URLSearchParams({
    q: query,
    kl: region,
  });

  const endpoints = [
    `https://html.duckduckgo.com/html/?${params}`,
    `https://lite.duckduckgo.com/lite/?${params}`,
  ];

  let lastError;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
          Referer: "https://duckduckgo.com/",
        },
        signal,
        redirect: "follow",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();

      if (
        html.includes("anomaly-modal") ||
        html.includes("Unfortunately, bots use DuckDuckGo") ||
        html.includes("challenge-form")
      ) {
        throw new Error(
          "DuckDuckGo menampilkan verifikasi bot. Silakan coba kembali beberapa saat lagi."
        );
      }

      const parsed = parseResults(html);
      if (parsed.length > 0) {
        return parsed.slice(0, maxResults);
      }

      lastError = new Error("Tidak ada hasil yang ditemukan dari DuckDuckGo");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("Gagal mengambil hasil pencarian dari DuckDuckGo");
}

export default {
  name: "DuckDuckGo Search",
  description: "Search the web using DuckDuckGo — returns titles, links, snippets, domains, and favicons",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "max", "region"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian web (bisa juga via param 'q')",
      example: "Indonesia",
    },
    max: {
      type: "number",
      required: false,
      default: 10,
      description: "Jumlah maksimal hasil pencarian (1-50)",
      example: 10,
    },
    region: {
      type: "string",
      required: false,
      default: "wt-wt",
      description: "Kode wilayah pencarian (wt-wt: Worldwide, id-id: Indonesia, us-en: US, dll)",
      example: "wt-wt",
    },
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      const q = req.query?.query || req.body?.query || req.query?.q || req.body?.q;
      const maxParam = req.query?.max || req.body?.max || req.query?.maxResults || req.body?.maxResults;
      const regionParam = req.query?.region || req.body?.region || "wt-wt";

      if (!q || typeof q !== "string" || q.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' (atau 'q') wajib diisi",
        });
      }

      const cleanQuery = q.trim();
      const maxResults = Math.min(Math.max(parseInt(maxParam, 10) || 10, 1), 50);
      const cleanRegion = String(regionParam || "wt-wt").trim().toLowerCase();

      logger.info(`[DuckDuckGo] Searching for "${cleanQuery}" (region: ${cleanRegion}, max: ${maxResults})`);

      const results = await searchDuckDuckGo(cleanQuery, {
        maxResults,
        region: cleanRegion,
      });

      const duration = Date.now() - startTime;

      return res.json({
        status: true,
        query: cleanQuery,
        engine: "duckduckgo",
        region: cleanRegion,
        total: results.length,
        result: results,
        metadata: {
          processing_time: `${duration}ms`,
        },
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[DuckDuckGo] Error: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal melakukan pencarian DuckDuckGo",
        metadata: {
          processing_time: `${duration}ms`,
        },
      });
    }
  },
};

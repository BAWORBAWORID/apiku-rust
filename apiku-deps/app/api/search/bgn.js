/**
 * Badan Gizi Nasional (BGN) / Makan Bergizi Gratis (MBG) Scraper
 * Base: https://bgn.go.id
 * Fitur: Scrape homepage (hero, pinned news, kolaborasi, sasaran),
 *        berita internal BGN, berita media nasional, kolaborasi, dan sasaran program.
 */

import { execFileSync } from "node:child_process";
import logger from "../../src/utils/logger.js";

const BASE = "https://bgn.go.id";
const UA =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function curl(url) {
  try {
    return execFileSync(
      "curl",
      [
        "-k",
        "-sL",
        "--compressed",
        "--max-time",
        "60",
        "-H",
        `User-Agent: ${UA}`,
        "-H",
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H",
        "Accept-Language: id-ID,id;q=0.9,en;q=0.8",
        "-H",
        `Referer: ${BASE}/`,
        url,
      ],
      { maxBuffer: 50 * 1024 * 1024 }
    ).toString("utf8");
  } catch (err) {
    throw new Error(`Gagal fetch URL via curl (${url}): ${err.message}`);
  }
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8230;/g, "…")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .trim();
}

function stripTags(s) {
  return decodeEntities((s || "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(arr, key = "url") {
  const seen = new Set();
  return arr.filter((x) => {
    const k = x[key];
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseHero(html) {
  const out = [];
  const blocks = html.split(/<article class="relative w-full flex-shrink-0/).slice(1);

  for (const block of blocks) {
    const ytMatch = block.match(/data-video-id="([^"]+)"/);
    const imgMatch = block.match(/<img src="([^"]+)"[^>]*class="[^"]*object-cover[^"]*"/);
    const titleMatch = block.match(/<h1[^>]*>([^<]*)<\/h1>/);
    const subMatch = block.match(/<p class="text-base text-gray-200[^>]*>([^<]*)<\/p>/);

    out.push({
      youtube_id: ytMatch ? ytMatch[1] : null,
      youtube_url: ytMatch ? `https://www.youtube.com/watch?v=${ytMatch[1]}` : null,
      image_mobile: imgMatch ? imgMatch[1] : null,
      title: titleMatch ? stripTags(titleMatch[1]) : null,
      subtitle: subMatch ? stripTags(subMatch[1]) : null,
    });
  }

  return out;
}

function parsePinnedNews(html) {
  const out = [];
  const blocks = html.split(/<a class="min-w-full h-full relative"/).slice(1);

  for (const block of blocks) {
    const hrefMatch = block.match(/href="([^"]+)"/);
    const imgMatch = block.match(/<img src="([^"]+)"/);
    const titleMatch = block.match(/<h3[^>]*>([^<]+)<\/h3>/);

    if (hrefMatch && titleMatch) {
      out.push({
        title: stripTags(titleMatch[1]),
        url: hrefMatch[1].startsWith("http") ? hrefMatch[1] : BASE + hrefMatch[1],
        thumbnail: imgMatch ? imgMatch[1] : null,
      });
    }
  }

  return dedupe(out, "url");
}

function parseNews(html, filter = "internal") {
  const out = [];
  const blocks = html.split(/<div class="fade-up"/).slice(1);

  for (const block of blocks) {
    const hrefMatch = block.match(/<a href="([^"]+)"/);
    if (!hrefMatch) continue;

    let url = hrefMatch[1];
    if (!url.startsWith("http")) url = BASE + url;

    // Filter internal vs nasional
    const isInternal =
      url.startsWith("https://bgn.go.id") || url.startsWith("https://www.bgn.go.id");
    if (filter === "internal" && !isInternal) continue;
    if (filter === "nasional" && isInternal) continue;

    // Thumbnail
    const imgMatch = block.match(/<img src="([^"]+)"/);

    // Title
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);

    // Metadata (source + date)
    const pMatch = block.match(/<p class="text-base text-gray-600[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    let source = null,
      date = null;
    if (pMatch) {
      const text = stripTags(pMatch[1]);
      const parts = text.split("•").map((s) => s.trim());
      source = parts[0] || null;
      date = parts[1] || null;
    }

    // Source alternatif dari span.text-gold
    const goldMatch = block.match(/<span class="font-semibold text-gold"[^>]*>([^<]+)<\/span>/);
    if (goldMatch && !source) source = stripTags(goldMatch[1]);

    if (titleMatch && url) {
      out.push({
        title: stripTags(titleMatch[1]),
        url,
        thumbnail: imgMatch ? imgMatch[1] : null,
        source,
        date,
      });
    }
  }

  return dedupe(out, "url");
}

function parseKolaborasi(html) {
  const out = [];
  const matches = [...html.matchAll(/<img src="(\/logo_instansi\/[^"]+)"[^>]+alt="([^"]*)"/g)];

  for (const m of matches) {
    out.push({
      name: m[2],
      logo: BASE + m[1],
    });
  }

  return dedupe(out, "logo");
}

function parseSasaran(html) {
  const out = [];
  const blocks = html.split(/<div class="group min-w-\[256px\] max-h-96/).slice(1);

  for (const block of blocks) {
    const titleMatch = block.match(/<h2 class="text-3xl text-gray-900"[^>]*>([^<]+)<\/h2>/);
    const descMatch = block.match(/<p class="text-sm text-gray-600"[^>]*>([^<]+)<\/p>/);
    const imgMatch = block.match(/<img src="(\/background\/[^"]+)"[^>]+alt="([^"]*)"/);

    if (titleMatch) {
      out.push({
        title: stripTags(titleMatch[1]),
        description: descMatch ? stripTags(descMatch[1]) : null,
        image: imgMatch ? BASE + imgMatch[1] : null,
      });
    }
  }

  return out;
}

function scrapeHome(customUrl = null) {
  const target = customUrl || `${BASE}/`;
  const html = curl(target);

  return {
    source: target,
    type: "home",
    scraped_at: new Date().toISOString(),
    hero: parseHero(html),
    pinned_news: parsePinnedNews(html),
    berita_bgn: parseNews(html, "internal"),
    berita_nasional: parseNews(html, "nasional"),
    kolaborasi: parseKolaborasi(html),
    sasaran: parseSasaran(html),
  };
}

function scrapeNews(page = 1, filter = "internal") {
  const targetPage = parseInt(page, 10) || 1;
  const url =
    targetPage === 1 ? `${BASE}/news/` : `${BASE}/news/page/${targetPage}/`;

  const html = curl(url);
  const news = parseNews(html, filter);

  return {
    source: url,
    type: filter === "internal" ? "news_bgn" : "news_nasional",
    page: targetPage,
    scraped_at: new Date().toISOString(),
    total: news.length,
    news,
  };
}

function scrapeKolaborasi() {
  const html = curl(`${BASE}/`);
  const list = parseKolaborasi(html);

  return {
    source: `${BASE}/`,
    type: "kolaborasi",
    scraped_at: new Date().toISOString(),
    total: list.length,
    partners: list,
  };
}

function scrapeSasaran() {
  const html = curl(`${BASE}/`);
  const list = parseSasaran(html);

  return {
    source: `${BASE}/`,
    type: "sasaran",
    scraped_at: new Date().toISOString(),
    total: list.length,
    targets: list,
  };
}

export default {
  name: "Badan Gizi Nasional",
  description:
    "Scraper portal Badan Gizi Nasional (BGN / Makan Bergizi Gratis — bgn.go.id): homepage (hero, video, berita pinned), berita resmi BGN, berita media nasional, mitra kolaborasi, dan sasaran program.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "page", "url"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "home",
      description:
        "Aksi: home (semua section), news (berita resmi BGN), nasional (berita media nasional), kolaborasi (mitra), sasaran (target program)",
      enum: ["home", "news", "nasional", "kolaborasi", "sasaran"],
      example: "home",
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman berita (untuk action=news atau action=nasional)",
      example: 1,
    },
    url: {
      type: "string",
      required: false,
      description: "Custom URL dari bgn.go.id yang ingin di-scrape langsung (opsional)",
      example: "https://bgn.go.id/news/",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      let action = String(params.action || "").trim().toLowerCase();
      const page = parseInt(params.page || params.p || 1, 10) || 1;
      const customUrl = String(params.url || "").trim();

      // Auto-detect action jika tidak ditentukan
      if (!action) {
        if (customUrl) {
          action = customUrl.includes("/news") ? "news" : "home";
        } else {
          action = "home";
        }
      }

      logger.info(`[BGN] Action=${action} page=${page} url=${customUrl || "-"}`);

      if (action === "home" || action === "all") {
        const data = scrapeHome(customUrl || null);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      if (action === "news" || action === "berita") {
        const data = scrapeNews(page, "internal");
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      if (action === "nasional" || action === "news-nasional") {
        const data = scrapeNews(page, "nasional");
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      if (action === "kolaborasi" || action === "mitra") {
        const data = scrapeKolaborasi();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      if (action === "sasaran" || action === "target") {
        const data = scrapeSasaran();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: home, news, nasional, kolaborasi, sasaran`,
      });
    } catch (err) {
      logger.error(`[BGN] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data Badan Gizi Nasional",
      });
    }
  },
};

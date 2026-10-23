/**
 * Voratoon Updates Scraper - HTML parsing version
 * GET /api/search/voratoon?page=1
 * POST /api/search/voratoon
 * Body: { "page": 1 }
 */

import fetch from "node-fetch";
import logger from "../../src/utils/logger.js";

const BASE = "https://v1.voratoon.com";

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function parseSeriesItem(item) {
  const genres = (item.genres || []).map(g => g.name || g).join(", ");
  const latest = item.latestChapter;
  return {
    title: item.title || item.name || null,
    nativeTitle: item.nativeTitle || item.originalTitle || null,
    slug: item.slug || null,
    coverImage: item.coverImage || item.thumbnail || item.image || null,
    synopsis: item.synopsis || item.description || null,
    author: item.author || item.authorName || null,
    rating: item.rating || item.rate || null,
    status: item.status || item.statusName || null,
    format: item.format || item.type || null,
    totalChapters: item.totalChapters || item.chapterCount || null,
    genres: genres || null,
    url: item.slug ? `https://v1.voratoon.com/series/${item.slug}` : null,
    latestChapter: latest
      ? {
          index: latest.chapterIndex || latest.index || null,
          id: latest.id || null,
          url: `https://v1.voratoon.com/series/${item.slug}/chapter/${latest.chapterIndex || latest.index}`,
        }
      : null,
    updatedAt: item.updatedAt || item.updated_at || null,
  };
}

function parseSeriesData(series) {
  if (!Array.isArray(series)) return [];
  return series.map(parseSeriesItem).filter(item => item.title);
}

function parseUpdatesData(updates) {
  if (!Array.isArray(updates)) return [];
  const results = [];
  for (const item of updates) {
    const series = item.series || item.data || item;
    if (!series) continue;
    const genres = (series.genres || []).map(g => g.name || g).join(", ");
    const latest = series.latestChapter;
    results.push({
      title: series.title || null,
      nativeTitle: series.nativeTitle || null,
      slug: series.slug || null,
      coverImage: series.coverImage || series.thumbnail || series.image || null,
      synopsis: series.synopsis || series.description || null,
      author: series.author || series.authorName || null,
      rating: series.rating || series.rate || null,
      status: series.status || series.statusName || null,
      format: series.format || series.type || null,
      totalChapters: series.totalChapters || series.chapterCount || null,
      genres: genres || null,
      url: series.slug ? `https://v1.voratoon.com/series/${series.slug}` : null,
      latestChapter: latest
        ? {
            index: latest.chapterIndex || latest.index || null,
            id: latest.id || null,
            url: `https://v1.voratoon.com/series/${series.slug}/chapter/${latest.chapterIndex || latest.index}`,
          }
        : null,
      updatedAt: item.updatedAt || item.updated_at || null,
    });
  }
  return results.filter(item => item.title);
}

function parseHTMLDirect(html) {
  const results = [];
  const cardRegex =
    /<a[^>]*href="\/series\/([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/[^>]*>/gi;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const [, slug, image, title] = m;
    results.push({
      title: title.trim(),
      slug,
      coverImage: image,
      url: `https://v1.voratoon.com/series/${slug}`,
      nativeTitle: null,
      synopsis: null,
      author: null,
      rating: null,
      status: null,
      format: null,
      totalChapters: null,
      genres: null,
      latestChapter: null,
      updatedAt: null,
    });
  }
  return results.filter(item => item.title);
}


function extractSeriesFromHTML(html) {
  // JSON-LD scripts
  const scriptMatches = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptMatches) {
    for (const script of scriptMatches) {
      const content = script.replace(/<script[^>]*>/, "").replace(/<\/script>/g, "").trim();
      try {
        const data = JSON.parse(content);
        if (data.props?.pageProps?.series) return parseSeriesData(data.props.pageProps.series);
        if (data.series) return parseSeriesData(data.series);
        if (data.updates) return parseUpdatesData(data.updates);
      } catch (e) {}
    }
  }

  // __NEXT_DATA__
  const nextHtml = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextHtml) {
    try {
      const data = JSON.parse(nextHtml[1]);
      if (data.props?.pageProps?.series) return parseSeriesData(data.props.pageProps.series);
      if (data.query?.series) return parseSeriesData(data.query.series);
      if (data.props?.pageProps?.updates) return parseUpdatesData(data.props.pageProps.updates);
    } catch (e) {}
  }

  return parseHTMLDirect(html);
}

async function getUpdates(page = 1) {
  const url = `${BASE}/updates${page === 1 ? "" : `?page=${page}`}`;
  const html = await fetchHTML(url);
  return extractSeriesFromHTML(html);
}

export default {
  name: "Voratoon Updates",
  description: "Latest manga/manhwa/manhua updates from Voratoon",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["page"],
  paramsSchema: {
    page: {
      type: "integer",
      required: false,
      default: 1,
      minimum: 1,
      maximum: 20,
      description: "Page number (1-20)",
    },
  },
  async run(req, res) {
    const { page = 1 } = { ...req.query, ...req.body };
    const n = Math.min(Math.max(parseInt(page) || 1, 1), 20);

    try {
      const items = await getUpdates(n);
      if (!items.length) {
        return res.status(404).json({ status: false, message: "No updates found for this page" });
      }
      return res.json({
        status: true,
        page: n,
        total: items.length,
        results: items,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.error(`[Voratoon Updates] Error: ${e.message}`);
      return res.status(500).json({ status: false, error: e.message, timestamp: new Date().toISOString() });
    }
  },
};

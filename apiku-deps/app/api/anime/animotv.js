/**
 * AnimoTVSlash Anime Scraper
 * Base: https://www.animotvslash.org
 *
 * GET /api/anime/animotv?action=latest
 * GET /api/anime/animotv?action=search&query=naruto
 * GET /api/anime/animotv?action=detail&id=56768
 * GET /api/anime/animotv?action=episodes&slug=wolfs-rain-ova-ova
 * GET /api/anime/animotv?action=stream&url=https://animotvslash.org/wolfs-rain-ova-ova-episode-1/
 */

import axios from "axios";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

const BASE = "https://www.animotvslash.org";
const API = `${BASE}/wp-json/wp/v2`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

async function fetchApi(path, params = {}) {
  try {
    const res = await axios.get(`${API}${path}`, {
      params,
      headers: HEADERS,
      timeout: 30000,
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 0,
      error: err.response?.data?.message || err.message,
    };
  }
}

async function fetchHtml(url) {
  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, Accept: "text/html,application/xhtml+xml" },
      timeout: 30000,
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 0,
      error: err.response?.data?.message || err.message,
    };
  }
}

function parseClassList(classList = []) {
  const genres = [];
  const studios = [];
  const directors = [];
  let season = null;
  let country = null;

  for (const cls of classList) {
    if (cls.startsWith("genres-")) genres.push(cls.replace("genres-", ""));
    else if (cls.startsWith("studio-")) studios.push(cls.replace("studio-", ""));
    else if (cls.startsWith("director-")) directors.push(cls.replace("director-", ""));
    else if (cls.startsWith("season-")) season = cls.replace("season-", "");
    else if (cls.startsWith("country-")) country = cls.replace("country-", "");
  }

  return {
    genres: genres.map((g) => g.replace(/-/g, " ")),
    studios: studios.map((s) => s.replace(/-/g, " ")),
    directors: directors.map((d) => d.replace(/-/g, " ")),
    season,
    country,
  };
}

function normalizeAnime(a) {
  const parsed = parseClassList(a.class_list || []);
  return {
    id: a.id,
    title: a.title?.rendered || null,
    slug: a.slug,
    link: a.link,
    date: a.date,
    modified: a.modified,
    featuredMedia: a.featured_media,
    description: (a.content?.rendered || "").replace(/<[^>]*>/g, "").trim().slice(0, 300),
    genres: parsed.genres,
    studios: parsed.studios,
    directors: parsed.directors,
    season: parsed.season,
    country: parsed.country,
  };
}

export async function searchAnime(query) {
  const res = await fetchApi("/search", { search: query, per_page: 20 });
  if (!res.ok) throw new Error(res.error || "Gagal melakukan pencarian anime");

  const items = (res.data || []).filter((i) => i.subtype === "anime");
  return {
    query,
    total: items.length,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      url: i.url,
      slug: (i.url || "").replace(/^.*\/anime\/([^/]+)\/?.*$/, "$1"),
    })),
  };
}

export async function getLatest(count = 10) {
  const limit = Math.min(Math.max(parseInt(count) || 10, 1), 100);
  const res = await fetchApi("/anime", {
    per_page: limit,
    orderby: "date",
    order: "desc",
  });
  if (!res.ok) throw new Error(res.error || "Gagal mengambil anime terbaru");

  const items = res.data || [];
  return {
    total: items.length,
    items: items.map(normalizeAnime),
  };
}

export async function getDetail(id) {
  const res = await fetchApi(`/anime/${id}`);
  if (!res.ok) throw new Error(res.error || "Anime tidak ditemukan");

  const a = res.data;
  if (!a) throw new Error("Data anime kosong");

  return {
    ...normalizeAnime(a),
    content: (a.content?.rendered || "").replace(/<[^>]*>/g, "").trim(),
  };
}

export async function getEpisodes(animeSlug) {
  const cleanSlug = String(animeSlug).trim().replace(/^.*\/anime\//, "").replace(/\/$/, "");
  const url = `${BASE}/anime/${cleanSlug}/`;
  const res = await fetchHtml(url);
  if (!res.ok) throw new Error(res.error || "Gagal mengambil daftar episode");

  const $ = cheerio.load(res.data);
  const episodes = [];

  $('a[href*="-episode-"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && href.includes(cleanSlug)) {
      episodes.push({
        title: text || null,
        url: href.startsWith("http") ? href : BASE + href,
      });
    }
  });

  const unique = [];
  const seen = new Set();
  for (const ep of episodes) {
    if (!seen.has(ep.url)) {
      seen.add(ep.url);
      unique.push(ep);
    }
  }

  return {
    slug: cleanSlug,
    total: unique.length,
    episodes: unique,
  };
}

export async function getStream(episodeUrl) {
  const res = await fetchHtml(episodeUrl);
  if (!res.ok) throw new Error(res.error || "Gagal mengambil halaman streaming");

  const $ = cheerio.load(res.data);

  let streamUrl = null;
  let streamType = null;

  const iframe = $("iframe[src]").first();
  if (iframe.length) {
    streamUrl = iframe.attr("src");
    streamType = "iframe";
  }

  if (!streamUrl) {
    const source = $("video source[src]").first();
    if (source.length) {
      streamUrl = source.attr("src");
      streamType = "video";
    }
  }

  if (!streamUrl) {
    const html = res.data;
    const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
    if (m3u8Match) {
      streamUrl = m3u8Match[0];
      streamType = "m3u8";
    } else if (mp4Match) {
      streamUrl = mp4Match[0];
      streamType = "mp4";
    }
  }

  if (!streamUrl) {
    throw new Error(
      "Stream URL tidak ditemukan di HTML. Player dimuat dinamis (AIOVG / Cloudflare)."
    );
  }

  return {
    url: episodeUrl,
    streamUrl,
    streamType,
  };
}

export default {
  name: "AnimoTVSlash",
  description:
    "Scraper anime AnimoTVSlash — search, latest, detail info, daftar episode, dan stream URL",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "id", "slug", "url", "count"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "latest",
      enum: ["latest", "search", "detail", "episodes", "stream"],
      description: "Aksi: latest, search, detail, episodes, atau stream",
      example: "latest",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian anime (untuk action=search)",
      example: "naruto",
    },
    id: {
      type: "number",
      required: false,
      description: "ID anime dari WordPress REST API (untuk action=detail)",
      example: 56768,
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug anime (untuk action=episodes)",
      example: "wolfs-rain-ova-ova",
    },
    url: {
      type: "string",
      required: false,
      description: "URL halaman episode anime (untuk action=stream)",
      example: "https://animotvslash.org/wolfs-rain-ova-ova-episode-1/",
    },
    count: {
      type: "number",
      required: false,
      default: 10,
      description: "Jumlah anime terbaru yang diambil (untuk action=latest)",
      example: 10,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      let action = (params.action || params.type || "").toLowerCase().trim();

      // Auto-detect action jika tidak ditentukan
      if (!action) {
        if (params.query || params.q) action = "search";
        else if (params.url) action = "stream";
        else if (params.slug) action = "episodes";
        else if (params.id) action = "detail";
        else action = "latest";
      }

      logger.info(`[AnimoTV] Action: ${action} | IP: ${req.ip}`);

      let result;
      switch (action) {
        case "search": {
          const q = (params.query || params.q || "").trim();
          if (!q) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'query' wajib diisi untuk action search",
            });
          }
          result = await searchAnime(q);
          break;
        }

        case "latest": {
          const count = params.count || params.limit || 10;
          result = await getLatest(count);
          break;
        }

        case "detail": {
          const id = params.id;
          if (!id) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' wajib diisi untuk action detail",
            });
          }
          result = await getDetail(id);
          break;
        }

        case "episodes": {
          const slug = (params.slug || params.id || "").trim();
          if (!slug) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'slug' wajib diisi untuk action episodes",
            });
          }
          result = await getEpisodes(slug);
          break;
        }

        case "stream": {
          const epUrl = (params.url || "").trim();
          if (!epUrl) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'url' wajib diisi untuk action stream",
            });
          }
          result = await getStream(epUrl);
          break;
        }

        default:
          return res.status(400).json({
            status: false,
            message:
              "Action tidak dikenal. Gunakan: latest, search, detail, episodes, atau stream",
          });
      }

      return res.json({
        status: true,
        action,
        ...result,
      });
    } catch (err) {
      logger.error(`[AnimoTV] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses request AnimoTV",
      });
    }
  },
};

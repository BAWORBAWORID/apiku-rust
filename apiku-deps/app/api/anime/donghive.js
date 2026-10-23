/**
 * Donghive Scraper API
 * Provider: Donghive (donghive.vip)
 * Fitur   : Scrape katalog, search, series detail, episode list, embed player & resolver m3u8 Dailymotion
 */

import * as cheerio from 'cheerio';
import logger from '../../src/utils/logger.js';

const BASE = 'https://donghive.vip';
const TIMEOUT = 25_000;
const RETRIES = 3;
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hdrs = (i, extra = {}) => ({
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': UAS[i % UAS.length],
  ...extra,
});

async function req(url, { headers = {}, method = 'GET', referer } = {}) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        method,
        headers: hdrs(i, { ...(referer ? { Referer: referer } : {}), ...headers }),
        signal: ac.signal,
        redirect: 'follow',
      });
      const txt = await res.text();
      if (RETRYABLE.has(res.status) && i < RETRIES) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : Math.min(1500 * 2 ** i, 10000) + Math.random() * 500);
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return { res, txt };
    } catch (e) {
      lastErr = e;
      if (e.name !== 'AbortError' && !(e instanceof TypeError)) break;
      await sleep(Math.min(1500 * 2 ** i, 10000));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error(`Fetch gagal: ${url}`);
}

async function fetchHtml(url, opts = {}) {
  const { res, txt } = await req(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
  return txt;
}

const abs = (u) => (u?.startsWith('http') ? u : new URL(u || '', BASE).href);
const absUrl = (u) => {
  try {
    return new URL(u, BASE).href;
  } catch {
    return u || null;
  }
};

function parseCard($card) {
  const $a = $card.find('.bsx a[href], a.tip[href]').first();
  const link = absUrl($a.attr('href'));
  if (!link) return null;
  const title = ($a.attr('title') || $card.find('.tt h2, h2').first().text() || '').trim();
  const poster = $card.find('img').first().attr('data-src') || $card.find('img').first().attr('src') || null;
  return {
    title: title || null,
    url: link,
    slug: link.replace(/\/$/, '').split('/').pop(),
    poster: poster ? abs(poster) : null,
    type: ($card.find('.typez').first().text() || $card.find('.epx').first().text() || '').trim().toLowerCase() || null,
    sub: $card.find('.sb').first().text().trim() || null,
    hot: $card.find('.hotbadge').length > 0,
  };
}

async function scrapeListPage(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];
  $('article.bs').each((_, el) => {
    const it = parseCard($(el));
    if (it) items.push(it);
  });
  const next = $(`a[href*="/page/"]`)
    .filter((_, el) => /page\/\d+/.test($(el).attr('href') || ''))
    .toArray()
    .map((el) => absUrl($(el).attr('href')))
    .find((u, i, arr) => u && arr.indexOf(u) === i) || null;
  return { items, next };
}

// ── KATALOG ──
async function scrapeCatalog(maxPages = 1) {
  const seen = new Set();
  const out = [];
  let url = `${BASE}/anime/?status=&type=&order=update`;
  for (let page = 1; page <= maxPages && url; page++) {
    let parsed;
    try {
      parsed = await scrapeListPage(url);
    } catch {
      break;
    }
    for (const it of parsed.items) {
      if (!seen.has(it.url)) {
        seen.add(it.url);
        out.push(it);
      }
    }
    url = page < maxPages ? parsed.next : null;
  }
  return out;
}

// ── SEARCH ──
async function scrapeSearch(query) {
  const url = `${BASE}/?s=${encodeURIComponent(query)}`;
  const { items } = await scrapeListPage(url);
  return items;
}

// ── SERIES DETAIL ──
async function scrapeSeries(seriesUrl) {
  const targetUrl = seriesUrl.startsWith('http') ? seriesUrl : `${BASE}/${seriesUrl.replace(/^\/+|\/+$/g, '')}/`;
  const html = await fetchHtml(targetUrl, { referer: `${BASE}/` });
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content')?.replace(/\s*-\s*Donghive$/, '') || '';
  const poster = $('meta[property="og:image"]').attr('content') || $('.imgseries img, .seriesinfo img, .infox img').first().attr('src') || null;
  const synopsis = ($('.entry-content, .synopsis, .desc').first().text() || $('meta[property="og:description"]').attr('content') || '').trim();

  const genres = [];
  $('a[rel="tag"][href*="/genres/"]').each((_, el) => genres.push($(el).text().trim()));

  const status = $('.spe').first().text().match(/Status:\s*([^\t\n]+)/)?.[1]?.trim() || null;
  const network = $('a[href*="/network/"]').first().text().trim() || null;

  const episodes = [];
  $('li[data-index] a[href]').each((_, el) => {
    const href = absUrl($(el).attr('href'));
    const num = $(el).find('.epl-num').text().trim();
    const t = $(el).find('.epl-title').text().trim();
    const date = $(el).find('.epl-date').text().trim();
    if (href) {
      episodes.push({
        number: num ? Number(num) : null,
        title: t || null,
        url: href,
        date: date || null,
      });
    }
  });

  return {
    title,
    url: targetUrl,
    poster: poster ? abs(poster) : null,
    synopsis,
    genres: [...new Set(genres)],
    status,
    network,
    totalEpisodes: episodes.length,
    episodes,
  };
}

// ── EPISODE ──
async function scrapeEpisode(epUrl) {
  const targetUrl = epUrl.startsWith('http') ? epUrl : `${BASE}/${epUrl.replace(/^\/+|\/+$/g, '')}/`;
  const html = await fetchHtml(targetUrl, { referer: `${BASE}/` });
  const $ = cheerio.load(html);

  const title = $('h1.entry-title').first().text().trim() || $('title').text().trim();
  const iframe = $('#pembed iframe, .player-embed iframe, .video-content iframe').first().attr('src') || null;
  const embedUrl = iframe ? iframe.replace(/&amp;/g, '&') : null;
  const videoId = embedUrl?.match(/[?&]video=([A-Za-z0-9_-]+)/)?.[1] || null;

  const slug = targetUrl.replace(/\/$/, '').split('/').pop() || '';
  const seriesSlug = slug.match(/^(.+?)-(?:episode|movie|chapter|ova|special|preview)-/i)?.[1] || null;
  const seriesUrl = seriesSlug ? `${BASE}/${seriesSlug}/` : null;

  return {
    title,
    url: targetUrl,
    seriesUrl,
    embedUrl,
    videoId,
    provider: videoId ? 'Dailymotion' : null,
  };
}

// ── RESOLVE DAILYMOTION STREAM (M3U8) ──
async function resolveDailymotionStream(videoId, embedUrl = null) {
  if (!videoId) throw new Error("Parameter 'videoId' wajib diisi");

  const pageUrls = [
    ...(embedUrl ? [embedUrl] : []),
    `https://www.dailymotion.com/video/${videoId}`,
  ];

  let m3u8 = null;
  for (const pageUrl of pageUrls) {
    try {
      const { txt: html } = await req(pageUrl, { referer: 'https://www.dailymotion.com/' });
      m3u8 = html.match(/https?:\/\/cdndirector\.dailymotion\.com\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i)?.[0]
        || html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i)?.[0];
      if (m3u8) break;
    } catch {}
  }

  if (!m3u8) throw new Error('Manifest m3u8 tidak ditemukan di embed Dailymotion.');

  let info = {};
  try {
    const { txt } = await req(`https://api.dailymotion.com/video/${videoId}?fields=id,title,duration,thumbnail_720_url`);
    info = JSON.parse(txt);
  } catch {}

  return {
    provider: 'Dailymotion',
    videoId,
    pageUrl: `https://www.dailymotion.com/video/${info.id || videoId}`,
    streamType: 'hls',
    streamUrl: m3u8.replace(/&amp;/g, '&'),
    ...info,
  };
}

export default {
  name: "Donghive",
  description: "Scraper Donghua Donghive — katalog, pencarian, detail series, daftar episode, dan stream m3u8",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "videoId", "pages"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Aksi: catalog, search, series, episode, stream",
      enum: ["catalog", "search", "series", "episode", "stream"],
      example: "catalog",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (untuk action=search)",
      example: "Against the Gods",
    },
    url: {
      type: "string",
      required: false,
      description: "URL atau slug series/episode Donghive (untuk action=series, episode, stream)",
      example: "https://donghive.vip/against-the-gods/",
    },
    videoId: {
      type: "string",
      required: false,
      description: "ID video Dailymotion untuk langsung resolve stream m3u8 (action=stream)",
      example: "k4xYz123...",
    },
    pages: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah halaman yang di-scrape (untuk action=catalog, maks 5)",
      example: 1,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = String(params.action || 'catalog').trim().toLowerCase();

      logger.info(`[DONGHIVE] Request action=${action}`);

      // 1. Catalog
      if (action === 'catalog' || action === 'latest') {
        const pages = Math.min(Math.max(parseInt(params.pages || 1, 10), 1), 5);
        const items = await scrapeCatalog(pages);
        return res.status(200).json({
          status: true,
          total: items.length,
          pages,
          result: items,
        });
      }

      // 2. Search
      if (action === 'search') {
        const q = String(params.query || params.q || '').trim();
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const items = await scrapeSearch(q);
        return res.status(200).json({
          status: true,
          query: q,
          total: items.length,
          result: items,
        });
      }

      // 3. Series Detail
      if (action === 'series' || action === 'detail') {
        const seriesUrl = String(params.url || params.query || '').trim();
        if (!seriesUrl) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' wajib diisi (URL series Donghive).",
          });
        }
        const detail = await scrapeSeries(seriesUrl);
        return res.status(200).json({
          status: true,
          result: detail,
        });
      }

      // 4. Episode Detail
      if (action === 'episode') {
        const epUrl = String(params.url || params.query || '').trim();
        if (!epUrl) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' wajib diisi (URL episode Donghive).",
          });
        }
        const ep = await scrapeEpisode(epUrl);
        return res.status(200).json({
          status: true,
          result: ep,
        });
      }

      // 5. Stream (M3U8 Resolver)
      if (action === 'stream') {
        let vId = String(params.videoId || '').trim();
        let embed = null;

        if (!vId && params.url) {
          const ep = await scrapeEpisode(String(params.url).trim());
          vId = ep.videoId;
          embed = ep.embedUrl;
        }

        if (!vId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'videoId' atau 'url' episode wajib diisi untuk action=stream.",
          });
        }

        const stream = await resolveDailymotionStream(vId, embed);
        return res.status(200).json({
          status: true,
          result: stream,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: catalog, search, series, episode, stream`,
      });

    } catch (err) {
      logger.error(`[DONGHIVE] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data Donghive",
      });
    }
  },
};

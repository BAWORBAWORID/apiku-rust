/**
 * Melolo API Scraper
 * Provider: Melolo (melolo.com)
 * Category: Movie
 * Fitur   : Scrape catalog short drama & novel, pencarian, detail drama & daftar episode, direct MP4 streaming & download
 */

import { Readable } from 'node:stream';
import logger from '../../src/utils/logger.js';

const BASE_URL = 'https://melolo.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36';

function decodePage(html) {
  return html
    .replaceAll('\\"', '"')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\u003c', '<')
    .replaceAll('\\u003e', '>')
    .replaceAll('\\n', '\n')
    .replaceAll('&amp;', '&');
}

function cleanText(value) {
  return (value || '').replace(/\\u[0-9a-f]{4}/gi, match => String.fromCharCode(parseInt(match.slice(2), 16))).trim();
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`Melolo HTTP ${response.status}`);
  return { response, html, decoded: decodePage(html) };
}

function extractDramaItems(text) {
  const items = [];

  // Pola 1: Drama hero/featured dengan episode_list di home
  const pattern1 = /"cover_url":"(https?:[^"\\]+)"[\s\S]{0,12000}?"episode_list":(\[[\s\S]*?\])[\s\S]{0,4000}?"name":"([^"\\]+)","rating":"([^"\\]+)","series_slug":"([^"\\]+)"/g;
  for (const match of text.matchAll(pattern1)) {
    let episodes = [];
    try {
      episodes = JSON.parse(match[2]).map(item => ({ episode: item.episode_id, direct: item.url }));
    } catch {}
    items.push({
      type: 'drama',
      name: cleanText(match[3]),
      rating: match[4],
      slug: match[5],
      url: `${BASE_URL}/dramas/${match[5]}`,
      cover: match[1],
      episodes,
    });
  }

  // Pola 2: Drama catalog / trending cards
  const pattern2 = /"cover_url":"(https?:[^"\\]+)"[\s\S]{0,2500}?"name":"([^"\\]+)","rating":"([^"\\]+)","series_slug":"([^"\\]+)"/g;
  for (const match of text.matchAll(pattern2)) {
    items.push({
      type: 'drama',
      name: cleanText(match[2]),
      rating: match[3],
      slug: match[4],
      url: `${BASE_URL}/dramas/${match[4]}`,
      cover: match[1],
      episodes: [],
    });
  }

  return items;
}

function extractNovelItems(text) {
  const items = [];
  const pattern = /"cover_url":"(https?:[^"\\]+)"[\s\S]{0,3500}?"name":"([^"\\]+)",(?:"novels_slug":"([^"\\]+)","rating":"([^"\\]+)"|"rating":"([^"\\]+)","novels_slug":"([^"\\]+)")/g;
  for (const match of text.matchAll(pattern)) {
    const cover = match[1];
    const name = cleanText(match[2]);
    const slug = match[3] || match[6];
    const rating = match[4] || match[5];
    items.push({
      type: 'novel',
      name,
      rating,
      slug,
      url: `${BASE_URL}/novels/${slug}`,
      cover,
    });
  }
  return items;
}

function uniqueItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.type}:${item.slug}`;
    if (!map.has(key)) {
      map.set(key, item);
    } else {
      const existing = map.get(key);
      if ((!existing.episodes || existing.episodes.length === 0) && item.episodes?.length > 0) {
        map.set(key, item);
      }
    }
  }
  return [...map.values()];
}

function mapApiResult(item) {
  const type = item.type === 'series' ? 'drama' : 'novel';
  const slug = item.series_slug || item.novels_slug;
  return {
    type,
    name: item.name,
    rating: item.rating,
    slug,
    url: `${BASE_URL}/id/${type === 'drama' ? 'dramas' : 'novels'}/${slug}`,
    cover: item.cover_url,
    episode_num: item.episode_num,
    short_desc: item.short_desc,
  };
}

function extractDirectUrls(text) {
  const urls = [...text.matchAll(/https?:\/\/[^"\\\s]+?\.mp4(?:\?[^"\\\s<]*)?/g)].map(match => match[0].replace(/\\u0026/g, '&'));
  return [...new Set(urls)];
}

// 1. Scrape Home
async function scrapeHome() {
  const page = await fetchPage(BASE_URL);
  const dramas = uniqueItems(extractDramaItems(page.decoded));
  const novels = uniqueItems(extractNovelItems(page.decoded));
  return {
    source: BASE_URL,
    total: dramas.length + novels.length,
    dramas,
    novels,
  };
}

// 2. Search
async function scrapeSearch(keyword, page = 1, pageSize = 20) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
  const apiUrl = `${BASE_URL}/api/novels/searchNovelsByQuery?language=id&query=${encodeURIComponent(keyword)}&type=all&page=${pageNum}&page_size=${size}`;
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 200) {
    throw new Error(`Melolo search API error HTTP ${response.status}`);
  }
  const items = (payload.data?.page_data || []).map(mapApiResult);
  return {
    keyword,
    page: pageNum,
    page_size: size,
    total_count: payload.data?.total_count || items.length,
    total_pages: payload.data?.total_pages || 1,
    type_counts: payload.data?.type_counts || {},
    results: items,
  };
}

// 3. Detail Drama
async function scrapeDetail(slugOrUrl) {
  let url = String(slugOrUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    const cleanSlug = url.replace(/^\/+|\/+$/g, '');
    url = `${BASE_URL}/dramas/${cleanSlug}`;
  }
  const page = await fetchPage(url);
  const decoded = page.decoded;

  const metaMatch = decoded.match(/"cover_url":"(https?:[^"\\]+)"[\s\S]{0,15000}?"name":"([^"\\]+)","rating":"([^"\\]+)","series_slug":"([^"\\]+)"/);
  const descMatch = decoded.match(/"short_desc":"([^"\\]+)"/) || decoded.match(/"desc":"([^"\\]+)"/);
  const genresMatch = decoded.match(/"genre_list":(\[[\s\S]*?\])/);
  const epListMatch = decoded.match(/"episode_list":(\[[\s\S]*?\])/);

  let episodes = [];
  if (epListMatch) {
    try {
      episodes = JSON.parse(epListMatch[1]).map(item => ({ episode: item.episode_id, url: item.url }));
    } catch {}
  }
  if (!episodes.length) {
    const directUrls = extractDirectUrls(decoded);
    episodes = directUrls.map((u, i) => ({ episode: i + 1, url: u }));
  }

  let genres = [];
  if (genresMatch) {
    try {
      genres = JSON.parse(genresMatch[1]).map(g => g.name);
    } catch {}
  }

  return {
    url,
    title: cleanText(metaMatch?.[2]),
    rating: metaMatch?.[3] || null,
    slug: metaMatch?.[4] || url.replace(/\/$/, '').split('/').pop(),
    cover: metaMatch?.[1] || null,
    description: cleanText(descMatch?.[1]) || null,
    genres,
    total_episodes: episodes.length,
    episodes,
  };
}

// 4. Resolve Stream URL
async function resolveStream(slugOrUrl, episode = 1) {
  const detail = await scrapeDetail(slugOrUrl);
  const epNum = Math.max(1, parseInt(episode, 10) || 1);
  const targetEp = detail.episodes.find(e => e.episode === epNum) || detail.episodes[epNum - 1];
  if (!targetEp) {
    throw new Error(`Episode ${epNum} tidak ditemukan untuk drama '${detail.title || slugOrUrl}'`);
  }
  return {
    title: detail.title,
    slug: detail.slug,
    episode: targetEp.episode,
    total_episodes: detail.total_episodes,
    video_url: targetEp.url,
    headers: {
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      'User-Agent': USER_AGENT,
    },
    note: 'Video CDN v.melolo.com memerlukan header Referer: https://melolo.com/',
  };
}

const ACTIONS = ['home', 'search', 'detail', 'stream', 'download'];

export default {
  name: 'Melolo',
  description: 'Scraper Short Drama & Webnovel Melolo — katalog, pencarian, detail drama & episode list, direct MP4 streaming & download',
  category: 'Movie',
  methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
  params: ['action', 'query', 'slug', 'id', 'url', 'episode', 'page', 'play'],
  paramsSchema: {
    action: {
      type: 'string',
      required: false,
      default: 'home',
      enum: ACTIONS,
      description: `Aksi yang dijalankan: ${ACTIONS.join(', ')}`,
      example: 'home',
    },
    slug: {
      type: 'string',
      required: false,
      description: 'Slug drama Melolo (action=detail, stream, download). Rekomendasi dibanding url agar bebas limitasi SSRF',
      example: 'abstinent-tycoons-desire-the-factory-cinderella',
    },
    query: {
      type: 'string',
      required: false,
      description: 'Kata kunci pencarian (action=search) atau slug drama (action=detail, stream)',
      example: 'dewi permata',
    },
    url: {
      type: 'string',
      required: false,
      description: 'URL drama Melolo (action=detail, stream, download)',
      example: 'https://melolo.com/dramas/engaged-to-the-enemy',
    },
    episode: {
      type: 'number',
      required: false,
      default: 1,
      description: 'Nomor episode yang ingin di-stream/download (action=stream)',
      example: 1,
    },
    page: {
      type: 'number',
      required: false,
      default: 1,
      description: 'Nomor halaman hasil pencarian (action=search)',
      example: 1,
    },
    play: {
      type: 'boolean',
      required: false,
      default: false,
      description: 'Jika true pada action=stream, video MP4 akan langsung di-stream/pipe sebagai binary media ke browser',
      example: false,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = String(params.action || 'home').trim().toLowerCase();
      const q = String(params.slug || params.id || params.query || params.q || params.url || '').trim();

      logger.info(`[MELOLO] Request action=${action}`);

      // 1. Home
      if (action === 'home' || action === 'catalog') {
        const data = await scrapeHome();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 2. Search
      if (action === 'search' || action === 'cari') {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const page = params.page || 1;
        const pageSize = params.page_size || params.pageSize || 20;
        const data = await scrapeSearch(q, page, pageSize);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 3. Detail
      if (action === 'detail' || action === 'drama') {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'slug', 'query', atau 'url' wajib diisi",
          });
        }
        const data = await scrapeDetail(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 4. Stream / Download
      if (action === 'stream' || action === 'play' || action === 'download' || action === 'dl') {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'slug', 'query', atau 'url' wajib diisi untuk action=stream/download",
          });
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Max-Age': '86400',
          });
          return res.end();
        }

        const ep = params.episode || params.ep || 1;
        const streamInfo = await resolveStream(q, ep);

        const shouldPlay = String(params.play || params.stream || '').toLowerCase() === 'true' || params.play === true || action === 'play';
        if (shouldPlay) {
          const upstreamHeaders = { ...streamInfo.headers };
          if (req.headers.range) upstreamHeaders.Range = req.headers.range;

          const mediaRes = await fetch(streamInfo.video_url, {
            headers: upstreamHeaders,
            redirect: 'follow',
            signal: AbortSignal.timeout(60000),
          });

          if (!mediaRes.ok && mediaRes.status !== 206) {
            return res.status(mediaRes.status).json({
              status: false,
              message: `Gagal streaming video dari provider: HTTP ${mediaRes.status}`,
            });
          }

          const resHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
            'Content-Type': mediaRes.headers.get('content-type') || 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400',
            'Content-Disposition': `inline; filename="melolo-${streamInfo.slug}-ep${streamInfo.episode}.mp4"`,
          };

          const len = mediaRes.headers.get('content-length');
          const cr = mediaRes.headers.get('content-range');
          if (len) resHeaders['Content-Length'] = len;
          if (cr) resHeaders['Content-Range'] = cr;

          if (req.method === 'HEAD') {
            res.writeHead(mediaRes.status, resHeaders);
            return res.end();
          }

          res.writeHead(mediaRes.status, resHeaders);
          if (mediaRes.body) {
            return Readable.fromWeb(mediaRes.body).pipe(res);
          }
          return res.end(Buffer.from(await mediaRes.arrayBuffer()));
        }

        return res.status(200).json({
          status: true,
          result: {
            ...streamInfo,
            url: streamInfo.video_url,
            direct_stream_api: `/api/movie/melolo?action=stream&slug=${encodeURIComponent(streamInfo.slug)}&episode=${streamInfo.episode}&play=true`,
          },
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: ${ACTIONS.join(', ')}`,
      });
    } catch (err) {
      logger.error(`[MELOLO] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal memproses data Melolo',
      });
    }
  },
};

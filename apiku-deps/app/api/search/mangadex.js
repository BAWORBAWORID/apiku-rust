/**
 * MangaDex API Wrapper & Reader
 * Category: Search / Manga
 * Endpoint: /api/search/mangadex
 */

import axios from 'axios';
import logger from '../../src/utils/logger.js';

const API = 'https://api.mangadex.org';
const UP = 'https://uploads.mangadex.org';
const REPORT = 'https://api.mangadex.network/report';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pick(obj, langs = ['en', 'ja-ro', 'ja', 'id']) {
  if (!obj || typeof obj !== 'object') return null;
  for (const l of langs) if (obj[l]) return obj[l];
  const k = Object.keys(obj);
  return k.length ? obj[k[0]] : null;
}

function flat(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) out[`${k}[]`] = v;
    else if (typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v))
        out[`${k}[${sk}]`] = sv;
    } else out[k] = v;
  }
  return out;
}

export class MangaDex {
  constructor({ timeout = 20000, rateMs = 220 } = {}) {
    this.rateMs = rateMs;
    this._last = 0;
    this.http = axios.create({
      baseURL: API,
      timeout,
      headers: {
        'User-Agent': 'MangaDex-Wrapper/3.1',
        Accept: 'application/json',
      },
    });
  }

  async req(method, url, { params, data } = {}) {
    const wait = this.rateMs - (Date.now() - this._last);
    if (wait > 0) await sleep(wait);
    this._last = Date.now();
    try {
      const res = await this.http.request({
        method,
        url,
        params: params ? flat(params) : undefined,
        data,
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const msg =
        err.response?.data?.errors?.[0]?.detail ||
        err.response?.data?.message ||
        err.message;
      const e = new Error(`API ${status || '?'}: ${msg}`);
      e.status = status;
      throw e;
    }
  }

  _manga(e) {
    if (!e) return null;
    const a = e.attributes || {};
    const rels = e.relationships || [];
    const cover = rels.find((r) => r.type === 'cover_art');
    const fn = cover?.attributes?.fileName;
    const authors = rels
      .filter((r) => r.type === 'author' || r.type === 'artist')
      .map((r) => r.attributes?.name)
      .filter(Boolean);

    return {
      id: e.id,
      title: pick(a.title),
      description: (pick(a.description) || '').slice(0, 500) || null,
      status: a.status,
      year: a.year,
      originalLanguage: a.originalLanguage,
      contentRating: a.contentRating,
      tags: (a.tags || [])
        .map((t) => pick(t.attributes?.name))
        .filter(Boolean)
        .slice(0, 15),
      authors: [...new Set(authors)],
      cover: fn ? `${UP}/covers/${e.id}/${fn}.256.jpg` : null,
      coverFull: fn ? `${UP}/covers/${e.id}/${fn}` : null,
      lastChapter: a.lastChapter,
      lastVolume: a.lastVolume,
    };
  }

  _chapter(e) {
    if (!e) return null;
    const a = e.attributes || {};
    const rels = e.relationships || [];
    const manga = rels.find((r) => r.type === 'manga');
    const groups = rels
      .filter((r) => r.type === 'scanlation_group')
      .map((r) => r.attributes?.name || r.id);

    return {
      id: e.id,
      chapter: a.chapter,
      volume: a.volume,
      title: a.title || null,
      lang: a.translatedLanguage,
      pages: a.pages,
      publishAt: a.publishAt,
      externalUrl: a.externalUrl || null,
      mangaId: manga?.id || null,
      mangaTitle: manga?.attributes?.title
        ? pick(manga.attributes.title)
        : null,
      groups,
    };
  }

  _list(data, mapFn) {
    return {
      data: (data.data || []).map(mapFn),
      total: data.total ?? 0,
      limit: data.limit ?? 0,
      offset: data.offset ?? 0,
    };
  }

  async home({ limit = 12, lang = 'en' } = {}) {
    const [popular, latest, recent] = await Promise.all([
      this.popular({ limit }),
      this.latest({ limit, lang }),
      this.recent({ limit }),
    ]);
    return {
      popular: popular.data,
      latest: latest.data,
      recent: recent.data,
    };
  }

  async popular({ limit = 20, offset = 0 } = {}) {
    return this.search({
      limit,
      offset,
      order: { followedCount: 'desc' },
      hasAvailableChapters: true,
    });
  }

  async recent({ limit = 20, offset = 0 } = {}) {
    return this.search({
      limit,
      offset,
      order: { createdAt: 'desc' },
      hasAvailableChapters: true,
    });
  }

  async latest({ limit = 20, offset = 0, lang = 'en' } = {}) {
    const data = await this.req('GET', '/chapter', {
      params: {
        limit: Math.min(limit, 100),
        offset,
        translatedLanguage: [lang],
        order: { readableAt: 'desc' },
        includes: ['manga', 'scanlation_group'],
        contentRating: ['safe', 'suggestive', 'erotica', 'pornographic'],
        includeFutureUpdates: '0',
      },
    });
    const list = this._list(data, (e) => this._chapter(e));
    list.data = list.data.filter((c) => c.pages > 0);
    return list;
  }

  async search({
    title,
    limit = 20,
    offset = 0,
    lang,
    status,
    order = { relevance: 'desc' },
    hasAvailableChapters,
    contentRating = ['safe', 'suggestive', 'erotica'],
  } = {}) {
    const params = {
      limit: Math.min(limit, 100),
      offset,
      title,
      status: status ? [status] : undefined,
      availableTranslatedLanguage: lang ? [lang] : undefined,
      order,
      hasAvailableChapters,
      contentRating,
      includes: ['cover_art', 'author', 'artist'],
    };
    Object.keys(params).forEach(
      (k) => params[k] === undefined && delete params[k]
    );
    const data = await this.req('GET', '/manga', { params });
    return this._list(data, (e) => this._manga(e));
  }

  async detail(id) {
    const data = await this.req('GET', `/manga/${id}`, {
      params: {
        includes: ['cover_art', 'author', 'artist', 'tag'],
      },
    });
    return this._manga(data.data);
  }

  async random() {
    const data = await this.req('GET', '/manga/random', {
      params: {
        includes: ['cover_art', 'author', 'artist'],
      },
    });
    return this._manga(data.data);
  }

  async chapters(
    mangaId,
    {
      limit = 100,
      offset = 0,
      lang = 'en',
      includeEmpty = false,
    } = {}
  ) {
    const data = await this.req('GET', `/manga/${mangaId}/feed`, {
      params: {
        limit: Math.min(limit, 100),
        offset,
        translatedLanguage: [lang],
        order: { volume: 'asc', chapter: 'asc' },
        includes: ['scanlation_group'],
        contentRating: ['safe', 'suggestive', 'erotica', 'pornographic'],
        includeFutureUpdates: '0',
        includeEmptyPages: includeEmpty ? '1' : '0',
        includeExternalUrl: includeEmpty ? '1' : '0',
      },
    });
    const list = this._list(data, (e) => this._chapter(e));
    if (!includeEmpty) {
      list.data = list.data.filter(
        (c) => c.pages > 0 && !c.externalUrl
      );
    }
    return list;
  }

  async allChapters(
    mangaId,
    { lang = 'en', includeEmpty = false } = {}
  ) {
    const all = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await this.chapters(mangaId, {
        limit: 100,
        offset,
        lang,
        includeEmpty,
      });
      all.push(...page.data);
      total = page.total;
      offset += 100;
      if (!page.data.length && offset >= total) break;
      if (!page.data.length && !includeEmpty) {
        if (offset >= total) break;
        continue;
      }
      if (!page.data.length) break;
    }
    return all;
  }

  async chapter(id) {
    const data = await this.req('GET', `/chapter/${id}`, {
      params: {
        includes: ['manga', 'scanlation_group'],
      },
    });
    return this._chapter(data.data);
  }

  async read(chapterId, quality = 'data', { retries = 3 } = {}) {
    const q = quality === 'data-saver' ? 'data-saver' : 'data';
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(400 * attempt);

      const data = await this.req(
        'GET',
        `/at-home/server/${chapterId}`
      );
      const { baseUrl, chapter } = data;
      if (!chapter?.hash) {
        throw new Error('No page data (external/empty chapter?)');
      }

      const files =
        q === 'data-saver' ? chapter.dataSaver : chapter.data;
      if (!files?.length) {
        throw new Error('No page files (pages=0 or external)');
      }

      const urls = files.map(
        (f) => `${baseUrl}/${q}/${chapter.hash}/${f}`
      );

      const ok = await this._probe(urls[0]);
      if (ok) {
        return {
          chapterId,
          quality: q,
          count: urls.length,
          urls,
        };
      }

      this._report(urls[0], false).catch(() => {});
      lastErr = new Error(
        `MD@Home node failed (attempt ${attempt + 1}/${retries + 1})`
      );
    }

    throw lastErr || new Error('Failed to get readable pages');
  }

  async _probe(url) {
    try {
      const res = await axios.head(url, {
        timeout: 8000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          'User-Agent': 'MangaDex-Wrapper/3.1',
          Referer: 'https://mangadex.org/',
        },
      });
      return res.status >= 200 && res.status < 400;
    } catch {
      try {
        const res = await axios.get(url, {
          timeout: 10000,
          responseType: 'stream',
          headers: {
            'User-Agent': 'MangaDex-Wrapper/3.1',
            Referer: 'https://mangadex.org/',
            Range: 'bytes=0-0',
          },
          validateStatus: (s) => s >= 200 && s < 400,
        });
        res.data.destroy?.();
        return true;
      } catch {
        return false;
      }
    }
  }

  async _report(url, success) {
    try {
      await axios.post(
        REPORT,
        {
          url,
          success,
          bytes: 0,
          duration: 0,
          cached: false,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        }
      );
    } catch {
      // ignore
    }
  }

  async covers(mangaId, { limit = 20 } = {}) {
    const data = await this.req('GET', '/cover', {
      params: {
        manga: [mangaId],
        limit: Math.min(limit, 100),
        order: { volume: 'asc' },
      },
    });
    return (data.data || []).map((e) => {
      const a = e.attributes || {};
      return {
        id: e.id,
        volume: a.volume,
        fileName: a.fileName,
        url: `${UP}/covers/${mangaId}/${a.fileName}`,
        url256: `${UP}/covers/${mangaId}/${a.fileName}.256.jpg`,
      };
    });
  }

  async tags() {
    const data = await this.req('GET', '/manga/tag');
    return (data.data || []).map((t) => ({
      id: t.id,
      name: pick(t.attributes?.name),
      group: t.attributes?.group,
    }));
  }

  async stats(mangaId) {
    const data = await this.req('GET', '/statistics/manga', {
      params: { manga: [mangaId] },
    });
    const s = data.statistics?.[mangaId];
    if (!s) return null;
    return {
      follows: s.follows,
      rating: s.rating?.average ?? null,
      bayesian: s.rating?.bayesian ?? null,
      comments: s.comments?.repliesCount ?? 0,
    };
  }
}

const md = new MangaDex();

export default {
  name: "MangaDex",
  description: "MangaDex wrapper lengkap — search, home, popular, recent, latest, detail, chapters, reader page images, covers, tags, dan stats",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "id", "chapterId", "limit", "offset", "lang", "quality", "empty"],

  paramsSchema: {
    action: {
      type: "string",
      required: false,
      description: "Aksi yang dijalankan (default: search)",
      default: "search",
      enum: [
        "search",
        "home",
        "popular",
        "recent",
        "latest",
        "detail",
        "random",
        "chapters",
        "allchapters",
        "chapter",
        "read",
        "covers",
        "tags",
        "stats"
      ]
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci judul manga untuk action=search",
      example: "solo leveling"
    },
    id: {
      type: "string",
      required: false,
      description: "UUID manga untuk action=detail, chapters, allchapters, covers, stats",
      example: "32d76d19-8a05-4db0-9fc2-e0b0648fe9d0"
    },
    chapterId: {
      type: "string",
      required: false,
      description: "UUID chapter untuk action=read atau chapter",
      example: "eb3dd07d-cb32-4e8d-a56d-459cf76f4dd0"
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah data per halaman (default: 20)",
      default: 20
    },
    offset: {
      type: "number",
      required: false,
      description: "Offset pagination (default: 0)",
      default: 0
    },
    lang: {
      type: "string",
      required: false,
      description: "Bahasa terjemahan (en, id, ja, dll. default: en)",
      default: "en"
    },
    quality: {
      type: "string",
      required: false,
      description: "Kualitas gambar untuk action=read (data | data-saver)",
      default: "data"
    },
    empty: {
      type: "boolean",
      required: false,
      description: "Sertakan chapter kosong / external (default: false)",
      default: false
    }
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    let action = String(params.action || '').trim().toLowerCase();
    const query = String(params.query || params.q || params.title || '').trim();
    const id = String(params.id || params.mangaId || '').trim();
    const chapterId = String(params.chapterId || params.chapter || params.ch || '').trim();
    const limit = Math.max(1, parseInt(params.limit || 20, 10));
    const offset = Math.max(0, parseInt(params.offset || 0, 10));
    const lang = String(params.lang || 'en').trim();
    const quality = String(params.quality || 'data').trim();
    const includeEmpty = params.empty === 'true' || params.empty === true;

    // Smart default action jika action tidak diisi eksplisit
    if (!action) {
      if (chapterId) action = 'read';
      else if (id) action = 'detail';
      else if (query) action = 'search';
      else action = 'home';
    }

    try {
      logger.info(`[MANGADEX] action=${action} | q=${query || id || chapterId}`);

      let result;
      switch (action) {
        case 'home':
          result = await md.home({ limit, lang });
          break;
        case 'popular':
          result = await md.popular({ limit, offset });
          break;
        case 'recent':
          result = await md.recent({ limit, offset });
          break;
        case 'latest':
          result = await md.latest({ limit, offset, lang });
          break;
        case 'search': {
          if (!query) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'query' wajib diisi untuk action=search"
            });
          }
          result = await md.search({ title: query, limit, offset, lang });
          break;
        }
        case 'detail':
        case 'manga': {
          const targetId = id || query;
          if (!targetId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' wajib diisi untuk action=detail"
            });
          }
          result = await md.detail(targetId);
          break;
        }
        case 'random':
          result = await md.random();
          break;
        case 'chapters': {
          const targetId = id || query;
          if (!targetId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' wajib diisi untuk action=chapters"
            });
          }
          result = await md.chapters(targetId, {
            limit,
            offset,
            lang,
            includeEmpty,
          });
          break;
        }
        case 'allchapters': {
          const targetId = id || query;
          if (!targetId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' wajib diisi untuk action=allchapters"
            });
          }
          result = await md.allChapters(targetId, { lang, includeEmpty });
          break;
        }
        case 'chapter': {
          const targetChapter = chapterId || id || query;
          if (!targetChapter) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'chapterId' wajib diisi untuk action=chapter"
            });
          }
          result = await md.chapter(targetChapter);
          break;
        }
        case 'read':
        case 'pages': {
          const targetChapter = chapterId || id || query;
          if (!targetChapter) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'chapterId' wajib diisi untuk action=read"
            });
          }
          result = await md.read(targetChapter, quality);
          break;
        }
        case 'covers':
        case 'cover': {
          const targetId = id || query;
          if (!targetId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' wajib diisi untuk action=covers"
            });
          }
          result = await md.covers(targetId, { limit });
          break;
        }
        case 'tags':
          result = await md.tags();
          break;
        case 'stats': {
          const targetId = id || query;
          if (!targetId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' wajib diisi untuk action=stats"
            });
          }
          result = await md.stats(targetId);
          break;
        }
        default:
          return res.status(400).json({
            status: false,
            message: `Action '${action}' tidak dikenali. Pilihan: search, home, popular, recent, latest, detail, chapters, allchapters, chapter, read, covers, tags, stats, random`
          });
      }

      return res.json({
        status: true,
        action,
        data: result
      });
    } catch (err) {
      logger.error(`[MANGADEX] error action=${action}: ${err.message}`);
      return res.status(err.status || 500).json({
        status: false,
        message: err.message
      });
    }
  }
};

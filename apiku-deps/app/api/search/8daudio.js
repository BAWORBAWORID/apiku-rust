/**
 * 8D Audio Search, Catalog & Stream
 * Base Web: https://8daudio.vercel.app
 * Fitur   : Pencarian lagu 8D, katalog library, detail track & direct audio stream MP3
 */

import logger from '../../src/utils/logger.js';

const BASE = 'https://8daudio.vercel.app';
const TIMEOUT = 20_000;
const RETRIES = 3;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function req(path, { method = 'GET', body } = {}) {
  const url = `${BASE}${path}`;
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
        redirect: 'follow',
      });
      const txt = await res.text();
      if (RETRYABLE.has(res.status) && i < RETRIES) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : Math.min(1000 * 2 ** i, 8000) + Math.random() * 400);
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      let data;
      try {
        data = JSON.parse(txt);
      } catch {
        throw new Error(`Respons bukan JSON (${res.status}): ${txt.slice(0, 100)}`);
      }
      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e.name !== 'AbortError' && !(e instanceof TypeError)) break;
      await sleep(Math.min(1000 * 2 ** i, 8000));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error(`Fetch gagal: ${url}`);
}

function normalizeTrack(t = {}) {
  return {
    id: t.id || null,
    title: typeof t.title === 'string' ? t.title.trim() : null,
    artist: typeof t.artist === 'string' ? t.artist.trim() : null,
    genre: typeof t.genre === 'string' ? t.genre.trim() : null,
    description: typeof t.description === 'string' ? t.description : '',
    duration: Number.isFinite(t.duration) ? t.duration : null,
    plays: Number.isFinite(t.plays) ? t.plays : 0,
    status: typeof t.status === 'string' ? t.status : null,
    audio_url: t.audio_url || null,
    cover_url: t.cover_url || null,
    created_at: t.created_at || null,
    updated_at: t.updated_at || null,
  };
}

async function fetchLibrary({ status, search, genre } = {}) {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (search) p.set('search', search);
  if (genre && genre !== 'Semua') p.set('genre', genre);
  const data = await req(`/api/audio?${p}`);
  if (!Array.isArray(data)) throw new Error('Respons katalog audio bukan array');
  return data.map(normalizeTrack);
}

async function fetchTrack(id) {
  if (!id) throw new Error("Parameter 'id' wajib diisi");
  const t = await req(`/api/audio/${encodeURIComponent(id)}`);
  return normalizeTrack(t);
}

async function registerPlay(id) {
  if (!id) throw new Error("Parameter 'id' wajib diisi");
  return req(`/api/audio/${encodeURIComponent(id)}/play`, { method: 'POST' });
}

const ACTIONS = ["search", "library", "track", "play"];
const GENRES = ["Synthwave", "Lo-Fi", "Pop", "Rock", "Electronic"];
const STATUSES = ["PUBLIC", "DRAFT", "ARCHIVED"];

export default {
  name: "8D Audio",
  description: "Cari lagu 8D audio, streaming & download audio MP3 dari 8daudio.vercel.app",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "id", "genre", "status"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ACTIONS,
      description: `Pilihan aksi yang ingin dijalankan (${ACTIONS.join(', ')})`,
      example: "search"
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian lagu (judul / artis)",
      example: "bass"
    },
    id: {
      type: "string",
      required: false,
      description: "ID track lagu untuk mengambil detail / play (action=track, play)",
      example: "track-169a6f33-9f7c-43c7-89ab-42e029161b1c"
    },
    genre: {
      type: "string",
      required: false,
      enum: GENRES,
      description: "Filter genre lagu",
      example: "Synthwave"
    },
    status: {
      type: "string",
      required: false,
      enum: STATUSES,
      description: "Filter status track",
      example: "PUBLIC"
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const rawAction = params.action ? String(params.action).trim().toLowerCase() : '';

      if (!rawAction) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'action' wajib diisi: ${ACTIONS.join(', ')}`
        });
      }

      if (!ACTIONS.includes(rawAction)) {
        return res.status(400).json({
          status: false,
          message: `Action '${rawAction}' tidak valid. Pilihan: ${ACTIONS.join(', ')}`
        });
      }

      const action = rawAction;
      const query = String(params.query || params.search || params.q || '').trim();
      const trackId = String(params.id || params.trackId || '').trim();
      const genre = params.genre ? String(params.genre).trim() : null;
      const status = params.status ? String(params.status).trim() : null;

      logger.info(`[8DAUDIO] Request action=${action}`);

      // 1. Search & Library
      if (action === 'search' || action === 'library') {
        const items = await fetchLibrary({
          search: query || undefined,
          genre: genre || undefined,
          status: status || undefined
        });

        return res.status(200).json({
          status: true,
          total: items.length,
          filters: {
            search: query || null,
            genre: genre || null,
            status: status || null
          },
          result: items
        });
      }

      // 2. Track Detail
      if (action === 'track' || action === 'detail') {
        if (!trackId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' wajib diisi (contoh: track-xxxx-xxxx)."
          });
        }

        const track = await fetchTrack(trackId);
        return res.status(200).json({
          status: true,
          result: track
        });
      }

      // 3. Play Count
      if (action === 'play') {
        if (!trackId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' wajib diisi untuk action=play."
          });
        }

        const playRes = await registerPlay(trackId);
        return res.status(200).json({
          status: true,
          message: "Play count berhasil ditambahkan",
          result: playRes
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: search, library, track, play`
      });

    } catch (err) {
      logger.error(`[8DAUDIO] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data 8D Audio"
      });
    }
  }
};

/**
 * MovieBox API Scraper
 * Base Web: https://officialmoviebox.com
 * Source  : h5-api.aoneroom.com & api3.aoneroom.com
 * Features: Home banners/sections, trending movies/series, detail & DASH/HLS direct streaming info
 */

import https from 'node:https';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import logger from '../../src/utils/logger.js';

const H5 = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';
const MOBILE = 'https://api3.aoneroom.com';
const HOST = 'officialmoviebox.com';
const GATEWAY_B64 = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';
const GATEWAY_KEY = Buffer.from(GATEWAY_B64, 'base64');
const UA_H5 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const UA_MOB = 'com.community.oneroom/50020126 (Linux; U; Android 14; en_US; Pixel 6; Build/UQ1A)';

let guestJwt = null;

function md5hex(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function clientToken() {
  const ts = String(Date.now());
  return ts + ',' + md5hex(ts.split('').reverse().join(''));
}

function clientInfo() {
  return JSON.stringify({
    package_name: 'com.community.oneroom',
    version_name: '4.0.02',
    version_code: 50020126,
    os: 'android',
    os_version: '14',
    device_id: '868203051234567',
    brand: 'Google',
    model: 'Pixel 6',
    system_language: 'en',
    net: 'wifi',
    region: 'IN',
    timezone: 'Asia/Kolkata',
    sp_code: '404'
  });
}

function trSignature(method, fullUrl, body) {
  const ts = Date.now();
  const u = new URL(fullUrl);
  const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const qs = params.map(([k, v]) => k + '=' + v).join('&');
  const resource = u.pathname + (qs ? '?' + qs : '');
  const bodyStr = body || '';
  const bodyMd5 = bodyStr ? md5hex(bodyStr.slice(0, 0x19000)) : '';
  const canon = [
    method.toUpperCase(),
    'application/json',
    'application/json;charset=UTF-8',
    bodyStr ? String(bodyStr.length) : '',
    String(ts),
    bodyMd5,
    resource
  ].join('\n');
  const dig = crypto.createHmac('md5', GATEWAY_KEY).update(canon).digest('base64');
  return ts + '|2|' + dig;
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: headers,
      timeout: 25000
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Koneksi timeout ke MovieBox')); });
    req.end();
  });
}

async function mobileGet(path) {
  const url = MOBILE + path;
  const headers = {
    'User-Agent': UA_MOB,
    Accept: 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-M-Version': '4.0.02',
    'X-Client-Token': clientToken(),
    'X-Client-Info': clientInfo(),
    'X-Client-Status': '0',
    'x-tr-signature': trSignature('GET', url)
  };
  if (guestJwt) headers.Authorization = 'Bearer ' + guestJwt;
  return httpGet(url, headers);
}

async function ensureGuest(forceRefresh = false) {
  if (guestJwt && !forceRefresh) return guestJwt;
  const r = await mobileGet('/wefeed-mobile-bff/tab-operating?page=1&tabId=0');
  const raw = r.headers['x-user'] || r.headers['X-User'] || '';
  try {
    guestJwt = JSON.parse(raw).token;
  } catch (_) {
    guestJwt = raw.startsWith('ey') ? raw : null;
  }
  if (!guestJwt) throw new Error('Gagal inisialisasi sesi guest MovieBox');
  return guestJwt;
}

function h5Get(path) {
  const url = path.startsWith('http') ? path : H5 + path;
  return httpGet(url, {
    'User-Agent': UA_H5,
    Accept: 'application/json',
    Referer: 'https://' + HOST + '/',
    Origin: 'https://' + HOST
  }).then(r => {
    try {
      return JSON.parse(r.body);
    } catch (e) {
      throw new Error('Respons bukan JSON valid dari MovieBox');
    }
  });
}

function decodeSignCookie(sc) {
  if (!sc) return null;
  const m = String(sc).match(/urlprefix=([^:]+)/);
  if (!m) return null;
  try {
    const prefix = Buffer.from(m[1], 'base64').toString('utf8');
    return {
      prefix,
      mpd: prefix.replace(/\/?$/, '/') + 'index.mpd',
      m3u8: prefix.replace(/\/?$/, '/') + 'index.m3u8'
    };
  } catch (_) {
    return null;
  }
}

async function fetchHome() {
  const j = await h5Get('/home?host=' + HOST);
  if (j.code !== 0) throw new Error(j.message || 'Gagal memuat home MovieBox');
  const ops = (j.data && j.data.operatingList) || [];
  const out = { platforms: (j.data && j.data.platformList) || [], sections: [] };
  for (const sec of ops) {
    const items = [];
    if (sec.banner && sec.banner.items) {
      for (const b of sec.banner.items) {
        const s = b.subject || {};
        items.push({
          subjectId: s.subjectId || b.subjectId,
          title: s.title || b.title,
          type: s.subjectType,
          cover: (s.cover && s.cover.url) || (b.image && b.image.url),
          imdb: s.imdbRatingValue,
          genre: s.genre,
          releaseDate: s.releaseDate
        });
      }
    }
    if (sec.subjects) {
      for (const s of sec.subjects) {
        items.push({
          subjectId: s.subjectId,
          title: s.title,
          type: s.subjectType,
          cover: s.cover && s.cover.url,
          imdb: s.imdbRatingValue,
          genre: s.genre,
          releaseDate: s.releaseDate
        });
      }
    }
    out.sections.push({ type: sec.type, title: sec.title, position: sec.position, items });
  }
  return out;
}

async function fetchTrending(page = 0) {
  const p = Math.max(0, parseInt(page, 10) || 0);
  const j = await h5Get(`/subject/trending?page=${p}&perPage=18`);
  if (j.code !== 0) throw new Error(j.message || 'Gagal memuat trending MovieBox');
  return ((j.data && j.data.subjectList) || []).map(s => ({
    subjectId: s.subjectId,
    title: s.title,
    type: s.subjectType,
    cover: s.cover && s.cover.url,
    imdb: s.imdbRatingValue,
    genre: s.genre,
    releaseDate: s.releaseDate,
    country: s.countryName,
    hasResource: s.hasResource
  }));
}

async function fetchDetail(id) {
  if (!id) throw new Error("Parameter 'id' (subjectId) wajib diisi");
  const j = await h5Get(`/detail?subjectId=${encodeURIComponent(id)}`);
  if (j.code !== 0) throw new Error(j.message || 'Detail tidak ditemukan');
  const s = (j.data && j.data.subject) || {};
  return {
    subjectId: s.subjectId,
    title: s.title,
    type: s.subjectType,
    description: s.description,
    releaseDate: s.releaseDate,
    duration: s.duration,
    genre: s.genre,
    cover: s.cover && s.cover.url,
    country: s.countryName,
    imdb: s.imdbRatingValue,
    subtitles: s.subtitles ? s.subtitles.split(',').map(x => x.trim()) : [],
    hasResource: s.hasResource,
    trailer: s.trailer && s.trailer.videoAddress && s.trailer.videoAddress.url
  };
}

async function fetchPlay(id, se = 0, ep = 0) {
  if (!id) throw new Error("Parameter 'id' (subjectId) wajib diisi");
  const season = Math.max(0, parseInt(se, 10) || 0);
  const episode = Math.max(0, parseInt(ep, 10) || 0);

  await ensureGuest();
  const path = `/wefeed-mobile-bff/subject-api/play-info?subjectId=${encodeURIComponent(id)}&se=${season}&ep=${episode}`;
  let r = await mobileGet(path);
  let j;
  try {
    j = JSON.parse(r.body);
  } catch (_) {
    throw new Error('Respons streaming bukan JSON valid');
  }

  // Jika token expired atau error 401, coba refresh session sekali
  if (j.code !== 0 && (r.status === 401 || j.code === 401)) {
    guestJwt = null;
    await ensureGuest(true);
    r = await mobileGet(path);
    try {
      j = JSON.parse(r.body);
    } catch (_) {
      throw new Error('Respons streaming bukan JSON valid');
    }
  }

  if (j.code !== 0) throw new Error(j.message || `Gagal mengambil stream (code: ${j.code})`);

  const d = j.data || {};
  const streams = [];
  for (const s of (d.streams || [])) {
    const decoded = decodeSignCookie(s.signCookie);
    streams.push({
      format: s.format,
      id: s.id,
      resolutions: s.resolutions,
      size: s.size,
      duration: s.duration,
      codec: s.codecName,
      trapUrl: s.url,
      signCookie: s.signCookie,
      dash: decoded && decoded.mpd,
      hls: decoded && decoded.m3u8,
      prefix: decoded && decoded.prefix,
      cookieHeader: s.signCookie ? ('Edge-Cache-Cookie=' + String(s.signCookie).replace(/^Edge-Cache-Cookie=/, '')) : null
    });
  }

  return {
    subjectId: id,
    se: season,
    ep: episode,
    title: d.title,
    url: streams[0]?.dash || streams[0]?.hls || null,
    playUrl: streams[0]?.dash || null,
    playHls: streams[0]?.hls || null,
    cookieHeader: streams[0]?.cookieHeader || null,
    streams,
    note: streams.length
      ? 'Gunakan url dash/hls dengan menyertakan Cookie header dari cookieHeader'
      : 'Tidak ada stream yang tersedia untuk judul/episode ini'
  };
}

const ACTIONS = ['home', 'trending', 'detail', 'play', 'stream'];

export default {
  name: 'MovieBox',
  description: 'Katalog, trending, detail film & serial, dan link streaming DASH/HLS dari MovieBox',
  category: 'Movie',
  methods: ['GET', 'POST'],
  params: ['action', 'id', 'page', 'se', 'ep'],
  paramsSchema: {
    action: {
      type: 'string',
      required: true,
      enum: ACTIONS,
      description: `Aksi yang ingin dijalankan (${ACTIONS.join(', ')})`,
      example: 'trending'
    },
    id: {
      type: 'string',
      required: false,
      description: 'Subject ID film atau serial (wajib untuk action=detail dan action=play)',
      example: '223695587521217720'
    },
    page: {
      type: 'number',
      required: false,
      description: 'Nomor halaman untuk action=trending (default: 0)',
      example: 0
    },
    se: {
      type: 'number',
      required: false,
      description: 'Nomor season untuk action=play (default: 0)',
      example: 0
    },
    ep: {
      type: 'number',
      required: false,
      description: 'Nomor episode untuk action=play (default: 0)',
      example: 0
    }
  },

  async run(req, res) {
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
    const id = String(params.id || params.subjectId || '').trim();
    const page = params.page !== undefined ? parseInt(params.page, 10) : 0;
    const se = params.se !== undefined ? parseInt(params.se, 10) : 0;
    const ep = params.ep !== undefined ? parseInt(params.ep, 10) : 0;

    logger.info(`[MovieBox] Request action=${action}${id ? ` id=${id}` : ''}`);

    try {
      if (action === 'home') {
        const data = await fetchHome();
        return res.status(200).json({
          status: true,
          action,
          result: data
        });
      }

      if (action === 'trending') {
        const items = await fetchTrending(page);
        return res.status(200).json({
          status: true,
          action,
          page,
          total: items.length,
          result: items
        });
      }

      if (action === 'detail') {
        if (!id) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' (subjectId) wajib diisi untuk action=detail"
          });
        }
        const data = await fetchDetail(id);
        return res.status(200).json({
          status: true,
          action,
          result: data
        });
      }

      if (action === 'play' || action === 'stream') {
        if (!id) {
          return res.status(400).json({
            status: false,
            message: `Parameter 'id' (subjectId) wajib diisi untuk action=${action}`
          });
        }
        const data = await fetchPlay(id, se, ep);
        return res.status(200).json({
          status: true,
          action,
          result: data
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak dikenali`
      });
    } catch (err) {
      logger.error(`[MovieBox] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        action,
        message: err.message || 'Terjadi kesalahan saat memproses data MovieBox'
      });
    }
  }
};

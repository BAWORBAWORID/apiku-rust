/**
 * AnimeIn Scraper API
 * Provider: AnimeInWeb (https://animeinweb.com)
 * Fitur   : Scrape catalog anime, trending/home, search, detail anime & daftar episode,
 *           direct video stream MP4 & embed multi-server (360p-1080p), populer, dan jadwal rilis harian.
 */

import logger from "../../src/utils/logger.js";

const BASE = "https://animeinweb.com";
const API = BASE + "/api/proxy";
const SECRET = "animein-secure-proxy-key-123";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const DAY_NAMES = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];

let jar = "";

function mergeCookies(h) {
  if (!h) return;
  const arr = Array.isArray(h) ? h : [h];
  for (const c of arr) {
    const kv = c.split(";")[0].trim();
    if (!kv || !kv.includes("=")) continue;
    const name = kv.split("=")[0];
    const parts = jar ? jar.split("; ").filter(Boolean) : [];
    const next = parts.filter((p) => !p.startsWith(name + "="));
    next.push(kv);
    jar = next.join("; ");
  }
}

async function fetchAPI(path, params = null, method = "GET", body = null) {
  const maxRetries = 2;
  let last;
  for (let a = 0; a <= maxRetries; a++) {
    try {
      return await _onceAPI(path, params, method, body);
    } catch (e) {
      last = e;
      const m = (e && e.message) || String(e);
      const t =
        m.includes("timeout") ||
        m.includes("Timeout") ||
        m.includes("fetch failed") ||
        (e && e.code === "UND_ERR_CONNECT_TIMEOUT");
      if (t && a < maxRetries) {
        await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function _onceAPI(path, params, method, body) {
  let url = API + path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += "?" + qs;
  }
  const headers = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    Referer: BASE + "/",
    "x-proxy-secret": SECRET,
  };
  if (jar) headers["Cookie"] = jar;
  if (method !== "GET" && body && !(body instanceof URLSearchParams)) {
    headers["Content-Type"] = "application/json";
  }
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? (body instanceof URLSearchParams ? body.toString() : JSON.stringify(body)) : undefined,
    redirect: "manual",
    signal,
  });
  let sc;
  if (typeof res.headers.getSetCookie === "function") sc = res.headers.getSetCookie();
  else {
    const v = res.headers.get("set-cookie");
    sc = v ? [v] : [];
  }
  mergeCookies(sc);
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response dari provider AnimeIn");
  }
  if (j.error || j.status !== 200) {
    throw new Error((j.message || j.error || "Gagal mengambil data AnimeIn") + (j.status ? ` (Status ${j.status})` : ""));
  }
  return j.data;
}

function extractId(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = s.match(/\/anime\/(\d+)/);
  if (m) return m[1];
  const m2 = s.match(/\/watch\/(\d+)/);
  if (m2) return m2[1];
  const m3 = s.match(/(\d{2,7})/);
  if (m3 && /^\d+$/.test(s)) return s;
  if (m3) return m3[1];
  return s;
}

function imageFull(p) {
  if (!p) return "";
  if (p.startsWith("http")) return p;
  if (p.startsWith("//")) return "https:" + p;
  if (p.startsWith("/assets")) return "https://xyz-api.animein.net" + p;
  if (p.startsWith("/")) return "https://animeinweb.com" + p;
  return p;
}

function todayDay() {
  return DAY_NAMES[new Date().getDay()];
}

// Scraper Methods
async function scrapeHome() {
  const day = todayDay();
  const data = await fetchAPI("/3/2/home/data", { day, limit: "16" });
  return {
    source: BASE + "/",
    type: "home",
    day,
    slider: (data.slider || []).map((s) => ({ id: s.id, type: s.type, image: imageFull(s.image), link: s.link })),
    hot: (data.hot || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      year: m.year,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
      genre: m.genre,
    })),
    new: (data.new || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      year: m.year,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
      genre: m.genre,
    })),
    today: (data.today || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
      genre: m.genre,
      time: m.time,
    })),
    popular: (data.popular || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
      genre: m.genre,
    })),
    waiting: (data.waiting || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      type: m.type,
      status: m.status,
      favorites: m.favorites,
      genre: m.genre,
    })),
    random: (data.random || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
    })),
    trailer: data.trailer || [],
    counts: {
      slider: (data.slider || []).length,
      hot: (data.hot || []).length,
      new: (data.new || []).length,
      today: (data.today || []).length,
      popular: (data.popular || []).length,
      waiting: (data.waiting || []).length,
      random: (data.random || []).length,
    },
  };
}

async function scrapeDetail(rawId) {
  const id = extractId(rawId);
  if (!id) throw new Error("ID atau URL anime wajib diisi untuk detail anime");
  const data = await fetchAPI("/3/2/movie/detail/" + id, null);
  const m = data.movie || {};
  const ep = data.episode || null;
  const seasons = data.season || [];
  return {
    source: BASE + "/anime/" + id,
    type: "anime",
    id: m.id || id,
    title: m.title || "",
    synonyms: m.synonyms || "",
    synopsis: m.synopsis || "",
    image_poster: imageFull(m.image_poster || ""),
    image_cover: imageFull(m.image_cover || ""),
    poster: imageFull(m.image_poster || ""),
    cover: imageFull(m.image_cover || ""),
    type_anime: m.type || "",
    year: m.year || "",
    day: m.day || "",
    status: m.status || "",
    views: m.views || "",
    favorites: m.favorites || "",
    studio: m.studio || "",
    aired_start: m.aired_start || "",
    aired_end: m.aired_end || "",
    genre: m.genre || "",
    time: m.time || "",
    first_episode: ep
      ? {
          id: ep.id,
          index: ep.index,
          title: ep.title,
          views: ep.views,
          key_time: ep.key_time,
          image: imageFull(ep.image),
          url: BASE + "/watch/" + ep.id,
        }
      : null,
    seasons: seasons.map((s) => ({
      id: s.id,
      title: s.title,
      season: s.season || "",
      type: s.type,
      year: s.year,
      status: s.status,
      views: s.views,
      favorites: s.favorites,
      url: BASE + "/anime/" + s.id,
    })),
    seasons_count: seasons.length,
  };
}

async function scrapeEpisodes(rawId) {
  const id = extractId(rawId);
  if (!id) throw new Error("ID atau URL anime wajib diisi untuk daftar episode");
  const detail = await fetchAPI("/3/2/movie/detail/" + id, null);
  const title = (detail.movie && detail.movie.title) || "";
  const episodes = [];
  let page = 0;
  while (true) {
    const data = await fetchAPI("/3/2/movie/episode/" + id, { page: String(page) });
    const eps = data.episode || [];
    if (!eps.length) break;
    for (const e of eps) {
      episodes.push({
        id: e.id,
        index: e.index,
        title: e.title,
        views: e.views,
        key_time: e.key_time,
        image: imageFull(e.image),
        url: BASE + "/watch/" + e.id,
        anime_url: BASE + "/anime/" + id,
        stream_api: BASE + "/api/proxy/3/2/episode/streamnew/" + e.id,
        is_new: e.is_new || "0",
        is_book: e.is_book ?? 0,
      });
    }
    if (eps.length < 30) break;
    page++;
    if (page > 60) break;
  }
  return {
    source: BASE + "/anime/" + id,
    type: "episodes",
    anime_id: id,
    anime_title: title,
    count: episodes.length,
    episodes,
  };
}

async function scrapePopuler(pageRaw = 0) {
  const page = parseInt(pageRaw, 10) || 0;
  const data = await fetchAPI("/3/2/explore/movie", { page: String(page), sort: "views", keyword: "" });
  const items = (data.movie || []).map((m) => ({
    id: m.id,
    title: m.title,
    url: BASE + "/anime/" + m.id,
    image_poster: imageFull(m.image_poster),
    image_cover: imageFull(m.image_cover),
    type: m.type,
    year: m.year,
    status: m.status,
    views: m.views,
    favorites: m.favorites,
    genre: m.genre,
  }));
  return {
    source: BASE + "/explore",
    type: "populer",
    page,
    count: items.length,
    items,
  };
}

async function searchAnime(query, pageRaw = 0) {
  const q = (query || "").trim();
  if (!q) throw new Error("Parameter 'query' wajib diisi untuk pencarian anime");
  const page = parseInt(pageRaw, 10) || 0;
  const data = await fetchAPI("/3/2/explore/movie", { page: String(page), sort: "views", keyword: q });
  const items = (data.movie || []).map((m) => ({
    id: m.id,
    title: m.title,
    url: BASE + "/anime/" + m.id,
    image_poster: imageFull(m.image_poster),
    image_cover: imageFull(m.image_cover),
    type: m.type,
    year: m.year,
    status: m.status,
    views: m.views,
    favorites: m.favorites,
    genre: m.genre,
  }));
  return {
    source: BASE + "/explore?keyword=" + encodeURIComponent(q),
    type: "search",
    query: q,
    page,
    count: items.length,
    items,
  };
}

async function scrapeJadwal(dayRaw = "") {
  const raw = (dayRaw || "").trim().toUpperCase();
  if (raw && DAY_NAMES.includes(raw)) {
    const data = await fetchAPI("/3/2/schedule/data", { day: raw });
    const items = (data.movie || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
      genre: m.genre,
      day: m.day,
      time: m.time,
      key_time: m.key_time,
    }));
    return {
      source: BASE + "/schedule",
      type: "jadwal",
      day: raw,
      count: items.length,
      items,
    };
  }

  const all = [];
  const byDay = {};
  for (const d of DAY_NAMES) {
    const data = await fetchAPI("/3/2/schedule/data", { day: d });
    const items = (data.movie || []).map((m) => ({
      id: m.id,
      title: m.title,
      url: BASE + "/anime/" + m.id,
      image_poster: imageFull(m.image_poster),
      image_cover: imageFull(m.image_cover),
      type: m.type,
      status: m.status,
      views: m.views,
      favorites: m.favorites,
      genre: m.genre,
      day: m.day,
      time: m.time,
      key_time: m.key_time,
    }));
    byDay[d] = { count: items.length, items };
    for (const it of items) all.push(it);
  }
  return {
    source: BASE + "/schedule",
    type: "jadwal",
    count: all.length,
    by_day: byDay,
    items: all,
  };
}

async function scrapeStream(rawId) {
  const id = extractId(rawId);
  if (!id) throw new Error("Parameter 'id' episode wajib diisi untuk stream episode");
  const data = await fetchAPI("/3/2/episode/streamnew/" + id, null);
  const ep = data.episode || {};
  const next = data.episode_next || null;
  const servers = (data.server || []).map((s) => ({
    id: s.id,
    name: s.name,
    quality: s.quality,
    type: s.type,
    link: s.link,
    url_stream: s.link,
    embed_url: s.link,
    key_file_size: s.key_file_size,
    server_id: s.server_id,
    username: s.username || "",
  }));
  const directMp4 = servers.find((s) => s.type === "direct" && s.link.includes(".mp4"));
  const defaultStream = directMp4 ? directMp4.link : (servers[0] ? servers[0].link : "");

  return {
    source: BASE + "/watch/" + id,
    type: "stream",
    episode: ep
      ? {
          id: ep.id,
          index: ep.index,
          title: ep.title,
          views: ep.views,
          key_time: ep.key_time,
          image: imageFull(ep.image),
          url: BASE + "/watch/" + ep.id,
        }
      : null,
    episode_next: next
      ? {
          id: next.id,
          index: next.index,
          title: next.title,
          url: BASE + "/watch/" + next.id,
        }
      : null,
    count: servers.length,
    stream_url: defaultStream,
    embed_url: defaultStream,
    servers,
  };
}

export default {
  name: "AnimeIn",
  description:
    "Scraper AnimeInWeb — streaming anime subtitle Indonesia: trending/home, search, detail anime, daftar episode, stream direct video MP4 & embed, anime populer, dan jadwal rilis harian.",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "id", "url", "page", "day"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "home",
      description: "Aksi: home, search, detail, episode, stream, populer, jadwal",
      enum: ["home", "search", "detail", "episode", "stream", "populer", "jadwal"],
      example: "home",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian anime (action=search)",
      example: "Naruto",
    },
    id: {
      type: "string",
      required: false,
      description: "ID anime (action=detail, episode) atau ID episode (action=stream). Contoh: 1280 atau 52732",
      example: "1280",
    },
    url: {
      type: "string",
      required: false,
      description: "URL lengkap anime atau episode AnimeInWeb",
      example: "https://animeinweb.com/anime/1280",
    },
    page: {
      type: "number",
      required: false,
      default: 0,
      description: "Halaman pagination untuk search dan populer (dimulai dari 0)",
      example: 0,
    },
    day: {
      type: "string",
      required: false,
      description: "Filter hari untuk jadwal: MINGGU, SENIN, SELASA, RABU, KAMIS, JUMAT, SABTU (opsional)",
      example: "SENIN",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      let action = String(params.action || "").trim().toLowerCase();
      const q = String(params.query || params.q || "").trim();
      const target = String(params.id || params.url || q || "").trim();
      const page = parseInt(params.page || params.p || 0, 10) || 0;
      const day = String(params.day || "").trim().toUpperCase();

      // Auto-detect action jika tidak ditentukan
      if (!action) {
        if (params.day || params.hari) action = "jadwal";
        else if (params.episode_id) action = "stream";
        else if (params.url && (params.url.includes("/watch/") || params.url.includes("/episode/"))) action = "stream";
        else if (params.url && params.url.includes("/anime/")) action = "detail";
        else if (q) action = "search";
        else if (params.id) action = "detail";
        else action = "home";
      }

      logger.info(`[ANIMEIN] Request action=${action} target=${target || "-"}`);

      // 1. Home
      if (action === "home") {
        const data = await scrapeHome();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 2. Search
      if (action === "search" || action === "cari") {
        if (!q && !target) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const data = await searchAnime(q || target, page);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 3. Detail Anime
      if (action === "detail" || action === "anime") {
        if (!target) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'url' anime wajib diisi untuk action=detail",
          });
        }
        const data = await scrapeDetail(target);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 4. Daftar Episode
      if (action === "episode" || action === "episodes" || action === "eps") {
        if (!target) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'url' anime wajib diisi untuk action=episode",
          });
        }
        const data = await scrapeEpisodes(target);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 5. Stream Video
      if (action === "stream" || action === "play" || action === "watch") {
        const epId = params.episode_id || target;
        if (!epId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' episode wajib diisi untuk action=stream",
          });
        }
        const data = await scrapeStream(epId);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 6. Populer
      if (action === "populer" || action === "popular" || action === "trending") {
        const data = await scrapePopuler(page);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 7. Jadwal Rilis
      if (action === "jadwal" || action === "schedule") {
        const data = await scrapeJadwal(day);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: home, search, detail, episode, stream, populer, jadwal`,
      });
    } catch (err) {
      logger.error(`[ANIMEIN] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data AnimeIn",
      });
    }
  },
};

/**
 * MovieZone API Scraper
 * Base Web: https://moviezone.web.id
 * Fitur   : Trending, Popular, Latest, Upcoming, Top-Rated, Search, & Detail Movie/Series dengan Multi-Server Streaming Embed
 */

import https from "node:https";
import zlib from "node:zlib";
import logger from "../../src/utils/logger.js";

const HOST = "moviezone.web.id";
const BASE_URL = "https://" + HOST;
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";

const ACTIONS = [
  "trending",
  "search",
  "detail",
  "stream",
  "play",
  "popular",
  "latest",
  "upcoming",
  "toprated",
];

const jar = new Map();
if (process.env.MZ_COOKIE) {
  process.env.MZ_COOKIE.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  });
}

function cookieHeader() {
  return [...jar].map(([k, v]) => k + "=" + v).join("; ");
}

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const h = {
      "User-Agent": UA,
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      ...headers,
    };
    if (jar.size) h.Cookie = cookieHeader();

    const r = https.request({ hostname: HOST, path, method: "GET", headers: h }, (res) => {
      for (const c of res.headers["set-cookie"] || []) {
        const pair = c.split(";")[0];
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }

      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = res.headers["content-encoding"];
          if (enc === "gzip") buf = zlib.gunzipSync(buf);
          else if (enc === "deflate") buf = zlib.inflateSync(buf);
          else if (enc === "br") buf = zlib.brotliDecompressSync(buf);
        } catch {}
        resolve({ status: res.statusCode, body: buf.toString() });
      });
    });

    r.setTimeout(30000, () => {
      r.destroy();
      reject(new Error("Koneksi timeout ke MovieZone"));
    });
    r.on("error", reject);
    r.end();
  });
}

async function initSession() {
  await request("/", {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  });
}

function apiHeaders() {
  return {
    Accept: "*/*",
    Referer: BASE_URL + "/",
    Origin: BASE_URL,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

function parse(res) {
  let j;
  try {
    j = JSON.parse(res.body);
  } catch {
    throw new Error(`Respon bukan JSON (HTTP ${res.status}): ${res.body.slice(0, 120)}`);
  }
  return j;
}

function isSessionError(j, res) {
  const msg = String((j && (j.message || j.error)) || "").toLowerCase();
  return (
    msg.includes("sesi") ||
    msg.includes("session") ||
    res.status === 401 ||
    res.status === 403
  );
}

async function get(path) {
  if (!jar.size) await initSession();
  let res = await request("/api/movies" + path, apiHeaders());
  let j = parse(res);

  if (isSessionError(j, res)) {
    jar.clear();
    await initSession();
    res = await request("/api/movies" + path, apiHeaders());
    j = parse(res);
  }

  if (res.status >= 400 || j.status === false) {
    const m = (j && (j.message || j.error)) || `HTTP ${res.status}`;
    throw new Error(m);
  }

  return j.results !== undefined ? j.results : j;
}

function pick(o, ...keys) {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return "";
}

function toList(r) {
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.data)) return r.data;
  if (r && Array.isArray(r.movies)) return r.movies;
  if (r && Array.isArray(r.results)) return r.results;
  return [];
}

function fmt(m) {
  return {
    title: pick(m, "title", "judul", "name", "nama"),
    type: pick(m, "type", "tipe", "category"),
    year: pick(m, "year", "tahun", "release_date", "date"),
    rating: pick(m, "rating", "score", "vote_average", "nilai"),
    genre: pick(m, "genre", "genres", "kategori"),
    poster: pick(m, "poster", "image", "thumbnail", "img", "cover"),
    slug: pick(m, "slug", "id", "url", "link", "href"),
  };
}

function fmtDetail(raw) {
  const stream = raw.stream && typeof raw.stream === "object" ? raw.stream : {};
  let servers = Array.isArray(stream.servers) ? stream.servers : [];
  if (!servers.length && Array.isArray(raw.servers)) servers = raw.servers;

  const list = servers
    .map((s, i) => ({
      name: s.server || s.name || s.label || `Server ${i + 1}`,
      url: s.url || s.link || s.embed || "",
    }))
    .filter((s) => s.url);

  const cast = Array.isArray(raw.cast)
    ? raw.cast.map((c) => (typeof c === "string" ? c : (c && c.name) || "")).filter(Boolean)
    : [];

  const genres = Array.isArray(raw.genres)
    ? raw.genres
    : Array.isArray(raw.genre)
    ? raw.genre
    : [];

  return {
    title: pick(raw, "title", "judul", "name"),
    slug: pick(raw, "slug", "id"),
    type: pick(raw, "type", "tipe"),
    year: pick(raw, "year"),
    release_date: pick(raw, "releaseDate", "release_date"),
    rating: pick(raw, "rating", "score"),
    duration: pick(raw, "duration", "durasi", "runtime"),
    status: pick(raw, "status"),
    tagline: pick(raw, "tagline"),
    synopsis: pick(raw, "synopsis", "sinopsis", "overview"),
    genres,
    director: pick(raw, "director", "sutradara"),
    cast,
    seasons: pick(raw, "numberOfSeasons"),
    episodes: pick(raw, "numberOfEpisodes"),
    poster: pick(raw, "poster", "image"),
    backdrop: pick(raw, "backdrop", "banner"),
    trailer: pick(raw, "trailer"),
    primary_stream: stream.primaryIframe || (list[0] && list[0].url) || "",
    servers: list,
  };
}

function adjustEpisode(url, s, e) {
  if (!s && !e) return url;
  let out = url;
  if (s) {
    out = out.replace(/([&?]s=)\d+/i, `$1${s}`)
             .replace(/\/tv\/([^\/]+)\/\d+(\/\d+)/i, `/tv/$1/${s}$2`)
             .replace(/\/embedtv\/([^&]+)&s=\d+/i, `/embedtv/$1&s=${s}`);
  }
  if (e) {
    out = out.replace(/([&?]e=)\d+/i, `$1${e}`)
             .replace(/\/tv\/([^\/]+)\/(\d+)\/\d+/i, `/tv/$1/$2/${e}`)
             .replace(/(&e=)\d+/i, `$1${e}`);
  }
  return out;
}

export default {
  name: "MovieZone",
  description: "Scraper film dan serial MovieZone (trending, search, popular, latest, upcoming, toprated, serta streaming embed langsung)",
  category: "Movie",
  methods: ["GET", "POST"],
  params: ["action", "query", "slug", "id", "server", "se", "ep", "play", "type"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      enum: ACTIONS,
      description: `Aksi yang ingin dijalankan (${ACTIONS.join(", ")}). Default: 'trending', otomatis 'search' jika query diisi, otomatis 'detail' jika slug diisi, 'stream' untuk mendapatkan link streaming embed`,
      example: "trending",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci judul film/serial untuk pencarian (action=search) atau stream",
      example: "avengers",
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug atau ID film/serial untuk detail dan streaming (action=detail, stream)",
      example: "movie-969681",
    },
    server: {
      type: "string",
      required: false,
      description: "Pilihan nama atau nomor server streaming (action=stream). Contoh: 'VidSrcWiki', 'SuperEmbed', '1'",
      example: "VidSrcWiki",
    },
    se: {
      type: "number",
      required: false,
      description: "Nomor season untuk TV Series (action=stream)",
      example: 1,
    },
    ep: {
      type: "number",
      required: false,
      description: "Nomor episode untuk TV Series (action=stream)",
      example: 1,
    },
    play: {
      type: "boolean",
      required: false,
      description: "Jika true pada action=stream, menyajikan responsive embed web player HTML langsung",
      example: false,
    },
    type: {
      type: "string",
      required: false,
      enum: ["all", "movie", "tv"],
      description: "Filter tipe konten untuk action popular/latest/toprated (default: all / movie)",
      example: "all",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    let action = params.action ? String(params.action).trim().toLowerCase() : "";
    const query = String(params.query || params.q || "").trim();
    const slug = String(params.slug || params.id || "").trim();
    const type = String(params.type || "").trim().toLowerCase();

    if (!action) {
      if (slug) action = "detail";
      else if (query) action = "search";
      else action = "trending";
    }

    if (!ACTIONS.includes(action)) {
      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: ${ACTIONS.join(", ")}`,
      });
    }

    logger.info(`[MovieZone] Request action=${action}${query ? ` query=${query}` : ""}${slug ? ` slug=${slug}` : ""}`);

    try {
      if (action === "search") {
        if (!query) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const raw = await get("/search?q=" + encodeURIComponent(query) + "&page=1");
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          query,
          total: items.length,
          result: items,
        });
      }

      if (action === "detail") {
        if (!slug) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'slug' (atau 'id') wajib diisi untuk action=detail",
          });
        }
        const raw = await get("/detail/" + encodeURIComponent(slug));
        const data = fmtDetail(Array.isArray(raw) ? raw[0] || {} : raw);
        return res.status(200).json({
          status: true,
          action,
          slug,
          result: data,
        });
      }

      if (action === "stream" || action === "play") {
        let targetSlug = slug;
        if (!targetSlug && query) {
          const searchRaw = await get("/search?q=" + encodeURIComponent(query) + "&page=1");
          const searchItems = toList(searchRaw).map(fmt);
          if (!searchItems.length) {
            return res.status(404).json({
              status: false,
              message: `Film atau serial '${query}' tidak ditemukan`,
            });
          }
          targetSlug = searchItems[0].slug;
        }

        if (!targetSlug) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'slug' (atau 'query') wajib diisi untuk action=stream",
          });
        }

        const raw = await get("/detail/" + encodeURIComponent(targetSlug));
        const data = fmtDetail(Array.isArray(raw) ? raw[0] || {} : raw);

        const season = params.se || params.season;
        const episode = params.ep || params.episode;
        const isTv = String(data.type || "").toLowerCase().includes("series") || String(targetSlug).startsWith("tv-") || Boolean(data.seasons || data.episodes);

        const servers = data.servers.map((s) => ({
          name: s.name,
          url: isTv ? adjustEpisode(s.url, season, episode) : s.url,
        }));

        let primaryStream = data.primary_stream;
        if (isTv && primaryStream) {
          primaryStream = adjustEpisode(primaryStream, season, episode);
        }

        const reqServer = String(params.server || "").trim();
        let selected = servers[0] || { name: "Default", url: primaryStream };
        if (reqServer) {
          const idx = parseInt(reqServer, 10);
          if (!isNaN(idx) && idx >= 1 && idx <= servers.length) {
            selected = servers[idx - 1];
          } else {
            const found = servers.find((s) => s.name.toLowerCase() === reqServer.toLowerCase());
            if (found) selected = found;
          }
        }

        const streamUrl = selected.url || primaryStream;
        const shouldPlay = String(params.play || "").toLowerCase() === "true" || params.play === true || action === "play";

        if (shouldPlay) {
          const title = data.title || targetSlug;
          const epInfo = isTv && (season || episode) ? ` (S${season || 1} E${episode || 1})` : "";
          const optionsHtml = servers.map((s) => `
            <a href="?action=stream&slug=${encodeURIComponent(targetSlug)}${season ? `&se=${season}` : ""}${episode ? `&ep=${episode}` : ""}&server=${encodeURIComponent(s.name)}&play=true"
               class="btn ${s.name === selected.name ? "active" : ""}">
               ${s.name}
            </a>
          `).join("");

          const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Streaming: ${title}${epInfo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0b0f19; color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; min-height: 100vh; }
    .header { padding: 12px 20px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .title { font-size: 16px; font-weight: 600; color: #fff; }
    .servers { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { padding: 6px 12px; border-radius: 6px; font-size: 13px; text-decoration: none; background: #1f2937; color: #9ca3af; border: 1px solid #374151; transition: all .2s; }
    .btn:hover { background: #374151; color: #fff; }
    .btn.active { background: #2563eb; color: #fff; border-color: #3b82f6; font-weight: 600; }
    .player-wrap { flex: 1; position: relative; width: 100%; min-height: 480px; background: #000; }
    iframe { width: 100%; height: 100%; position: absolute; top: 0; left: 0; border: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${title}${epInfo} — Server: ${selected.name}</div>
    <div class="servers">${optionsHtml}</div>
  </div>
  <div class="player-wrap">
    <iframe src="${streamUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</body>
</html>`;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.send(html);
        }

        return res.status(200).json({
          status: true,
          action: "stream",
          slug: targetSlug,
          result: {
            title: data.title,
            slug: data.slug || targetSlug,
            type: data.type,
            year: data.year,
            rating: data.rating,
            poster: data.poster,
            season: isTv ? (season || 1) : null,
            episode: isTv ? (episode || 1) : null,
            server: selected.name,
            url: streamUrl,
            stream_url: streamUrl,
            primary_stream: primaryStream,
            servers,
            iframe: `<iframe src="${streamUrl}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`,
            player_url: `/api/movie/moviezone?action=stream&slug=${encodeURIComponent(targetSlug)}${season ? `&se=${season}` : ""}${episode ? `&ep=${episode}` : ""}&play=true`,
          },
        });
      }

      if (action === "trending") {
        const raw = await get("/trending");
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          total: items.length,
          result: items,
        });
      }

      if (action === "popular") {
        const targetType = type || "all";
        const raw = await get("/popular?page=1&type=" + targetType);
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          type: targetType,
          total: items.length,
          result: items,
        });
      }

      if (action === "latest") {
        const targetType = type || "all";
        const raw = await get("/latest?type=" + targetType);
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          type: targetType,
          total: items.length,
          result: items,
        });
      }

      if (action === "upcoming") {
        const raw = await get("/upcoming");
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          total: items.length,
          result: items,
        });
      }

      if (action === "toprated") {
        const targetType = type || "movie";
        const raw = await get("/top-rated?type=" + targetType);
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          type: targetType,
          total: items.length,
          result: items,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak dikenali`,
      });
    } catch (err) {
      logger.error(`[MovieZone] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        action,
        message: err.message || "Terjadi kesalahan saat memproses data MovieZone",
      });
    }
  },
};

/**
 * Crunchyroll Anime Scraper & Stream Resolver
 * Sumber : https://beta-api.crunchyroll.com & JustWatch GraphQL
 * Fitur  : search, detail, seasons, episodes, play (multi-embed), full
 *
 * GET /api/anime/crunchyroll?q=naruto
 * GET /api/anime/crunchyroll?action=search&q=naruto
 * GET /api/anime/crunchyroll?action=detail&id=GY9PJ5KWR
 * GET /api/anime/crunchyroll?action=seasons&id=GY9PJ5KWR
 * GET /api/anime/crunchyroll?action=episodes&id=G6195GE7Y
 * GET /api/anime/crunchyroll?action=play&tmdb=46260&season=1&episode=1
 */

import https from "node:https";
import { URL } from "node:url";
import logger from "../../src/utils/logger.js";

const CR = "https://beta-api.crunchyroll.com";
const JW = "https://apis.justwatch.com/graphql";
const UA_CR = "Crunchyroll/3.74.2 Android/14";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASIC = "Y3Jfd2ViOg==";

let cachedToken = null;
let tokenExpiresAt = 0;

function httpRequest(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body || null;
    const h = Object.assign({ "User-Agent": UA, Accept: "application/json" }, headers);
    if (payload) {
      h["Content-Type"] = h["Content-Type"] || "application/json";
      h["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: h,
        timeout: 25000
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function getCrunchyrollToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }
  const res = await httpRequest("POST", `${CR}/auth/v1/token`, "grant_type=client_id", {
    "User-Agent": UA_CR,
    Authorization: `Basic ${BASIC}`,
    "Content-Type": "application/x-www-form-urlencoded"
  });
  if (!res.json || !res.json.access_token) {
    throw new Error("Gagal mendapatkan akses token Crunchyroll");
  }
  cachedToken = res.json.access_token;
  tokenExpiresAt = Date.now() + (res.json.expires_in || 300) * 1000;
  return cachedToken;
}

async function crunchyrollGet(path) {
  const token = await getCrunchyrollToken();
  const res = await httpRequest("GET", `${CR}${path}`, null, {
    "User-Agent": UA_CR,
    Authorization: `Bearer ${token}`
  });
  if (res.status >= 400) {
    throw new Error(`Crunchyroll API HTTP ${res.status}`);
  }
  return res.json;
}

async function searchCrunchyroll(query) {
  const json = await crunchyrollGet(
    `/content/v2/discover/search?q=${encodeURIComponent(query)}&n=12&type=series,movie_listing&locale=en-US`
  );
  const out = [];
  for (const block of json.data || []) {
    for (const item of block.items || []) {
      out.push({
        crId: item.id,
        type: item.type || block.type,
        title: item.title,
        description: (item.description || "").slice(0, 200),
        slug: item.slug_title
      });
    }
  }
  return out;
}

async function getCrunchyrollSeasons(seriesId) {
  const json = await crunchyrollGet(
    `/content/v2/cms/series/${encodeURIComponent(seriesId)}/seasons?locale=en-US`
  );
  return (json.data || []).map((s) => ({
    id: s.id,
    title: s.title,
    season_number: s.season_number,
    episode_count: s.number_of_episodes || s.episode_count
  }));
}

async function getCrunchyrollEpisodes(seasonId) {
  const json = await crunchyrollGet(
    `/content/v2/cms/seasons/${encodeURIComponent(seasonId)}/episodes?locale=en-US`
  );
  return (json.data || []).map((e) => ({
    id: e.id,
    title: e.title,
    episode_number: e.episode_number || e.episode,
    season_number: e.season_number,
    duration_ms: e.duration_ms,
    air_date: e.episode_air_date,
    is_premium: e.is_premium_only
  }));
}

async function getCrunchyrollDetail(seriesId) {
  const json = await crunchyrollGet(
    `/content/v2/cms/series/${encodeURIComponent(seriesId)}?locale=en-US`
  );
  const d = (json.data && json.data[0]) || json.data || json;
  let seasons = [];
  try {
    seasons = await getCrunchyrollSeasons(seriesId);
  } catch {}

  return {
    crId: d.id || seriesId,
    title: d.title,
    description: d.description,
    episode_count: d.episode_count,
    season_count: d.season_count,
    seasons
  };
}

async function mapJustWatch(title) {
  const body = JSON.stringify({
    query:
      'query($q:String!){popularTitles(country:"US",first:8,filter:{searchQuery:$q}){edges{node{id objectId objectType content(country:"US",language:"en"){title originalReleaseYear externalIds{tmdbId imdbId}}}}}}',
    variables: { q: title }
  });
  const res = await httpRequest("POST", JW, body, { "Content-Type": "application/json" });
  const edges = (((res.json || {}).data || {}).popularTitles || {}).edges || [];
  return edges
    .map((e) => {
      const n = e.node || {};
      const c = n.content || {};
      const x = c.externalIds || {};
      return {
        title: c.title,
        year: c.originalReleaseYear,
        type: n.objectType,
        tmdbId: x.tmdbId || null,
        imdbId: x.imdbId || null,
        jwId: n.objectId
      };
    })
    .filter((x) => x.tmdbId);
}

function getTvEmbeds(tmdb, season = 1, episode = 1) {
  const s = Number(season) || 1;
  const ep = Number(episode) || 1;
  return [
    { server: "VidSrc.to", url: `https://vidsrc.to/embed/tv/${tmdb}/${s}/${ep}` },
    { server: "VidSrc.me", url: `https://vidsrc.me/embed/tv?tmdb=${tmdb}&season=${s}&episode=${ep}` },
    { server: "2Embed", url: `https://www.2embed.cc/embedtv/${tmdb}&s=${s}&e=${ep}` },
    { server: "SuperEmbed", url: `https://multiembed.mov/?video_id=${tmdb}&tmdb=1&s=${s}&e=${ep}` },
    { server: "VidLink", url: `https://vidlink.pro/tv/${tmdb}/${s}/${ep}` }
  ];
}

function getMovieEmbeds(tmdb) {
  return [
    { server: "VidSrc.to", url: `https://vidsrc.to/embed/movie/${tmdb}` },
    { server: "VidSrc.me", url: `https://vidsrc.me/embed/movie?tmdb=${tmdb}` },
    { server: "2Embed", url: `https://www.2embed.cc/embed/${tmdb}` },
    { server: "SuperEmbed", url: `https://multiembed.mov/?video_id=${tmdb}&tmdb=1` },
    { server: "VidLink", url: `https://vidlink.pro/movie/${tmdb}` }
  ];
}

async function getFullAnimeInfo(query) {
  const crResults = await searchCrunchyroll(query);
  const jwResults = await mapJustWatch(query);
  const topCr = crResults[0] || null;
  const topJw = jwResults[0] || null;

  let seasons = [];
  if (topCr) {
    try {
      seasons = await getCrunchyrollSeasons(topCr.crId);
    } catch {}
  }

  const tmdb = topJw?.tmdbId || null;
  const isMovie = topJw?.type === "MOVIE";

  return {
    query,
    crunchyroll: {
      top: topCr,
      results: crResults,
      seasons: seasons.slice(0, 10)
    },
    justwatch: {
      top: topJw,
      results: jwResults
    },
    streaming: tmdb
      ? {
          tmdbId: tmdb,
          imdbId: topJw?.imdbId || null,
          type: isMovie ? "movie" : "tv",
          embeds: isMovie ? getMovieEmbeds(tmdb) : getTvEmbeds(tmdb, 1, 1),
          note: isMovie
            ? "Tipe movie — gunakan embed langsung untuk menonton"
            : `Gunakan action=play&tmdb=${tmdb}&season={season}&episode={episode} untuk memutar episode lain`
        }
      : null
  };
}

export default {
  name: "Crunchyroll Anime",
  description:
    "Crunchyroll Anime Scraper & Stream — Search, Detail, Seasons, Episodes & Multi-server Streaming Embeds (VidSrc, 2Embed, SuperEmbed, VidLink) with JustWatch TMDB mapping",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "q", "id", "tmdb", "season", "episode", "type"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "full",
      enum: ["full", "search", "detail", "seasons", "episodes", "play"],
      description: "Aksi yang diinginkan"
    },
    q: {
      type: "string",
      required: false,
      description: "Kata kunci judul anime (wajib untuk action full & search)",
      example: "naruto"
    },
    id: {
      type: "string",
      required: false,
      description: "ID series atau season Crunchyroll (wajib untuk action detail, seasons, episodes)",
      example: "GY9PJ5KWR"
    },
    tmdb: {
      type: "string",
      required: false,
      description: "TMDb ID untuk mendapatkan link player streaming (wajib untuk action play)",
      example: "46260"
    },
    season: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor season anime untuk action play",
      example: 1
    },
    episode: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor episode anime untuk action play",
      example: 1
    },
    type: {
      type: "string",
      required: false,
      default: "tv",
      enum: ["tv", "movie"],
      description: "Tipe tayangan (tv atau movie) untuk action play"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const {
        action = "full",
        q,
        query,
        id,
        tmdb,
        season = 1,
        episode = 1,
        type = "tv"
      } = { ...req.query, ...req.body };

      const searchTerm = (q || query || "").trim();
      const currentAction = String(action || "full").toLowerCase();

      switch (currentAction) {
        case "search": {
          if (!searchTerm) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'q' wajib diisi untuk action search"
            });
          }
          const results = await searchCrunchyroll(searchTerm);
          return res.json({
            status: true,
            action: "search",
            query: searchTerm,
            total: results.length,
            result: results,
            responseTime: `${Date.now() - startTime}ms`
          });
        }

        case "detail": {
          const seriesId = (id || searchTerm).trim();
          if (!seriesId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' (Series ID Crunchyroll) wajib diisi"
            });
          }
          const detail = await getCrunchyrollDetail(seriesId);
          return res.json({
            status: true,
            action: "detail",
            result: detail,
            responseTime: `${Date.now() - startTime}ms`
          });
        }

        case "seasons": {
          const seriesId = (id || searchTerm).trim();
          if (!seriesId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' (Series ID Crunchyroll) wajib diisi"
            });
          }
          const seasons = await getCrunchyrollSeasons(seriesId);
          return res.json({
            status: true,
            action: "seasons",
            seriesId,
            total: seasons.length,
            result: seasons,
            responseTime: `${Date.now() - startTime}ms`
          });
        }

        case "episodes": {
          const seasonId = (id || searchTerm).trim();
          if (!seasonId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'id' (Season ID Crunchyroll) wajib diisi"
            });
          }
          const episodes = await getCrunchyrollEpisodes(seasonId);
          return res.json({
            status: true,
            action: "episodes",
            seasonId,
            total: episodes.length,
            result: episodes,
            responseTime: `${Date.now() - startTime}ms`
          });
        }

        case "play": {
          const targetTmdb = (tmdb || id || "").trim();
          if (!targetTmdb) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'tmdb' wajib diisi untuk action play"
            });
          }

          const seNum = parseInt(season, 10) || 1;
          const epNum = parseInt(episode, 10) || 1;
          const isMovie = String(type).toLowerCase() === "movie";

          const embeds = isMovie
            ? getMovieEmbeds(targetTmdb)
            : getTvEmbeds(targetTmdb, seNum, epNum);

          return res.json({
            status: true,
            action: "play",
            tmdb: targetTmdb,
            type: isMovie ? "movie" : "tv",
            ...(!isMovie && { season: seNum, episode: epNum }),
            result: embeds,
            responseTime: `${Date.now() - startTime}ms`
          });
        }

        case "full":
        default: {
          if (!searchTerm) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'q' wajib diisi untuk pencarian anime"
            });
          }
          const fullInfo = await getFullAnimeInfo(searchTerm);
          return res.json({
            status: true,
            action: "full",
            result: fullInfo,
            responseTime: `${Date.now() - startTime}ms`
          });
        }
      }
    } catch (err) {
      logger.error(`[CRUNCHYROLL-ANIME] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses request Crunchyroll Anime"
      });
    }
  }
};

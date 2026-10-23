/**
 * LiveChart.me — Seasonal Anime, Detail, Streams, Rankings, Studios, Tags, Franchises
 * Sumber : https://www.livechart.me
 * Fitur  : season (list anime per musim), year (gabungan 4 musim), detail,
 *          streams (link layanan streaming), info (detail+streams),
 *          rankings, studios, tags, franchises
 */

import https from "https";
import http from "http";

const SEASONS = ["winter", "spring", "summer", "fall"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const BASE = "https://www.livechart.me";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fetch with redirect follow + timeout ──
function httpGet(url, extraHeaders = {}) {
  return new Promise((ok, no) => {
    const doReq = (u, depth = 0) => {
      if (depth > 5) return ok({ status: 0, data: "" });
      const mod = u.startsWith("https") ? https : http;
      const req = mod.get(
        u,
        { headers: { "User-Agent": UA, ...extraHeaders } },
        (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
            let loc = r.headers.location;
            if (loc.startsWith("/")) loc = BASE + loc;
            r.resume();
            return doReq(loc, depth + 1);
          }
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => ok({ status: r.statusCode, data: d }));
        }
      );
      req.setTimeout(20000, () => req.destroy(new Error("timeout")));
      req.on("error", no);
    };
    doReq(url);
  });
}

async function retryFetch(url, extraHeaders) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await httpGet(url, extraHeaders);
      if (r.status === 200) return r.data;
      if (r.status === 404) return null;
      if (r.status === 429) {
        await sleep(i * 3000);
        continue;
      }
      return null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

// ── HTML Helpers ──
function unescape(t) {
  return (t || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function strip(h) {
  return unescape((h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim());
}

function findAttr(html, attr) {
  const m = html.match(new RegExp(`${attr}="([^"]*)"`));
  return m ? unescape(m[1]) : null;
}

// ═══ SEASON PAGE ═══
function parseSeasonPage(html, slug) {
  const arts = html.match(/<article\s+class="anime"[\s\S]*?<\/article>/g) || [];
  return arts
    .map((a) => {
      const h = (a.match(/^<article[^>]*>/) || [""])[0];
      const id = findAttr(h, "data-anime-id");
      return {
        id,
        season: slug,
        title_romaji: findAttr(h, "data-romaji"),
        title_english: findAttr(h, "data-english"),
        title_native: findAttr(h, "data-native"),
        premiere_timestamp: findAttr(h, "data-premiere"),
        url: id ? `${BASE}/anime/${id}` : null,
      };
    })
    .filter((a) => a.id);
}

async function scrapeSeason(season, year) {
  const slug = `${season}-${year}`;
  const html = await retryFetch(`${BASE}/${slug}/all`);
  return html ? parseSeasonPage(html, slug) : [];
}

// ═══ ANIME DETAIL ═══
function parseDetailPage(html) {
  const data = {};

  const jsonld = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonld) {
    try {
      const j = JSON.parse(jsonld[1]);
      data.name = j.name || null;
      data.alternate_names = j.alternateName || [];
      data.genres = j.genre || [];
      data.description = j.description ? unescape(j.description) : null;
      data.episodes = j.numberOfEpisodes || null;
      data.date_published = j.datePublished || null;
      data.image = j.image || null;
      data.rating_value = j.aggregateRating?.ratingValue || null;
      data.rating_count = j.aggregateRating?.ratingCount || null;
      data.production_companies = (j.productionCompany || []).map((c) => c.name);
    } catch {}
  }

  const statusM = html.match(/data-anime-item-status="([^"]+)"|>(?:Finished|Airing|Upcoming|Not yet aired)</);
  data.status = statusM ? (statusM[1] || statusM[0].replace(/[><]/g, "").trim()) : null;

  const fmtM = html.match(/Format([\s\S]*?)<\/div>/);
  data.format = fmtM ? strip(fmtM[1]) : null;

  const srcM = html.match(/Source([\s\S]*?)<\/div>/);
  data.source = srcM ? strip(srcM[1]) : null;

  const rtM = html.match(/Run time([\s\S]*?)<\/div>/);
  data.runtime = rtM ? strip(rtM[1]) : null;

  if (!data.production_companies?.length) {
    data.production_companies = [...html.matchAll(/href="\/studios\/\d+"[^>]*>([^<]+)<\/a>/g)].map((m) => unescape(m[1]));
  }

  const tags = [...html.matchAll(/href="\/tags\/\d+"[^>]*>([^<]+)<\/a>/g)].map((m) => unescape(m[1]));
  data.tags = tags.filter(
    (t) => !["Sequel", "Prequel", "Side Story", "Summary", "Spin-off", "Alternative Version", "Parent Story", "Full Story", "Alternative Setting"].includes(t)
  );

  data.hashtags = [...html.matchAll(/href="https?:\/\/x\.com\/search\?q=%23([^&"]+)/g)].map((m) => decodeURIComponent(m[1]));

  data.mal_url = (html.match(/href="(https?:\/\/myanimelist\.net\/anime\/\d+[^"]*)"/) || [])[1] || null;
  data.anilist_url = (html.match(/href="(https?:\/\/anilist\.co\/anime\/\d+[^"]*)"/) || [])[1] || null;
  data.anidb_url = (html.match(/href="(https?:\/\/anidb\.net\/a\d+[^"]*)"/) || [])[1] || null;
  data.anime_planet_url = (html.match(/href="(https?:\/\/www\.anime-planet\.com\/anime\/[^"]*)"/) || [])[1] || null;
  data.kitsu_url = (html.match(/href="(https?:\/\/kitsu\.app\/anime\/\d+[^"]*)"/) || [])[1] || null;
  data.twitter_url = (html.match(/href="(https?:\/\/(?:x|twitter)\.com\/[^"]*)"[^>]*class="[^"]*twitter/) || [])[1] || null;
  data.official_url = (html.match(/href="(https?:\/\/[^"]*)"[^>]*class="[^"]*website/) || [])[1] || null;

  const related = [...html.matchAll(/href="\/anime\/(\d+)"[^>]*>([^<]+)<\/a>/g)]
    .filter((m) => m[2] !== "Info" && m[2] !== "View All")
    .map((m) => ({ id: m[1], title: unescape(m[2]) }));
  data.related_anime = related;

  return data;
}

async function scrapeDetail(animeId) {
  const html = await retryFetch(`${BASE}/anime/${animeId}`);
  return html ? parseDetailPage(html) : null;
}

// ═══ STREAMS PAGE ═══
function parseStreamsPage(html) {
  const streams = [];
  const pattern = /alt="([^"]+?)\s*logo"[\s\S]*?<a[^>]+class="link[^"]*"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const name = m[3].trim();
    const url = m[2];
    if (name && url && !streams.find((s) => s.service === name)) {
      streams.push({ service: name, url: unescape(url) });
    }
  }
  return streams;
}

async function scrapeStreams(animeId) {
  const html = await retryFetch(`${BASE}/anime/${animeId}/streams`, { "X-Requested-With": "XMLHttpRequest" });
  return html ? parseStreamsPage(html) : [];
}

// ═══ RANKINGS ═══
function parseRankings(html) {
  const rows = [...html.matchAll(/<tr[^>]*data-anime-item-id="(\d+)"[^>]*data-anime-item-romaji-title="([^"]*)"[^>]*data-anime-item-english-title="([^"]*)">([\s\S]*?)<\/tr>/g)];
  const anime = rows.map((r) => {
    const rank = (r[4].match(/<td[^>]*>(\d+)<\/td>/) || [])[1];
    return {
      rank: rank ? parseInt(rank) : null,
      id: r[1],
      title_romaji: unescape(r[2]),
      title_english: unescape(r[3]),
    };
  });

  const rows2 = [...html.matchAll(/<tr>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?href="\/franchises\/(\d+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/tr>/g)];
  const franchises = rows2.map((r) => ({
    rank: parseInt(r[1]),
    franchise_id: r[2],
    name: unescape(r[3]),
  }));

  return { anime, franchises };
}

async function scrapeRankings() {
  const html = await retryFetch(`${BASE}/rankings`);
  return html ? parseRankings(html) : { anime: [], franchises: [] };
}

// ═══ STUDIOS ═══
function parseStudios(html) {
  const studios = [];
  const arts = html.match(/<article[\s\S]*?<\/article>/g) || [];
  for (const a of arts) {
    const id = (a.match(/href="\/studios\/(\d+)"/) || [])[1];
    const name = (a.match(/href="\/studios\/\d+"[^>]*>([^<]+)<\/a>/) || [])[1];
    const founded = (a.match(/founded in (\d+)/) || [])[1];
    const logo = (a.match(/src="([^"]+)"/) || [])[1];
    if (id && name) {
      studios.push({
        id: parseInt(id),
        name: unescape(name),
        founded: founded ? parseInt(founded) : null,
        logo: logo || null,
        url: `${BASE}/studios/${id}`,
      });
    }
  }
  return studios;
}

async function scrapeStudios() {
  const html = await retryFetch(`${BASE}/studios`);
  return html ? parseStudios(html) : [];
}

// ═══ TAGS ═══
function parseTags(html) {
  const tags = [];
  const arts = html.match(/<article[\s\S]*?<\/article>/g) || [];
  for (const a of arts) {
    const m = a.match(/href="\/tags\/(\d+)"[^>]*>([^<]+)<\/a>/);
    if (m) {
      tags.push({
        id: parseInt(m[1]),
        name: unescape(m[2]),
        url: `${BASE}/tags/${m[1]}`,
      });
    }
  }
  return tags;
}

async function scrapeTags() {
  const html = await retryFetch(`${BASE}/tags`);
  return html ? parseTags(html) : [];
}

// ═══ FRANCHISES (per halaman, max 10) ═══
async function scrapeFranchises(page = 1) {
  const p = Math.min(Math.max(parseInt(page, 10) || 1, 1), 10);
  const html = await retryFetch(`${BASE}/franchises?page=${p}`);
  if (!html) return { page: p, franchises: [] };
  const frs = [...html.matchAll(/href="\/franchises\/(\d+)"[^>]*>([^<]+)<\/a>/g)];
  const items = frs
    .filter((m) => m[2] !== "Franchises")
    .map((m) => ({ id: parseInt(m[1]), name: unescape(m[2]), url: `${BASE}/franchises/${m[1]}` }));
  return { page: p, franchises: items };
}

// ═══ Dispatch ═══
const ACTIONS = ["season", "year", "detail", "streams", "info", "rankings", "studios", "tags", "franchises"];

function badRequest(message) {
  const err = new Error(message);
  err.code = 400;
  return err;
}

async function dispatch(action, params) {
  const year = parseInt(params.year, 10);
  const season = String(params.season || "").trim().toLowerCase();
  const id = String(params.id || params.anime_id || "").trim();

  switch (action) {
    case "season": {
      if (!SEASONS.includes(season)) throw badRequest("Parameter 'season' wajib: winter, spring, summer, fall");
      if (!year || year < 1970 || year > 2030) throw badRequest("Parameter 'year' wajib (1970-2030)");
      const items = await scrapeSeason(season, year);
      return { total: items.length, season: `${season}-${year}`, result: items };
    }
    case "year": {
      if (!year || year < 1970 || year > 2030) throw badRequest("Parameter 'year' wajib (1970-2030)");
      const seen = new Set();
      const all = [];
      for (let i = 0; i < SEASONS.length; i++) {
        const items = await scrapeSeason(SEASONS[i], year);
        for (const a of items) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            all.push(a);
          }
        }
        if (i < SEASONS.length - 1) await sleep(500);
      }
      return { total: all.length, year, result: all };
    }
    case "detail": {
      if (!id) throw badRequest("Parameter 'id' (anime id) wajib untuk action=detail");
      const data = await scrapeDetail(id);
      if (!data) throw badRequest("Anime tidak ditemukan (404)");
      return {
        result: {
          title_english: data.name,
          title_romaji: data.alternate_names?.[1] || data.name,
          title_native: data.alternate_names?.[0] || null,
          ...data,
          id,
        },
      };
    }
    case "streams": {
      if (!id) throw badRequest("Parameter 'id' (anime id) wajib untuk action=streams");
      const streams = await scrapeStreams(id);
      return { total: streams.length, anime_id: id, result: streams };
    }
    case "info": {
      if (!id) throw badRequest("Parameter 'id' (anime id) wajib untuk action=info");
      const [detail, streams] = await Promise.all([scrapeDetail(id), scrapeStreams(id)]);
      if (!detail) throw badRequest("Anime tidak ditemukan (404)");
      return {
        result: {
          title_english: detail.name,
          title_romaji: detail.alternate_names?.[1] || detail.name,
          title_native: detail.alternate_names?.[0] || null,
          ...detail,
          id,
          streams,
        },
      };
    }
    case "rankings": {
      const data = await scrapeRankings();
      return { total: data.anime.length, result: data };
    }
    case "studios": {
      const studios = await scrapeStudios();
      return { total: studios.length, result: studios };
    }
    case "tags": {
      const tags = await scrapeTags();
      return { total: tags.length, result: tags };
    }
    case "franchises": {
      const data = await scrapeFranchises(params.page || 1);
      return { total: data.franchises.length, result: data.franchises };
    }
    default:
      throw badRequest("Action tidak valid. Gunakan: " + ACTIONS.join(", "));
  }
}

export default {
  name: "LiveChart Anime",
  description: "Scraper anime — season & year list anime, detail, streams (Crunchyroll/Netflix/dll), info (detail+streams), rankings, studios, tags, franchises",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "season", "year", "id", "page"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ACTIONS,
      description: "Aksi: season, year, detail, streams, info, rankings, studios, tags, franchises",
    },
    season: {
      type: "string",
      required: false,
      enum: SEASONS,
      description: "Musim (action=season): winter, spring, summer, fall",
      example: "winter",
    },
    year: {
      type: "string",
      required: false,
      description: "Tahun 1970-2030 (action=season, year)",
      example: "2024",
    },
    id: {
      type: "string",
      required: false,
      description: "Anime ID LiveChart (action=detail, streams, info). Bisa dilihat dari hasil season/year",
      example: "11376",
    },
    page: {
      type: "string",
      required: false,
      default: "1",
      description: "Nomor halaman franchise 1-10 (action=franchises)",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const action = String(params.action || params.type || "").trim().toLowerCase();
    if (!action) {
      return res.status(400).json({ status: false, message: "Parameter 'action' wajib: " + ACTIONS.join(", ") });
    }
    try {
      const data = await dispatch(action, params);
      return res.json({ status: true, source: BASE, ...data });
    } catch (err) {
      const code = err.code && !isNaN(err.code) ? err.code : 500;
      return res.status(code).json({ status: false, message: err.message || "LiveChart request failed" });
    }
  },
};

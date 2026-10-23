import axios from "axios";
import * as cheerio from "cheerio";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const BASE_URL = "https://sinopsisfilm.id";
const jar = new CookieJar();
const clientSinopsis = wrapper(axios.create({
  jar, withCredentials: true, timeout: 20000, maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; V2238) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  }
}));

const client = clientSinopsis;

function parseDuration(duration = "") {
  if (!duration) return null;
  const m = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return { raw: duration };
  const h = parseInt(m[1] || 0, 10) || Math.floor(parseInt(m[2] || 0, 10) / 60);
  const min = h > 0 ? parseInt(m[2] || 0, 10) % 60 : parseInt(m[2] || 0, 10);
  const s = parseInt(m[3] || 0, 10);
  const totalMin = Math.floor((h * 3600 + min * 60 + s) / 60);
  return {
    raw: duration,
    minutes: totalMin,
    hours: h,
    text: h > 0 ? `${h}j ${min}m` : `${min}m`,
  };
}

function parseMetaLine(text = "") {
  // Format: "2021 • Hong Kong • ★ 7.2 • Action"
  const meta = text
    .split("•")
    .map((v) => v.trim())
    .filter(Boolean);
  const result = { year: null, country: null, rating: null, genres: [] };
  for (const part of meta) {
    if (/^\d{4}$/.test(part)) result.year = Number(part);
    else if (/^[★*☆]/.test(part)) result.rating = Number(part.replace(/[★*☆]/g, "").trim());
    else if (/^[\d.]+$/g.test(part.trim())) result.rating = Number(part.trim());
    else if (result.country === null) result.country = part;
    else result.genres.push(part);
  }
  return result;
}

async function listDetailFields($) {
  const detailMap = {};
  $('details:has(> summary:contains("Detail Film"))').each((_, root) => {
    $(root)
      .find('div[class*="grid-cols-["]')
      .each((_, row) => {
        const cells = $(row).children("div");
        const key = cells.eq(0).text().trim().replace(":", "");
        const valEl = cells.eq(1);
        let value;

        if (key === "Genre" || key === "Cast") {
          value = valEl.find("a").map((_, a) => $(a).text().trim()).get();
        } else {
          value = valEl.text().trim();
        }

        if (key) detailMap[key.toLowerCase()] = value;
      });
  });
  return detailMap;
}

async function home() {
  await client.get(BASE_URL);
  const { data: html } = await client.get(BASE_URL, { headers: { Referer: BASE_URL + "/" } });
  const $ = cheerio.load(html);
  const hero = [];
  $('#heroTrack').children().each((_, el) => {
    const a = $(el).find('a.hero-poster').first();
    const href = a.attr('href'); if (!href) return;
    const url = new URL(href, BASE_URL).href;
    const endpoint = url.replace(`${BASE_URL}/sinopsis/`, '').replace(/\/$/, '');
    const img = a.find('img').attr('src') || '';
    const title = a.find('img').attr('alt')?.trim() || $(el).find('.hero-title a').text().trim() || endpoint.replace(/-/g, ' ');
    const backdrop = $(el).find('.hero-bg').attr('style')?.match(/url\(['"]?(.*?)['"]?\)/)?.[1] || '';
    const ratingText = $(el).find('.hero-badge-rating').text().trim();
    const rating = ratingText ? parseFloat(ratingText.replace('/10','').trim()) : null;
    const yearText = $(el).find('.hero-badge').not('.hero-badge-rating').not('.hero-badge-genre').first().text().trim();
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    const genres = $(el).find('.hero-badge-genre').map((_, g) => $(g).text().trim()).get();
    hero.push({ title, url, endpoint, image: img, backdrop, rating, year, genres });
  });
  const popular = [];
  const popSection = $('h2:contains("Popular Sinopsis")').closest('section');
  popSection.find('a[href*="/sinopsis/"]').each((i, el) => {
    const href = $(el).attr('href'); if (!href) return;
    const url = new URL(href, BASE_URL).href;
    const endpoint = url.replace(`${BASE_URL}/sinopsis/`, '').replace(/\/$/, '');
    const img = $(el).find('img').attr('src') || '';
    const rank = $(el).find('span:contains("#")').first().text().trim().replace('#','') || String(i+1);
    const title = $(el).find('h3').text().trim() || $(el).find('img').attr('alt')?.trim() || endpoint;
    const meta = $(el).find('p').first().text().trim();
    const parsed = parseMetaLine(meta);
    popular.push({ rank: Number(rank) || i+1, title, url, endpoint, image: img, year: parsed.year, country: parsed.country, rating: parsed.rating });
  });
  const seen = new Set([...hero.map(h=>h.url), ...popular.map(p=>p.url)]);
  const latest = [];
  $('a[href*="/sinopsis/"]').each((_, el) => {
    const href = $(el).attr('href'); if (!href) return;
    const url = new URL(href, BASE_URL).href;
    if (seen.has(url) || !url.startsWith(`${BASE_URL}/sinopsis/`)) return;
    seen.add(url);
    const title = $(el).find('h3').text().trim() || $(el).find('img').attr('alt')?.trim() || '';
    if (!title) return;
    const img = $(el).find('img').attr('src') || '';
    const endpoint = url.replace(`${BASE_URL}/sinopsis/`, '').replace(/\/$/, '');
    latest.push({ title, url, endpoint, image: img });
    if (latest.length >= 12) return false;
  });
  const genres = $('a[href*="/genre/"]').map((_, el) => {
    const href = $(el).attr('href');
    return { name: $(el).text().trim(), slug: href?.split('/genre/')[1]?.replace(/\/$/,'') || '', url: new URL(href, BASE_URL).href };
  }).get().filter((v,i,a)=> a.findIndex(x=>x.slug===v.slug)===i);
  return { hero, popular, latest, genres, total: { hero: hero.length, popular: popular.length, latest: latest.length } };
}

async function search(query) {
  const { data: html } = await client.get(
    `${BASE_URL}/search?q=${encodeURIComponent(query)}`,
    { headers: { Referer: BASE_URL + "/" } }
  );
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const filmUrl = new URL(href, BASE_URL).href;
    if (!filmUrl.startsWith(`${BASE_URL}/sinopsis/`)) return;
    if (seen.has(filmUrl)) return;
    seen.add(filmUrl);

    const card = $(el);

    let title = card.find("h1,h2,h3,h4,h5").first().text().trim();
    if (!title) title = card.attr("title")?.trim() || "";
    if (!title) title = card.find("img").attr("alt")?.trim() || "";
    if (!title) title = card.text().trim();
    if (!title) title = filmUrl.split("/").pop().replace(/-/g, " ");

    const type = card.find("span").first().text().trim() || null;
    const metaLine = card.find("span").eq(1).text().trim() || "";
    const meta = parseMetaLine(metaLine);

    const description = card.find("p").text().trim() || "";
    const thumb = card.find("img").attr("src") || card.find("img").attr("data-src") || "";

    results.push({
      title,
      type,
      year: meta.year,
      country: meta.country,
      rating: meta.rating,
      genres: meta.genres,
      thumbnail: thumb,
      description,
      endpoint: filmUrl.replace(`${BASE_URL}/sinopsis/`, "").replace(/\/$/, ""),
      url: filmUrl,
    });
  });

  return results;
}

async function detail(url) {
  try {
  const { data: html } = await client.get(url, {
    headers: { Referer: `${BASE_URL}/search?q=` },
  });
  const $ = cheerio.load(html);

  let movie = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      if (Array.isArray(data)) {
        const found = data.find((v) => v?.["@type"] === "Movie");
        if (found) movie = found;
      } else if (data?.["@type"] === "Movie") {
        movie = data;
      }
    } catch {}
  });

  const title =
    movie?.name ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim();

  const detailMap = await listDetailFields($);

  let castCount = null;
  const shownCast = Array.isArray(detailMap.cast) ? detailMap.cast.length : 0;
  const castPlus = $('details:has(> summary:contains("Detail Film"))')
    .find('span:contains("+")')
    .map((_, s) => $(s).text().trim())
    .get()
    .find((t) => /^\+\d+$/.test(t));
  if (castPlus) castCount = shownCast + parseInt(castPlus.replace("+", ""), 10);
  else if (shownCast) castCount = shownCast;

  const scoreBlock = $("body").text().match(/Score Penonton\s*([\d.]+)\s*\/\s*10\s*\(\s*([\d.]+)\s*votes?\s*\)/i);
  const audienceScore = scoreBlock ? { rating: Number(scoreBlock[1]), votes: Number(scoreBlock[2]) } : null;

  const trailerEl = $("iframe").first().attr("src") || movie?.trailer?.embedUrl || "";
  const trailer = trailerEl
    ? {
        url: trailerEl.startsWith("http") ? trailerEl : `https:${trailerEl}`,
        thumbnail: movie?.trailer?.thumbnailUrl || movie?.image || "",
      }
    : null;

  let fullSinopsis = "";
  const articleProse = $(".article-prose");
  if (articleProse.length) {
    fullSinopsis = articleProse.find("p").map((_, p) => $(p).text().trim()).get().join("\n\n").trim();
  }

  const directors = Array.isArray(movie?.director)
    ? movie.director
    : movie?.director
      ? [movie.director]
      : [];
  const director = directors.map((v) => (typeof v === "string" ? v : v?.name)).filter(Boolean);

  const actorData = Array.isArray(movie?.actor)
    ? movie.actor
    : movie?.actor
      ? [movie.actor]
      : [];
  const ldActors = actorData.map((v) => (typeof v === "string" ? v : v?.name)).filter(Boolean);
  const actors =
    ldActors.length >= (Array.isArray(detailMap.cast) ? detailMap.cast.length : 0)
      ? ldActors
      : Array.isArray(detailMap.cast)
        ? detailMap.cast
        : ldActors;

  const aggregate = movie?.aggregateRating || {};
  const country = movie?.countryOfOrigin?.name || null;

  const yearMatch = url.match(/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const releaseDate = detailMap.rilis || movie?.datePublished || "";

  const genre = Array.isArray(movie?.genre)
    ? movie.genre
    : movie?.genre
      ? [movie.genre]
      : detailMap.genre || [];

  const description =
    movie?.description ||
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  return {
    title,
    original_title: detailMap.original || title,
    url,
    endpoint: url.replace(`${BASE_URL}/sinopsis/`, "").replace(/\/$/, ""),
    year,
    image: movie?.image || $('meta[property="og:image"]').attr("content") || "",
    datePublished: movie?.datePublished || "",
    releaseDate,
    duration: parseDuration(movie?.duration || ""),
    genre,
    country: country || detailMap.negara || null,
    director: director.length ? director : detailMap.director ? [detailMap.director] : [],
    actors,
    cast_count: castCount || actors.length || null,
    rating: aggregate.ratingValue ?? detailMap.rating?.replace("/10", "") ?? null,
    rating_best: aggregate.bestRating || 10,
    rating_count: aggregate.ratingCount ?? audienceScore?.votes ?? null,
    audience_score: audienceScore,
    trailer,
    synopsis: fullSinopsis || movie?.description || "",
    description,
  };
  } catch (e) {
    if (e.response?.status === 404) throw Object.assign(new Error('Film tidak ditemukan (404)'), { status: 404 });
    throw e;
  }
}

export default {
  name: "Sinopsis Film",
  description:
    "Scrape sinopsisfilm.id lengkap: home (hero, popular, latest, genres), search (kata kunci), detail (sinopsis penuh, rating, genre, sutradara, aktor, durasi, trailer).",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query"],

  paramsSchema: {
    action: {
      type: "string",
      required: false,
      enum: ["home", "search", "detail"],
      description: "Aksi yang dijalankan",
      default: "home",
    },
    query: {
      type: "string",
      required: false,
      description:
        "Kata kunci pencarian (action=search) atau endpoint/URL halaman sinopsis (action=detail). Kosongkan untuk home.",
      example: "dilan",
    },
  },

  async run(req, res) {
    const { action = "home", query = "" } = { ...req.query, ...req.body };

    try {
      if (action === "home") {
        const r = await home();
        return res.json({ status: true, result: r });
      }

      if (action === "search") {
        if (!query || !query.trim()) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk search", code: "MISSING_QUERY" });
        const results = await search(query.trim());
        return res.json({ status: true, result: { query: query.trim(), count: results.length, results } });
      }

      if (action === "detail") {
        if (!query || !query.trim()) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk detail (endpoint/URL)", code: "MISSING_QUERY" });
        const cleanQuery = query.trim();
        const targetUrl = cleanQuery.startsWith("http")
          ? cleanQuery
          : `${BASE_URL}/sinopsis/${cleanQuery.replace(/^\/|\/$/g, "")}`;
        const r = await detail(targetUrl);
        return res.json({ status: true, result: r });
      }

      return res.status(400).json({ status: false, message: `Action tidak dikenali: '${action}'`, code: "INVALID_ACTION" });
    } catch (err) {
      if (err.status === 404 || err.response?.status === 404) {
        return res.status(404).json({ status: false, message: err.message || 'Film tidak ditemukan (404)', code: 404 });
      }
      if (err.response?.status) {
        return res.status(err.response.status).json({ status: false, message: `HTTP ${err.response.status}`, code: "HTTP_ERROR" });
      }
      return res.status(500).json({ status: false, message: err.message, code: "SINOPSIS_ERROR" });
    }
  },
};
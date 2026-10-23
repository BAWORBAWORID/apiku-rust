/**
 * Winbu.org — Anime, Donghua, Series & Film Streaming Scraper
 * Sumber  : https://winbu.org
 * Fitur   : home, search, series (detail+episodes), film (player+download),
 *           stream (resolve player AJAX + download links), category, genre, genres
 */
import axios from "axios";
import * as cheerio from "cheerio";
import qs from "querystring";
import https from "https";

const createSecureHttpsAgent = () =>
  new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
  });

const BASE_URL = 'https://winbu.org';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/',
};

/**
 * Helper to ensure absolute URL
 */
function toAbsoluteUrl(url, base = BASE_URL) {
  if (!url) return null;
  const clean = url.trim();
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  if (clean.startsWith('//')) return 'https:' + clean;
  return `${base.replace(/\/+$/, '')}/${clean.replace(/^\/+/, '')}`;
}

/**
 * Clean text helper
 */
function cleanText(text) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * HTTP Client
 */
async function fetchHtml(url, customHeaders = {}) {
  const agent = createSecureHttpsAgent ? createSecureHttpsAgent() : undefined;
  const res = await axios.get(url, {
    httpsAgent: agent,
    headers: {
      ...DEFAULT_HEADERS,
      ...customHeaders,
    },
    timeout: 25000,
  });
  return res.data;
}

/**
 * Parse item card from DOM element
 */
function parseCard($, el) {
  const linkEl = $(el).find('a.mli-thumb-box, a.ml-mask, a').first();
  const rawUrl = linkEl.attr('href') || $(el).attr('href');
  const url = toAbsoluteUrl(rawUrl);

  if (!url) return null;
  const cleanPath = url.replace(BASE_URL, '').replace(/^\/+|\/+$/g, '');
  if (!cleanPath || ['film', 'anime', 'series', 'tvshow', 'others', 'animedonghua'].includes(cleanPath.toLowerCase())) {
    return null;
  }

  const title =
    cleanText($(el).find('.judul, .jt, h2, h3, .title, span.title').first().text()) ||
    linkEl.attr('title') ||
    $(el).find('img').attr('title') ||
    $(el).find('img').attr('alt') ||
    cleanText($(el).find('a').first().attr('title')) ||
    '';

  if (!title) return null;

  const poster =
    toAbsoluteUrl(
      $(el).find('img.mli-thumb, img').attr('src') ||
      $(el).find('img').attr('data-src') ||
      $(el).find('img').attr('data-lazy-src')
    );

  const rating = cleanText(
    $(el).find('.ratingValue, [itemprop="ratingValue"], .mli-rating, .rating').text()
  );

  const eps = cleanText(
    $(el).find('.mli-eps, .eps, .quality, .episode').text()
  );

  const metaText = cleanText($(el).find('.mli-mvi, .info, .meta').text());
  const synopsis = cleanText($(el).find('.mli-desc').text());

  let type = 'unknown';
  if (url.includes('/anime/')) type = 'anime';
  else if (url.includes('/series/')) type = 'series';
  else if (url.includes('/film/')) type = 'film';
  else if (url.includes('-episode-')) type = 'episode';

  const slug = cleanPath.split('/').pop();

  return {
    title,
    type,
    rating: rating || null,
    statusOrEpisode: eps || null,
    meta: metaText || null,
    synopsis: synopsis || null,
    poster,
    url,
    slug,
  };
}

/**
 * Helper to extract pagination data
 */
function extractPagination($, currentPage) {
  const p = parseInt(currentPage, 10) || 1;
  const pagination = {
    currentPage: p,
    totalPages: p,
    hasNextPage: false,
    pages: [p],
  };

  $('.pagination li a').each((i, el) => {
    const text = cleanText($(el).text());
    const pageNum = parseInt(text, 10);
    if (pageNum) {
      if (pageNum > pagination.totalPages) pagination.totalPages = pageNum;
      if (!pagination.pages.includes(pageNum)) pagination.pages.push(pageNum);
    }
  });
  if (pagination.totalPages > p || $('a.next, .pagination a:contains("»")').length > 0) {
    pagination.hasNextPage = true;
  }
  return pagination;
}

/**
 * Extract download links from container
 */
function extractDownloadLinks($) {
  const downloads = [];
  $('.download-eps li, .download li, .dlx li').each((i, el) => {
    const quality = cleanText($(el).find('strong').text()) || 'Unknown';
    const links = [];
    $(el).find('a').each((j, a) => {
      const server = cleanText($(a).text());
      const href = $(a).attr('href');
      if (server && href) {
        links.push({
          server,
          url: href,
        });
      }
    });

    if (links.length > 0) {
      downloads.push({
        quality,
        links,
      });
    }
  });

  // Fallback for flat links
  if (downloads.length === 0) {
    const flatLinks = [];
    $('.download-eps a, .download a, .dlx a').each((i, el) => {
      const server = cleanText($(el).text());
      const href = $(el).attr('href');
      if (server && href) {
        flatLinks.push({ server, url: href });
      }
    });
    if (flatLinks.length > 0) {
      downloads.push({
        quality: 'Default',
        links: flatLinks,
      });
    }
  }

  return downloads;
}

/**
 * 1. Get Home Page Catalog & Sections
 */
async function getHome() {
  const html = await fetchHtml(BASE_URL);
  const $ = cheerio.load(html);

  const sections = {
    topSeries: [],
    animeDonghuaTerbaru: [],
    topFilm: [],
    filmTerbaru: [],
    asianDrama: [],
    tvShow: [],
    genres: [],
  };

  $('.movies-list-wrap').each((i, wrap) => {
    const rawHeading = $(wrap).find('h2, .ml-title, span.pull-left').first().text();
    const heading = cleanText(rawHeading).toLowerCase();
    const items = [];

    $(wrap).find('.ml-item, .a-item, .item').each((j, itemEl) => {
      const parsed = parseCard($, itemEl);
      if (parsed && parsed.url && parsed.title && !items.some((x) => x.url === parsed.url)) {
        items.push(parsed);
      }
    });

    if (heading.includes('top 10 series')) {
      sections.topSeries = items;
    } else if (heading.includes('anime donghua')) {
      sections.animeDonghuaTerbaru = items;
    } else if (heading.includes('top 10 film')) {
      sections.topFilm = items;
    } else if (heading.includes('film terbaru')) {
      sections.filmTerbaru = items;
    } else if (heading.includes('jepang') || heading.includes('korea') || heading.includes('others')) {
      sections.asianDrama = items;
    } else if (heading.includes('tv show')) {
      sections.tvShow = items;
    }
  });

  // Extract Genres
  $('a[href*="/genre/"]').each((i, el) => {
    const rawText = cleanText($(el).text());
    const match = rawText.match(/^(.+?)(?:\s*\((\d+)\))?$/);
    const name = match ? match[1].trim() : rawText;
    const count = match && match[2] ? parseInt(match[2], 10) : null;
    const href = $(el).attr('href');
    const slug = href ? href.replace(BASE_URL, '').replace(/^\/genre\/|\/+$/g, '') : '';

    if (name && slug && !sections.genres.some((g) => g.slug === slug)) {
      sections.genres.push({
        name,
        slug,
        count,
        url: toAbsoluteUrl(href),
      });
    }
  });

  return {
    status: 'success',
    source: BASE_URL,
    totalSections: Object.keys(sections).length,
    data: sections,
  };
}

/**
 * 2. Search Anime, Series, and Movies
 */
async function search(query, page = 1) {
  if (!query || typeof query !== 'string') {
    throw new Error('Kata kunci pencarian wajib diisi.');
  }

  const p = parseInt(page, 10) || 1;
  const searchUrl = p > 1
    ? `${BASE_URL}/page/${p}/?s=${encodeURIComponent(query.trim())}`
    : `${BASE_URL}/?s=${encodeURIComponent(query.trim())}`;

  const html = await fetchHtml(searchUrl);
  const $ = cheerio.load(html);

  const results = [];
  $('.ml-item, .a-item, .item, article').each((i, el) => {
    const parsed = parseCard($, el);
    if (parsed && parsed.url && parsed.title && !results.some((x) => x.url === parsed.url)) {
      results.push(parsed);
    }
  });

  const pagination = extractPagination($, p);

  return {
    status: 'success',
    query: query.trim(),
    page: p,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.hasNextPage,
    totalFound: results.length,
    results,
  };
}

/**
 * 3. Get Series or Anime Detail
 */
async function getSeries(slugOrUrl) {
  if (!slugOrUrl) throw new Error('Slug atau URL Series/Anime wajib diisi.');

  let targetUrl = slugOrUrl;
  if (!targetUrl.startsWith('http')) {
    const clean = slugOrUrl.replace(/^\/+|\/+$/g, '');
    targetUrl = clean.includes('/') ? `${BASE_URL}/${clean}/` : `${BASE_URL}/anime/${clean}/`;
  }

  let html;
  try {
    html = await fetchHtml(targetUrl);
  } catch (err) {
    if (targetUrl.includes('/anime/') && !slugOrUrl.startsWith('http')) {
      const fallbackUrl = targetUrl.replace('/anime/', '/series/');
      html = await fetchHtml(fallbackUrl);
      targetUrl = fallbackUrl;
    } else {
      throw err;
    }
  }

  const $ = cheerio.load(html);

  const title =
    cleanText($('.mli-info .judul, h1.entry-title, .m-info h1').first().text()) ||
    cleanText($('title').text().replace(/Sub Indo.*$/i, '').replace(/^Nonton\s+/i, ''));

  const poster = toAbsoluteUrl(
    $('.mli-thumb-wrap img, .poster img, .thumb img, [itemprop="image"]').attr('src')
  );

  const ratingValue = cleanText($('[itemprop="ratingValue"], .ratingValue, .rating').text());
  const ratingCount = cleanText($('[itemprop="ratingCount"], .ratingCount').text());

  const season = cleanText($('a[href*="/season/"]').text());
  const seasonUrl = toAbsoluteUrl($('a[href*="/season/"]').attr('href'));

  const genres = [];
  $('a[rel="tag"][itemprop="genre"], a[href*="/genre/"]').each((i, el) => {
    const gName = cleanText($(el).text());
    const gUrl = toAbsoluteUrl($(el).attr('href'));
    if (gName && !gName.includes('(') && !genres.some((g) => g.name === gName)) {
      genres.push({ name: gName, url: gUrl });
    }
  });

  let synopsis = cleanText(
    $('.mli-desc, .sinopsis, .entry-content, [itemprop="description"]').first().text()
  );
  if (synopsis.startsWith('Sinopsis :')) {
    synopsis = synopsis.replace(/^Sinopsis\s*:\s*/i, '');
  }

  const metadata = {};
  $('.mli-mvi').each((i, el) => {
    const text = cleanText($(el).text());
    if (text.includes(':')) {
      const parts = text.split(':');
      const key = cleanText(parts[0]).toLowerCase();
      const val = cleanText(parts.slice(1).join(':'));
      if (key && val) metadata[key] = val;
    }
  });

  // Extract all episodes
  const episodes = [];
  let epSelector = $('.les-content a');
  if (epSelector.length === 0) {
    epSelector = $('.tvseason a[href*="-episode-"], .movies-list a[href*="-episode-"]');
  }

  epSelector.each((i, el) => {
    if ($(el).closest('.mli-thumb-wrap').length > 0) return;

    const rawUrl = $(el).attr('href');
    const epUrl = toAbsoluteUrl(rawUrl);
    if (!epUrl) return;

    let epTitle = cleanText($(el).text());
    const slug = epUrl.replace(BASE_URL, '').replace(/^\/+|\/+$/g, '');

    if (!epTitle) {
      const match = slug.match(/episode[-_]?(\d+)/i);
      epTitle = match ? `Episode ${match[1]}` : `Episode ${i + 1}`;
    }

    const epNumMatch = epTitle.match(/(\d+)/) || slug.match(/episode[-_]?(\d+)/i);
    const episodeNumber = epNumMatch ? parseInt(epNumMatch[1], 10) : null;

    if (!episodes.some((e) => e.url === epUrl)) {
      episodes.push({
        title: epTitle,
        episodeNumber,
        url: epUrl,
        slug,
      });
    }
  });

  return {
    status: 'success',
    title,
    rating: ratingValue ? { score: ratingValue, count: ratingCount || null } : null,
    season: season ? { name: season, url: seasonUrl } : null,
    metadata,
    genres,
    synopsis: synopsis || null,
    poster,
    url: targetUrl,
    totalEpisodes: episodes.length,
    episodes,
  };
}

/**
 * 4. Resolve Video Player via AJAX
 */
async function resolvePlayer(postId, numeId, type = 'schtml', refererUrl = BASE_URL) {
  if (!postId || !numeId) {
    throw new Error('postId dan numeId wajib diisi untuk resolve video player.');
  }

  const agent = createSecureHttpsAgent ? createSecureHttpsAgent() : undefined;
  const ajaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php`;

  const payload = qs.stringify({
    action: 'player_ajax',
    post: String(postId),
    nume: String(numeId),
    type: type || 'schtml',
  });

  const res = await axios.post(ajaxUrl, payload, {
    httpsAgent: agent,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': DEFAULT_HEADERS['User-Agent'],
      'Referer': refererUrl,
      'X-Requested-With': 'XMLHttpRequest',
    },
    timeout: 15000,
  });

  const rawHtml = String(res.data || '');
  const $ = cheerio.load(rawHtml);
  const iframeSrc = $('iframe').attr('src') || $('iframe').attr('data-src') || null;

  return {
    postId: String(postId),
    numeId: String(numeId),
    type,
    iframeSrc: iframeSrc ? toAbsoluteUrl(iframeSrc) : null,
    rawEmbed: rawHtml.trim(),
  };
}

/**
 * 5. Get Movie / Film Detail & Streaming
 */
async function getFilm(slugOrUrl) {
  if (!slugOrUrl) throw new Error('Slug atau URL Film wajib diisi.');

  let targetUrl = slugOrUrl;
  if (!targetUrl.startsWith('http')) {
    const clean = slugOrUrl.replace(/^\/+|\/+$/g, '');
    targetUrl = `${BASE_URL}/film/${clean}/`;
  }

  const html = await fetchHtml(targetUrl);
  const $ = cheerio.load(html);

  const title =
    cleanText($('.mli-info .judul, h1.entry-title, .m-info h1').first().text()) ||
    cleanText($('title').text().replace(/Sub Indo.*$/i, '').replace(/^Nonton\s+/i, ''));

  const poster = toAbsoluteUrl(
    $('.mli-thumb-wrap img, .poster img, .thumb img, [itemprop="image"]').attr('src')
  );

  const ratingValue = cleanText($('[itemprop="ratingValue"], .ratingValue, .rating').text());
  const ratingCount = cleanText($('[itemprop="ratingCount"], .ratingCount').text());

  const genres = [];
  $('a[rel="tag"][itemprop="genre"], a[href*="/genre/"]').each((i, el) => {
    const gName = cleanText($(el).text());
    const gUrl = toAbsoluteUrl($(el).attr('href'));
    if (gName && !gName.includes('(') && !genres.some((g) => g.name === gName)) {
      genres.push({ name: gName, url: gUrl });
    }
  });

  let synopsis = cleanText(
    $('.mli-desc, .sinopsis, .entry-content, [itemprop="description"]').first().text()
  );
  if (synopsis.startsWith('Sinopsis :')) {
    synopsis = synopsis.replace(/^Sinopsis\s*:\s*/i, '');
  }

  // Parse Player Options
  const playerOptions = [];
  $('[id^="player-option"], .east_player_option').each((i, el) => {
    const serverName = cleanText($(el).text());
    const postId = $(el).attr('data-post');
    const numeId = $(el).attr('data-nume');
    const type = $(el).attr('data-type') || 'schtml';
    const optId = $(el).attr('id');

    if (postId && numeId && !playerOptions.some((p) => p.numeId === numeId && p.postId === postId)) {
      playerOptions.push({
        id: optId || `player-option-${i + 1}`,
        name: serverName || `Server ${numeId}`,
        postId,
        numeId,
        type,
      });
    }
  });

  // Resolve players asynchronously
  const resolvedStreams = await Promise.allSettled(
    playerOptions.map(async (opt) => {
      const resolved = await resolvePlayer(opt.postId, opt.numeId, opt.type, targetUrl);
      return {
        ...opt,
        iframeSrc: resolved.iframeSrc,
        rawEmbed: resolved.rawEmbed,
      };
    })
  );

  const streams = resolvedStreams
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  // Parse Download Links
  const downloads = extractDownloadLinks($);

  return {
    status: 'success',
    title,
    rating: ratingValue ? { score: ratingValue, count: ratingCount || null } : null,
    genres,
    synopsis: synopsis || null,
    poster,
    url: targetUrl,
    streams,
    downloads,
  };
}

/**
 * 6. Get Episode Streaming & Player Links
 */
async function getStream(episodeSlugOrUrl) {
  if (!episodeSlugOrUrl) throw new Error('Slug atau URL Episode wajib diisi.');

  let targetUrl = episodeSlugOrUrl;
  if (!targetUrl.startsWith('http')) {
    const clean = episodeSlugOrUrl.replace(/^\/+|\/+$/g, '');
    targetUrl = `${BASE_URL}/${clean}/`;
  }

  const html = await fetchHtml(targetUrl);
  const $ = cheerio.load(html);

  const title = cleanText(
    $('title').text().replace(/Sub Indo.*$/i, '').replace(/^Nonton\s+/i, '')
  );

  const epNumMatch = title.match(/Episode\s*(\d+)/i);
  const episodeNumber = epNumMatch ? parseInt(epNumMatch[1], 10) : null;

  // Navigation: Prev, Next, All Episodes
  const navigation = {
    prev: toAbsoluteUrl($('.nvs:not(.rght):not(.nvsc) a').attr('href')),
    allEpisodes: toAbsoluteUrl($('.nvs.nvsc a').attr('href')),
    next: toAbsoluteUrl($('.nvs.rght a').attr('href')),
  };

  // Player Options
  const playerOptions = [];
  $('[id^="player-option"], .east_player_option').each((i, el) => {
    const serverName = cleanText($(el).text());
    const postId = $(el).attr('data-post');
    const numeId = $(el).attr('data-nume');
    const type = $(el).attr('data-type') || 'schtml';
    const optId = $(el).attr('id');

    if (postId && numeId && !playerOptions.some((p) => p.numeId === numeId && p.postId === postId)) {
      playerOptions.push({
        id: optId || `player-option-${i + 1}`,
        name: serverName || `Server ${numeId}`,
        postId,
        numeId,
        type,
      });
    }
  });

  // Resolve player embeds
  const resolvedStreams = await Promise.allSettled(
    playerOptions.map(async (opt) => {
      const resolved = await resolvePlayer(opt.postId, opt.numeId, opt.type, targetUrl);
      return {
        ...opt,
        iframeSrc: resolved.iframeSrc,
        rawEmbed: resolved.rawEmbed,
      };
    })
  );

  const streams = resolvedStreams
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  // Extract Download Links
  const downloads = extractDownloadLinks($);

  return {
    status: 'success',
    title,
    episodeNumber,
    url: targetUrl,
    navigation,
    streams,
    downloads,
  };
}

/**
 * 7. Browse Category Archive (e.g. animedonghua, series, film, tvshow, others)
 */
async function getCategory(categoryName = 'film', page = 1) {
  const p = parseInt(page, 10) || 1;
  const cleanCat = categoryName.replace(/^\/+|\/+$/g, '');
  const catUrl = p > 1
    ? `${BASE_URL}/${cleanCat}/page/${p}/`
    : `${BASE_URL}/${cleanCat}/`;

  const html = await fetchHtml(catUrl);
  const $ = cheerio.load(html);

  const items = [];
  $('.ml-item, .a-item, .item, article').each((i, el) => {
    const parsed = parseCard($, el);
    if (parsed && parsed.url && parsed.title && !items.some((x) => x.url === parsed.url)) {
      items.push(parsed);
    }
  });

  const pagination = extractPagination($, p);

  return {
    status: 'success',
    category: cleanCat,
    page: p,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.hasNextPage,
    totalFound: items.length,
    items,
  };
}

/**
 * 8. Browse by Genre
 */
async function getGenre(genreSlug, page = 1) {
  if (!genreSlug) throw new Error('Slug genre wajib diisi.');
  const p = parseInt(page, 10) || 1;
  const cleanSlug = genreSlug.replace(/^\/genre\/|\/+$/g, '');
  const genreUrl = p > 1
    ? `${BASE_URL}/genre/${cleanSlug}/page/${p}/`
    : `${BASE_URL}/genre/${cleanSlug}/`;

  const html = await fetchHtml(genreUrl);
  const $ = cheerio.load(html);

  const items = [];
  $('.ml-item, .a-item, .item, article').each((i, el) => {
    const parsed = parseCard($, el);
    if (parsed && parsed.url && parsed.title && !items.some((x) => x.url === parsed.url)) {
      items.push(parsed);
    }
  });

  const pagination = extractPagination($, p);

  return {
    status: 'success',
    genre: cleanSlug,
    page: p,
    totalPages: pagination.totalPages,
    hasNextPage: pagination.hasNextPage,
    totalFound: items.length,
    items,
  };
}

/**
 * 9. Get Full Genres Catalog
 */
async function getGenres() {
  const home = await getHome();
  return {
    status: 'success',
    totalGenres: home.data.genres.length,
    genres: home.data.genres,
  };
}



const ACTIONS = ["home", "search", "series", "film", "stream", "category", "genre", "genres"];

async function dispatch(action, params) {
  switch (action) {
    case "home":
      return { ...(await getHome()), action };
    case "search": {
      const q = params.query || params.q;
      if (!q) throw Object.assign(new Error("Parameter 'query' wajib diisi untuk action=search"), { code: 400 });
      return { ...(await search(q, params.page || 1)), action };
    }
    case "series":
    case "anime": {
      const target = params.url || params.slug || params.query;
      if (!target) throw Object.assign(new Error("Parameter 'url' atau 'slug' wajib diisi untuk action=" + action), { code: 400 });
      return { ...(await getSeries(target)), action };
    }
    case "film":
    case "movie": {
      const target = params.url || params.slug || params.query;
      if (!target) throw Object.assign(new Error("Parameter 'url' atau 'slug' wajib diisi untuk action=" + action), { code: 400 });
      return { ...(await getFilm(target)), action };
    }
    case "stream":
    case "episode": {
      const target = params.url || params.slug || params.query;
      if (!target) throw Object.assign(new Error("Parameter 'url' atau 'slug' wajib diisi untuk action=" + action), { code: 400 });
      return { ...(await getStream(target)), action };
    }
    case "category": {
      const cat = params.category || params.cat || "film";
      return { ...(await getCategory(cat, params.page || 1)), action };
    }
    case "genre": {
      const g = params.genre || params.slug;
      if (!g) throw Object.assign(new Error("Parameter 'genre' wajib diisi untuk action=genre"), { code: 400 });
      return { ...(await getGenre(g, params.page || 1)), action };
    }
    case "genres":
      return { ...(await getGenres()), action };
    default:
      throw Object.assign(new Error("Action tidak valid. Gunakan: " + ACTIONS.join(", ")), { code: 400 });
  }
}

export default {
  name: "Winbu",
  description: "Scraper streaming anime, donghua, series & film: home, search, detail series (+episodes), detail film (player+download), stream (resolve embed AJAX + direct download), category, genre, genres",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "slug", "page", "category", "genre"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ACTIONS,
      description: "Aksi: home, search, series, film, stream, category, genre, genres",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (action=search) atau slug/URL (action=series, film, stream)",
      example: "one piece",
    },
    url: {
      type: "string",
      required: false,
      description: "URL/slug lengkap series, film, atau episode (action=series, film, stream)",
      example: "https://winbu.org/anime/one-piece/",
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug singkat series/film/episode (action=series, film, stream)",
      example: "one-piece",
    },
    page: {
      type: "string",
      required: false,
      default: "1",
      description: "Nomor halaman (action=search, category, genre)",
    },
    category: {
      type: "string",
      required: false,
      default: "film",
      description: "Kategori: animedonghua, series, film, tvshow, others (action=category)",
    },
    genre: {
      type: "string",
      required: false,
      description: "Slug genre, contoh: action, comedy, romance (action=genre)",
      example: "action",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const action = String(params.action || params.type || "").trim().toLowerCase();
    if (!action) {
      return res.status(400).json({ status: false, message: "Parameter 'action' wajib: " + ACTIONS.join(", ") });
    }
    try {
      const result = await dispatch(action, params);
      return res.json({ status: true, ...result });
    } catch (err) {
      const code = err.code && !isNaN(err.code) ? err.code : 500;
      return res.status(code).json({ status: false, message: err.message || "Winbu request failed" });
    }
  },
};

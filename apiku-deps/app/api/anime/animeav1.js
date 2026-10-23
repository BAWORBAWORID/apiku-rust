/**
 * AnimeAV1 — Anime Streaming & Episode Download Scraper
 * Sumber  : https://animeav1.com
 * Fitur   : home, search, catalog, schedule, detail, episode (stream & download)
 */

const BASE_URL = 'https://animeav1.com';
const CDN_URL = 'https://cdn.animeav1.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

async function fetchPage(path) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: Gagal memuat ${url}`);
  }
  return await res.text();
}

function extractSvelteData(html) {
  const regex = /data:\s*\[[\s\S]*?form:\s*null/;
  const match = html.match(regex);
  if (!match) {
    throw new Error('Data payload tidak ditemukan di halaman sumber');
  }
  const raw = match[0].replace(/^data:\s*/, '').replace(/,\s*form:\s*null$/, '');
  const evaluated = (new Function(`return (${raw})`))();
  for (let i = evaluated.length - 1; i >= 0; i--) {
    if (evaluated[i] && evaluated[i].data && Object.keys(evaluated[i].data).length > 0) {
      return evaluated[i].data;
    }
  }
  return null;
}

function normalizeMedia(item) {
  if (!item) return null;
  const slug = item.slug || (item.media && item.media.slug) || '';
  const id = item.id || (item.media && item.media.id);
  const trailerUrl = item.trailer ? `https://www.youtube.com/watch?v=${item.trailer}` : null;
  const coverUrl = id ? `${CDN_URL}/covers/${id}.jpg` : null;
  const backdropUrl = id ? `${CDN_URL}/backdrops/${id}.jpg` : null;

  return {
    slug: slug,
    url: slug ? `${BASE_URL}/media/${slug}` : null,
    coverUrl,
    backdropUrl,
    trailerUrl,
    ...item
  };
}

function normalizeEpisodeItem(ep, animeSlug, animeId) {
  if (!ep) return null;
  const targetSlug = animeSlug || (ep.media && ep.media.slug) || '';
  const num = ep.number;
  const mediaId = animeId || ep.mediaId || (ep.media && ep.media.id);
  const thumbnailUrl = mediaId ? `${CDN_URL}/thumbnails/${mediaId}.jpg` : null;

  return {
    slug: targetSlug ? `${targetSlug}/${num}` : null,
    animeSlug: targetSlug,
    episodeNumber: num,
    thumbnailUrl,
    url: targetSlug ? `${BASE_URL}/media/${targetSlug}/${num}` : null,
    ...ep
  };
}

function cleanSlugAndEpisode(inputSlug, inputEp) {
  let slug = (inputSlug || '').trim();
  let ep = (inputEp || '').trim();

  slug = slug.replace(/^https?:\/\/[^\/]+/i, '');
  slug = slug.replace(/^\/media\//i, '');
  slug = slug.replace(/^\/+|\/+$/g, '');

  const parts = slug.split('/');
  if (parts.length >= 2) {
    slug = parts[0];
    if (!ep) {
      ep = parts[1];
    }
  }

  return { slug, ep };
}

const scraperActions = {
  home: async () => {
    const html = await fetchPage('/');
    const data = extractSvelteData(html);
    return {
      featured: (data?.featured || []).map(normalizeMedia),
      latestEpisodes: (data?.latestEpisodes || []).map(ep => normalizeEpisodeItem(ep)),
      latestMedia: (data?.latestMedia || []).map(normalizeMedia),
      latestComments: data?.latestComments || [],
      latestTopComments: data?.latestTopComments || []
    };
  },

  search: async (query) => {
    if (!query) throw new Error('Query pencarian tidak boleh kosong');
    const html = await fetchPage(`/catalogo?search=${encodeURIComponent(query)}`);
    const data = extractSvelteData(html);
    const results = (data?.results || []).map(normalizeMedia);
    return {
      query,
      total: data?.total || results.length,
      pagination: data?.pagination || null,
      results
    };
  },

  catalog: async (page = 1, order = 'latest') => {
    const html = await fetchPage(`/catalogo?page=${page}&order=${order}`);
    const data = extractSvelteData(html);
    const results = (data?.results || []).map(normalizeMedia);
    return {
      filters: data?.filters || null,
      pagination: data?.pagination || null,
      results,
      categoriesIdsMap: data?.categoriesIdsMap || null,
      genresIdsMap: data?.genresIdsMap || null
    };
  },

  schedule: async () => {
    const html = await fetchPage('/horario');
    const data = extractSvelteData(html);
    const schedule = (data?.media || []).map(item => {
      const norm = normalizeMedia(item);
      if (item.latestEpisode) {
        norm.latestEpisode = normalizeEpisodeItem(item.latestEpisode, norm.slug);
      }
      return norm;
    });
    return { schedule };
  },

  detail: async (rawSlug) => {
    const { slug } = cleanSlugAndEpisode(rawSlug);
    if (!slug) throw new Error('Slug anime tidak boleh kosong');
    const html = await fetchPage(`/media/${slug}`);
    const data = extractSvelteData(html);
    const media = data?.media ? normalizeMedia(data.media) : null;
    if (media && Array.isArray(media.episodes)) {
      media.episodes = media.episodes.map(ep => normalizeEpisodeItem(ep, slug, media.id));
    }
    return { media };
  },

  episode: async (rawSlug, rawEp) => {
    const { slug, ep } = cleanSlugAndEpisode(rawSlug, rawEp);
    if (!slug || !ep) throw new Error('Slug dan nomor episode harus diisi');
    const html = await fetchPage(`/media/${slug}/${ep}`);
    const data = extractSvelteData(html);
    const media = data?.media ? normalizeMedia(data.media) : null;
    const episode = data?.episode ? normalizeEpisodeItem(data.episode, slug, media?.id) : null;
    return {
      slug: `${slug}/${ep}`,
      animeSlug: slug,
      episodeNumber: parseInt(ep, 10),
      url: `${BASE_URL}/media/${slug}/${ep}`,
      media,
      episode,
      embeds: data?.embeds || {},
      downloads: data?.downloads || {}
    };
  }
};

const ACTIONS = ["home", "search", "catalog", "schedule", "detail", "episode"];

export default {
  name: "AnimeAV1",
  description: "Streaming anime & download episode: home, search, catalog, schedule, detail series, dan stream episode",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "slug", "episode", "page", "order"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ACTIONS,
      description: "Aksi yang diinginkan: home, search, catalog, schedule, detail, episode",
      example: "search"
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian anime (wajib untuk action=search)",
      example: "naruto"
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug atau URL anime (wajib untuk action=detail dan episode)",
      example: "naruto-shippuuden"
    },
    episode: {
      type: "string",
      required: false,
      description: "Nomor episode (wajib untuk action=episode)",
      example: "1"
    },
    page: {
      type: "string",
      required: false,
      default: "1",
      description: "Nomor halaman katalog (action=catalog)"
    },
    order: {
      type: "string",
      required: false,
      default: "latest",
      description: "Urutan katalog (latest, score, title)"
    }
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const action = String(params.action || params.type || "home").trim().toLowerCase();

    try {
      let result;
      switch (action) {
        case "home":
          result = await scraperActions.home();
          break;
        case "search": {
          const q = params.query || params.q || params.search;
          if (!q) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action=search" });
          }
          result = await scraperActions.search(q);
          break;
        }
        case "catalog": {
          const page = params.page || 1;
          const order = params.order || "latest";
          result = await scraperActions.catalog(page, order);
          break;
        }
        case "schedule":
          result = await scraperActions.schedule();
          break;
        case "detail": {
          const slug = params.slug || params.query || params.url;
          if (!slug) {
            return res.status(400).json({ status: false, message: "Parameter 'slug' atau 'url' wajib diisi untuk action=detail" });
          }
          result = await scraperActions.detail(slug);
          break;
        }
        case "episode": {
          const slug = params.slug || params.query || params.url;
          const ep = params.episode || params.ep;
          if (!slug) {
            return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi untuk action=episode" });
          }
          result = await scraperActions.episode(slug, ep);
          break;
        }
        default:
          return res.status(400).json({
            status: false,
            message: `Action tidak valid. Gunakan salah satu dari: ${ACTIONS.join(", ")}`
          });
      }

      return res.json({
        status: true,
        creator: "Always Codex",
        action,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        creator: "Always Codex",
        action,
        message: err.message || "Gagal mengambil data dari AnimeAV1"
      });
    }
  }
};

import axios from 'axios';
import logger from '../../src/utils/logger.js';

const BASE_URL = 'https://7reels.cc';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Referer: `${BASE_URL}/`,
};

/**
 * Perform a GET request to 7REELS API
 * @param {string} path
 * @param {object} params
 */
async function apiGet(path, params = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    params,
    timeout: 15000,
  });
  return response.data;
}

/**
 * 1. Fetch Homepage Featured and Top Reels Charts
 */
async function getHomepage() {
  const [featured, topReels] = await Promise.all([
    apiGet('/api/featured'),
    apiGet('/api/top-reels'),
  ]);

  return {
    featured: featured.featured || {},
    topReels: {
      trending: topReels.trending || [],
      topOverall: topReels.topOverall || [],
      country: topReels.country || '',
    },
  };
}

/**
 * 2. Search Movies and TV Shows
 * @param {string} query
 * @param {number} page
 */
async function search(query, page = 1) {
  const data = await apiGet('/api/search/smart', {
    q: query,
    page: String(page),
  });

  return {
    query,
    page: parseInt(page, 10) || 1,
    total: data.results?.length || 0,
    results: (data.results || []).map((item) => ({
      id: item.id,
      title: item.title || item.name || '',
      originalTitle: item.original_title || item.original_name || '',
      mediaType: item.media_type || (item.title ? 'movie' : 'tv'),
      overview: item.overview || '',
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null,
      backdrop: item.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
        : null,
      rating: item.vote_average || null,
      releaseDate: item.release_date || item.first_air_date || '',
      popularity: item.popularity || 0,
    })),
  };
}

/**
 * 3. Fetch Specific Movie/TV details
 * @param {string|number} id
 * @param {string} type
 */
async function getDetails(id, type = 'movie') {
  const cleanType = type === 'tv' ? 'tv' : 'movie';

  const [details, credits] = await Promise.all([
    apiGet(`/api/tmdb/${cleanType}/${id}`),
    apiGet(`/api/tmdb/${cleanType}/${id}/credits`).catch(() => ({})),
  ]);

  return {
    id: String(id),
    type: cleanType,
    title: details.title || details.name || '',
    originalTitle: details.original_title || details.original_name || '',
    overview: details.overview || '',
    poster: details.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : null,
    backdrop: details.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
      : null,
    rating: details.vote_average || null,
    releaseDate: details.release_date || details.first_air_date || '',
    genres: details.genres || [],
    runtime: details.runtime || (details.episode_run_time ? details.episode_run_time[0] : null),
    status: details.status || '',
    tagline: details.tagline || null,
    numberOfSeasons: details.number_of_seasons || null,
    numberOfEpisodes: details.number_of_episodes || null,
    seasons: (details.seasons || []).map((s) => ({
      id: s.id,
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      poster: s.poster_path
        ? `https://image.tmdb.org/t/p/w300${s.poster_path}`
        : null,
      airDate: s.air_date || '',
    })),
    cast: (credits.cast || []).slice(0, 15).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character || '',
      profile: c.profile_path
        ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
        : null,
    })),
  };
}

/**
 * 4. Fetch TV Show Season Episodes
 * @param {string|number} tvId
 * @param {number} seasonNum
 */
async function getEpisodes(tvId, seasonNum = 1) {
  const data = await apiGet(`/api/tmdb/tv/${tvId}/season/${seasonNum}`);
  return {
    tvId: String(tvId),
    seasonNumber: parseInt(seasonNum, 10) || 1,
    episodes: (data.episodes || []).map((ep) => ({
      id: ep.id,
      episodeNumber: ep.episode_number,
      name: ep.name || '',
      overview: ep.overview || '',
      airDate: ep.air_date || '',
      rating: ep.vote_average || null,
      stillPath: ep.still_path
        ? `https://image.tmdb.org/t/p/w300${ep.still_path}`
        : null,
    })),
  };
}

export default {
  name: '7REELS Movie & TV Search',
  description:
    'Cari film dan serial TV dari 7reels.cc, dapatkan trending charts, featured movies, detail sinopsis, dan daftar episode.',
  category: 'Search',
  methods: ['GET', 'POST'],

  params: ['query', 'action', 'id', 'type', 'season', 'page'],

  paramsSchema: {
    query: {
      type: 'string',
      required: false,
      description: 'Kata kunci pencarian film / series (contoh: Interstellar)',
      example: 'Interstellar',
    },
    action: {
      type: 'string',
      required: false,
      enum: ['search', 'home', 'featured', 'trending', 'detail', 'episodes'],
      default: 'search',
      description:
        'Aksi yang ingin dijalankan: search (default jika query ada), home/featured, detail, episodes',
      example: 'search',
    },
    id: {
      type: 'string',
      required: false,
      description: 'TMDB ID film atau serial TV (wajib jika action=detail atau episodes)',
      example: '157336',
    },
    type: {
      type: 'string',
      required: false,
      enum: ['movie', 'tv'],
      default: 'movie',
      description: 'Tipe media: movie atau tv',
      example: 'movie',
    },
    season: {
      type: 'number',
      required: false,
      default: 1,
      description: 'Nomor season untuk serial TV (jika action=episodes)',
      example: 1,
    },
    page: {
      type: 'number',
      required: false,
      default: 1,
      description: 'Nomor halaman pencarian',
      example: 1,
    },
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      const {
        query,
        q,
        action,
        id,
        type = 'movie',
        season = 1,
        page = 1,
      } = { ...req.query, ...req.body };

      const keyword = (query || q || '').trim();
      const selectedAction = (action || '').toLowerCase().trim();

      let result = null;
      let finalAction = selectedAction;

      if (selectedAction === 'home' || selectedAction === 'featured' || selectedAction === 'trending') {
        finalAction = 'home';
        result = await getHomepage();
      } else if (selectedAction === 'detail' || (id && !keyword && selectedAction !== 'episodes')) {
        if (!id) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' (TMDB ID) wajib diisi untuk melihat detail film/series",
          });
        }
        finalAction = 'detail';
        result = await getDetails(id, type);
      } else if (selectedAction === 'episodes') {
        if (!id) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' (TMDB ID) wajib diisi untuk melihat daftar episode",
          });
        }
        finalAction = 'episodes';
        result = await getEpisodes(id, season);
      } else if (keyword || selectedAction === 'search') {
        if (!keyword) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' atau 'q' wajib diisi untuk pencarian",
          });
        }
        finalAction = 'search';
        result = await search(keyword, page);
      } else {
        // Default: jika tidak ada parameter sama sekali, sajikan homepage/featured
        finalAction = 'home';
        result = await getHomepage();
      }

      const duration = Date.now() - startTime;
      logger.info(`[7REELS Search] Action: ${finalAction} | Time: ${duration}ms`);

      return res.json({
        status: true,
        action: finalAction,
        result,
        metadata: {
          processing_time: `${duration}ms`,
        },
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[7REELS Search] Error: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal memproses permintaan 7REELS',
        metadata: {
          processing_time: `${duration}ms`,
        },
      });
    }
  },
};

import axios from "axios";

const TMDB_API_KEY = "82524e2faef91706a2d52d52496130ac";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const SERVERS = {
  vidsrc: {
    movie: "https://vidsrc.me/embed/movie?tmdb={id}",
    tv: "https://vidsrc.me/embed/tv?tmdb={id}&season={s}&episode={e}",
  },
  embedsu: {
    movie: "https://embed.su/embed/movie/{id}",
    tv: "https://embed.su/embed/tv/{id}/{s}/{e}",
  },
  vidsrcpro: {
    movie: "https://vidsrc.pro/embed/movie/{id}",
    tv: "https://vidsrc.pro/embed/tv/{id}/{s}/{e}",
  },
};

/**
 * LK21 Scraper v2 - Nonton Film & TV Series Gratis Sub Indo
 * Menggunakan TMDB API untuk data + embed streaming
 */
class LK21 {
  constructor() {}

  async _tmdb(endpoint, params = {}) {
    try {
      const { data } = await axios.get(`${TMDB_BASE}${endpoint}`, {
        params: { api_key: TMDB_API_KEY, language: "id-ID", ...params },
      });
      return data;
    } catch (e) {
      console.error(`TMDB error: ${e.message}`);
      return null;
    }
  }

  async search(query) {
    const data = await this._tmdb("/search/multi", { query, page: 1 });
    if (!data?.results) return [];
    return data.results
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .map((r) => {
        const title = r.title || r.name;
        const year = (r.release_date || r.first_air_date || "").split("-")[0];
        return {
          id: r.id,
          title,
          year,
          type: r.media_type,
          rating: r.vote_average?.toFixed(1) || "N/A",
          poster: r.poster_path ? `${TMDB_IMG}${r.poster_path}` : null,
          overview: r.overview || "",
        };
      });
  }

  async detail(id, type = "movie") {
    const data = await this._tmdb(`/${type}/${id}`);
    if (!data) return null;
    const title = data.title || data.name;
    const releaseDate = data.release_date || data.first_air_date;
    const year = releaseDate ? releaseDate.split("-")[0] : "N/A";
    const runtime = type === "movie" ? data.runtime : data.episode_run_time?.[0];
    const genres = data.genres?.map((g) => g.name) || [];
    const credits = await this._tmdb(`/${type}/${id}/credits`);
    const cast = credits?.cast?.slice(0, 10).map((a) => ({
      name: a.name,
      character: a.character,
      photo: a.profile_path ? `${TMDB_IMG}${a.profile_path}` : null,
    })) || [];

    const servers = {};
    for (const [name, tmpl] of Object.entries(SERVERS)) {
      if (type === "movie") {
        servers[name] = tmpl.movie.replace("{id}", id);
      } else {
        servers[name] = tmpl.tv.replace("{id}", id).replace("{s}", 1).replace("{e}", 1);
      }
    }

    return {
      id, title, type, year,
      rating: data.vote_average?.toFixed(1) || "N/A",
      runtime: runtime ? `${runtime} min` : "N/A",
      genres, overview: data.overview || "Sinopsis tidak tersedia.",
      poster: data.poster_path ? `${TMDB_IMG}${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `${TMDB_IMG}${data.backdrop_path}` : null,
      seasons: type === "tv" ? data.number_of_seasons : undefined,
      episodes: type === "tv" ? data.number_of_episodes : undefined,
      cast, servers, streamUrl: servers.vidsrc,
    };
  }

  async streamingUrl(id, type = "movie", server = "vidsrc", season = 1, episode = 1) {
    const tmpl = SERVERS[server];
    if (!tmpl) return null;
    if (type === "movie") return tmpl.movie.replace("{id}", id);
    return tmpl.tv.replace("{id}", id).replace("{s}", season).replace("{e}", episode);
  }

  async trending() {
    const data = await this._tmdb("/trending/all/week");
    if (!data?.results) return [];
    return data.results
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        title: r.title || r.name,
        type: r.media_type,
        rating: r.vote_average?.toFixed(1) || "N/A",
        poster: r.poster_path ? `${TMDB_IMG}${r.poster_path}` : null,
      }));
  }

  async recommendations(id, type = "movie") {
    const data = await this._tmdb(`/${type}/${id}/recommendations`);
    if (!data?.results) return [];
    return data.results
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        title: r.title || r.name,
        type: r.media_type,
        rating: r.vote_average?.toFixed(1) || "N/A",
        poster: r.poster_path ? `${TMDB_IMG}${r.poster_path}` : null,
      }));
  }
}

const scraper = new LK21();

export default {
  name: "LK21 Stream v2",
  description: "Nonton film & TV series — search, detail, stream, trending",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["action", "q", "id", "type", "server", "season", "episode"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "trending",
      description: "Action: search, detail, stream, trending",
      enum: ["search", "detail", "stream", "trending"],
    },
    q: {
      type: "string",
      required: false,
      default: "",
      description: "Kata kunci pencarian (untuk action search)",
    },
    id: {
      type: "number",
      required: false,
      description: "TMDB ID film/TV (untuk action detail & stream)",
    },
    type: {
      type: "string",
      required: false,
      default: "movie",
      description: "Tipe konten untuk detail/stream",
      enum: ["movie", "tv"],
    },
    server: {
      type: "string",
      required: false,
      default: "vidsrc",
      description: "Server streaming untuk action stream",
      enum: ["vidsrc", "embedsu", "vidsrcpro"],
    },
    season: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor season (untuk type=tv)",
    },
    episode: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor episode (untuk type=tv)",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    if (!params.action) {
      return res.status(400).json({ status: false, message: 'Parameter "action" wajib diisi (search|detail|stream|trending)' });
    }
    try {
      let result;
      switch (params.action) {
        case "search":
          if (!params.q) return res.status(400).json({ status: false, message: 'Parameter "q" wajib diisi' });
          result = await scraper.search(params.q);
          break;
        case "detail": {
          if (!params.id) return res.status(400).json({ status: false, message: 'Parameter "id" wajib diisi' });
          result = await scraper.detail(parseInt(params.id), params.type || "movie");
          if (!result) return res.status(404).json({ status: false, message: "Gagal mengambil data dari TMDB" });
          break;
        }
        case "stream": {
          if (!params.id) return res.status(400).json({ status: false, message: 'Parameter "id" wajib diisi' });
          result = await scraper.streamingUrl(parseInt(params.id), params.type || "movie", params.server || "vidsrc", parseInt(params.season) || 1, parseInt(params.episode) || 1);
          if (!result) return res.status(400).json({ status: false, message: "Server tidak dikenal" });
          break;
        }
        case "trending":
          result = await scraper.trending();
          break;
        default:
          return res.status(400).json({ status: false, message: "Invalid action" });
      }
      return res.json({ status: true, result });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },
};

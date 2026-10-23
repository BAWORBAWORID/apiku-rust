/**
 * Bilibili TV Search API
 * GET/POST /api/search/bilibili?query=spy+x+family
 */

import axios from "axios";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function generateBuvid3() {
  const hex = (len) => [...Array(len)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}infoc`;
}

function cleanID(input) {
  if (!input) return "";
  input = String(input).trim();
  if (input.includes("/")) {
    const matches = [...input.matchAll(/\/(\d+)/g)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      if (lastMatch && lastMatch[1]) {
        return lastMatch[1];
      }
    }
  }
  const match = input.match(/\d+/);
  return match ? match[0] : input;
}

class BiliClient {
  constructor(lang = "id", customCookie = "") {
    this.lang = lang;
    this.customCookie = customCookie;
    this.buvid3 = "";
  }

  async init() {
    try {
      const headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      };
      if (this.customCookie) headers["Cookie"] = this.customCookie;

      const res = await axios.get(`https://www.bilibili.tv/${this.lang}`, {
        headers,
        timeout: 15000,
        validateStatus: () => true,
      });

      const setCookies = res.headers["set-cookie"] || [];
      for (const cookie of setCookies) {
        const match = cookie.match(/buvid3=([^;]+)/);
        if (match) {
          this.buvid3 = match[1];
          break;
        }
      }
    } catch {
      // fallback if init fails
    }

    if (!this.buvid3) {
      this.buvid3 = generateBuvid3();
    }
    return this;
  }

  async getJSON(apiURL) {
    let cookieHeader = `buvid3=${this.buvid3}; bstar-web-lang=${this.lang}`;
    if (this.customCookie) {
      cookieHeader = `${cookieHeader}; ${this.customCookie}`;
    }

    const res = await axios.get(apiURL, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.bilibili.tv/",
        "Origin": "https://www.bilibili.tv",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookieHeader,
      },
      timeout: 20000,
      validateStatus: () => true,
    });

    if (res.status !== 200) {
      throw new Error(`Bilibili HTTP error: ${res.status}`);
    }

    const body = res.data;
    if (typeof body !== "object" || body === null) {
      throw new Error(`Invalid response dari Bilibili`);
    }

    if (body.code !== 0) {
      throw new Error(`Bilibili error ${body.code}: ${body.message || "Unknown error"}`);
    }

    return body.data;
  }

  async searchAnime(keyword, page = 1, limit = 20) {
    const pn = Math.max(1, page);
    const ps = Math.max(1, limit);
    const apiURL = `https://api.bilibili.tv/intl/gateway/web/v2/search_v2/anime?keyword=${encodeURIComponent(keyword)}&pn=${pn}&ps=${ps}&platform=web`;

    const data = await this.getJSON(apiURL);
    const items = data?.items || [];
    const results = [];

    for (const it of items) {
      if (ps > 0 && results.length >= ps) break;
      results.push({
        type: "anime",
        id: it.season_id,
        title: it.title,
        cover: it.cover,
        views: it.view,
        index_show: it.index_show,
        url: `https://www.bilibili.tv/${this.lang}/play/${it.season_id}`,
      });
    }

    return results;
  }

  async searchAll(keyword, page = 1, limit = 20) {
    const pn = Math.max(1, page);
    const ps = Math.max(1, limit);
    const apiURL = `https://api.bilibili.tv/intl/gateway/web/v2/search_v2?keyword=${encodeURIComponent(keyword)}&highlight=1&pn=${pn}&ps=${ps}&qid=&sort=0&duration_type=0&platform=web`;

    const data = await this.getJSON(apiURL);
    const modules = data?.modules || [];
    const results = [];

    for (const mod of modules) {
      const items = mod?.items || [];
      for (const it of items) {
        if (ps > 0 && results.length >= ps) break;
        if (it.seasons && it.seasons.length > 0) {
          for (const s of it.seasons) {
            results.push({
              type: "anime",
              id: s.season_id,
              title: s.title,
              cover: s.cover,
              views: s.view,
              index_show: s.index_show,
              url: `https://www.bilibili.tv/${this.lang}/play/${s.season_id}`,
            });
          }
        } else if (it.aid) {
          results.push({
            type: "ugc",
            id: it.aid,
            title: it.title,
            cover: it.cover,
            views: it.view,
            duration: it.duration,
            author: it.author?.nickname || "",
            author_id: it.author?.mid || "",
            url: `https://www.bilibili.tv/${this.lang}/video/${it.aid}`,
          });
        }
      }
    }

    return results;
  }

  async getAnimeDetails(seasonID) {
    const cleanSeasonID = cleanID(seasonID);
    const infoURL = `https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/season_info?season_id=${cleanSeasonID}&platform=web`;
    const episodesURL = `https://api.bilibili.tv/intl/gateway/web/v2/ogv/play/episodes?season_id=${cleanSeasonID}&platform=web`;

    const [infoData, epData] = await Promise.all([
      this.getJSON(infoURL).catch(() => ({})),
      this.getJSON(episodesURL).catch(() => ({})),
    ]);

    const season = infoData?.season || {};
    const styles = (season.styles || []).map((s) => s.title);
    const episodes = [];

    if (epData && epData.sections) {
      for (const sec of epData.sections) {
        for (const ep of sec.episodes || []) {
          episodes.push({
            episode_id: ep.episode_id,
            title_display: ep.title_display,
            short_title: ep.short_title_display,
            cover: ep.cover,
            publish_time: ep.publish_time,
            is_free: ep.limit === 0,
            limit_text: ep.limit_text || "",
            play_url: `https://www.bilibili.tv/${this.lang}/play/${cleanSeasonID}/${ep.episode_id}`,
          });
        }
      }
    }

    return {
      season_id: season.season_id || cleanSeasonID,
      title: season.title || "",
      origin_name: season.origin_name || "",
      alias_name: season.alias_name || "",
      cover: season.cover || "",
      views: season.view || "",
      description: season.description || "",
      release_date: season.player_date || "",
      styles,
      episodes,
      total_episodes: episodes.length,
    };
  }

  async getPlayURL(target) {
    const clean = cleanID(target);
    const isAid = clean.length > 12 || String(target).toLowerCase().startsWith("ugc") || String(target).includes("/video/");

    const playAPI = isAid
      ? `https://api.bilibili.tv/intl/gateway/web/playurl?platform=web&aid=${clean}`
      : `https://api.bilibili.tv/intl/gateway/web/playurl?platform=web&ep_id=${clean}`;

    const subAPI = isAid
      ? `https://api.bilibili.tv/intl/gateway/web/v2/subtitle?platform=web&s_locale=en_US&aid=${clean}`
      : `https://api.bilibili.tv/intl/gateway/web/v2/subtitle?platform=web&s_locale=en_US&episode_id=${clean}`;

    const [playData, subData] = await Promise.all([
      this.getJSON(playAPI),
      this.getJSON(subAPI).catch(() => ({})),
    ]);

    const playURL = playData?.playurl || {};

    const videoStreams = [];
    for (const v of playURL.video || []) {
      const res = v.video_resource;
      if (!res || !res.url) continue;
      videoStreams.push({
        quality: res.quality,
        desc_words: v.stream_info?.desc_words || "",
        width: res.width,
        height: res.height,
        bandwidth: res.bandwidth,
        codecs: res.codecs,
        size: res.size,
        url: res.url,
      });
    }

    const audioStreams = [];
    for (const a of playURL.audio_resource || []) {
      if (!a.url) continue;
      audioStreams.push({
        quality: a.quality,
        bandwidth: a.bandwidth,
        codecs: a.codecs,
        size: a.size,
        url: a.url,
      });
    }

    const subtitles = [];
    for (const s of subData?.subtitles || []) {
      if (s.url) {
        subtitles.push({
          lang_key: s.lang_key,
          lang: s.lang,
          url: s.url,
        });
      }
    }

    return {
      id: clean,
      type: isAid ? "ugc_video" : "ogv_episode",
      duration_ms: playURL.duration,
      videos: videoStreams,
      audios: audioStreams,
      subtitles,
      required_headers: {
        Referer: "https://www.bilibili.tv/",
        "User-Agent": USER_AGENT,
      },
    };
  }

  async getTrending(limit = 20) {
    const apiURL = "https://api.bilibili.tv/intl/gateway/web/v2/home/ogv/trending?platform=web";
    const data = await this.getJSON(apiURL);
    const cards = data?.cards || [];
    const results = [];

    for (const c of cards) {
      if (limit > 0 && results.length >= limit) break;
      results.push({
        type: "anime",
        id: c.season_id,
        title: c.title,
        cover: c.cover,
        views: c.view,
        index_show: c.index_show,
        url: `https://www.bilibili.tv/${this.lang}/play/${c.season_id}`,
      });
    }
    return results;
  }

  async getTimeline() {
    const apiURL = "https://api.bilibili.tv/intl/gateway/web/v2/ogv/timeline?platform=web";
    const data = await this.getJSON(apiURL);
    const items = data?.items || [];
    const schedule = [];

    for (const day of items) {
      const animeList = [];
      for (const card of day.cards || []) {
        animeList.push({
          season_id: card.season_id,
          title: card.title,
          cover: card.cover,
          views: card.view,
          index_show: `${card.index_show} (${card.pub_time_text})`,
          styles: card.style_list || [],
          url: `https://www.bilibili.tv/${this.lang}/play/${card.season_id}`,
        });
      }

      schedule.push({
        day_of_week: day.full_day_of_week || day.day_of_week,
        date_text: day.date_text,
        is_today: !!day.is_today,
        anime: animeList,
      });
    }
    return schedule;
  }
}

export default {
  name: "Bilibili Search",
  description: "Cari anime dan video UGC di Bilibili TV (mendukung detail & streaming link)",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "type", "action", "url", "page", "limit", "lang"],

  paramsSchema: {
    query: {
      type: "string",
      required: false,
      default: "SPY x FAMILY",
      description: "Kata kunci pencarian anime atau video",
    },
    type: {
      type: "string",
      required: false,
      default: "all",
      enum: ["all", "anime"],
      description: "Tipe pencarian: 'all' (anime + video UGC) atau 'anime'",
    },
    action: {
      type: "string",
      required: false,
      default: "search",
      enum: ["search", "detail", "play", "trending", "schedule"],
      description: "Aksi khusus: search, detail, play, trending, atau schedule",
    },
    url: {
      type: "string",
      required: false,
      default: "",
      description: "URL atau ID video/episode/season (untuk action detail / play)",
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman pencarian",
    },
    limit: {
      type: "number",
      required: false,
      default: 20,
      description: "Batas jumlah data",
    },
    lang: {
      type: "string",
      required: false,
      default: "id",
      description: "Kode bahasa (id, en, th, vi)",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = (params.action || "search").toLowerCase();
      const lang = params.lang || "id";
      const page = parseInt(params.page, 10) || 1;
      const limit = parseInt(params.limit, 10) || 20;

      const client = new BiliClient(lang);
      await client.init();

      if (action === "trending") {
        const result = await client.getTrending(limit);
        return res.json({
          status: true,
          mode: "trending",
          total: result.length,
          result,
        });
      }

      if (action === "schedule") {
        const result = await client.getTimeline();
        return res.json({
          status: true,
          mode: "schedule",
          total: result.length,
          result,
        });
      }

      if (action === "detail") {
        const target = params.url || params.id || params.season_id || params.query;
        if (!target) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' atau 'id' (season_id) wajib diisi untuk action detail",
          });
        }
        const result = await client.getAnimeDetails(target);
        return res.json({
          status: true,
          mode: "detail",
          result,
        });
      }

      if (action === "play") {
        const target = params.url || params.id || params.episode_id || params.aid || params.query;
        if (!target) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' atau 'id' (episode_id / aid) wajib diisi untuk action play",
          });
        }
        const result = await client.getPlayURL(target);
        return res.json({
          status: true,
          mode: "play",
          result,
        });
      }

      // Default: Action Search
      const query = (params.query || params.q || "").trim();
      if (!query) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi untuk pencarian",
        });
      }

      const type = (params.type || "all").toLowerCase();
      let videos = [];

      if (type === "anime") {
        videos = await client.searchAnime(query, page, limit);
        // Fallback jika pencarian anime OGV kosong
        if (videos.length === 0) {
          videos = await client.searchAll(query, page, limit);
        }
      } else {
        videos = await client.searchAll(query, page, limit);
      }

      return res.json({
        status: true,
        mode: "search",
        query,
        type,
        page,
        total: videos.length,
        result: videos,
      });
    } catch (err) {
      console.error("[BILIBILI SEARCH ERROR]:", err.message);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses request Bilibili",
      });
    }
  },
};

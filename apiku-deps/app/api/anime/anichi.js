import axios from "axios";
import * as cheerio from "cheerio";

class AnichiScraper {
  constructor() {
    this.baseURL = "https://anichi.to";
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://anichi.to/",
    };
  }

  async search(query) {
    const url = `${this.baseURL}/filter?keyword=${encodeURIComponent(query)}`;
    try {
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results = [];
      $(".ani.items .item").each((_, element) => {
        const linkEl = $(element).find("a").first();
        const titleEl = $(element).find(".name");
        const title = titleEl.text().trim();
        const href = linkEl.attr("href") || "";
        const slug = href.replace(/.*\/anime\//, "") || "";
        const thumbnail = $(element).find("img").attr("src") || "";
        const type = $(element).find(".right").first().text().trim();
        const episode = $(element).find(".ep-status span").first().text().trim();
        const id = $(element).find("[data-id]").attr("data-id") || "";
        if (title) {
          results.push({
            id,
            title,
            slug,
            thumbnail,
            type,
            episode,
            url: `${this.baseURL}/anime/${slug}`,
          });
        }
      });
      return results;
    } catch (error) {
      throw new Error("Search failed: " + error.message);
    }
  }

  async detail(url) {
    try {
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const id = $("#series-page, #watch-main").attr("data-id") || "";
      const malId = $("#series-page, #watch-main").attr("data-mal-id") || "";
      const title = $(".series-title, .media-title").first().text().trim();
      const thumbnail = $(".series-intro__poster img, .media-info-poster img").first().attr("src") || "";
      const synopsis = $(".series-blurb__full, .synopsis-full").first().text().trim() ||
                       $(".series-blurb__short, .synopsis-short").first().text().trim();
      const rating = $(".series-score b, .score-line b").first().text().trim();
      const info = {};
      $(".series-fact, .meta-row").each((_, el) => {
        const label = $(el).find(".series-fact__label, .meta-label").text().trim().replace(":", "");
        const value = $(el).find(".series-fact__value, .meta-value").text().trim();
        if (label && value) {
          info[label] = value;
        }
      });
      const genres = [];
      $(".series-genres__list a, .meta-row:contains('Genre') a").each((_, el) => {
        genres.push($(el).text().trim());
      });
      const altTitle = $(".series-title, .media-title").first().attr("data-en") ||
                       $(".series-title, .media-title").first().attr("data-jp") || "";
      return {
        id,
        malId,
        title,
        altTitle,
        thumbnail,
        synopsis,
        rating,
        genres,
        info,
        url,
      };
    } catch (error) {
      throw new Error("Detail failed: " + error.message);
    }
  }

  async latest() {
    const url = `${this.baseURL}/latest-updated`;
    try {
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results = [];
      $(".ani.items .item, .aitem-wrapper .aitem").each((_, element) => {
        const linkEl = $(element).find("a").first();
        const title = $(element).find(".name, .title").first().text().trim();
        const href = linkEl.attr("href") || "";
        const slug = href.replace(/.*\/anime\//, "") || "";
        const thumbnail = $(element).find("img").attr("src") || "";
        const episode = $(element).find(".ep-status span").first().text().trim() || "";
        const type = $(element).find(".right").first().text().trim();
        const id = $(element).find("[data-id], [data-tip]").attr("data-id") || $(element).find("[data-id], [data-tip]").attr("data-tip") || "";
        if (title) {
          results.push({
            id,
            title,
            slug,
            thumbnail,
            episode,
            type,
            url: `${this.baseURL}/anime/${slug}`,
          });
        }
      });
      return results;
    } catch (error) {
      throw new Error("Latest failed: " + error.message);
    }
  }

  async popular() {
    const url = `${this.baseURL}/most-viewed`;
    try {
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results = [];
      $(".ani.items .item, .aitem-wrapper .aitem").each((_, element) => {
        const linkEl = $(element).find("a").first();
        const title = $(element).find(".name, .title").first().text().trim();
        const href = linkEl.attr("href") || "";
        const slug = href.replace(/.*\/anime\//, "") || "";
        const thumbnail = $(element).find("img").attr("src") || "";
        const episode = $(element).find(".ep-status span").first().text().trim() || "";
        const type = $(element).find(".right").first().text().trim();
        const id = $(element).find("[data-id], [data-tip]").attr("data-id") || $(element).find("[data-id], [data-tip]").attr("data-tip") || "";
        if (title) {
          results.push({
            id,
            title,
            slug,
            thumbnail,
            episode,
            type,
            url: `${this.baseURL}/anime/${slug}`,
          });
        }
      });
      return results;
    } catch (error) {
      throw new Error("Popular failed: " + error.message);
    }
  }

  async genre(genre) {
    const url = `${this.baseURL}/genre/${genre}`;
    try {
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results = [];
      $(".ani.items .item, .aitem-wrapper .aitem").each((_, element) => {
        const linkEl = $(element).find("a").first();
        const title = $(element).find(".name, .title").first().text().trim();
        const href = linkEl.attr("href") || "";
        const slug = href.replace(/.*\/anime\//, "") || "";
        const thumbnail = $(element).find("img").attr("src") || "";
        const episode = $(element).find(".ep-status span").first().text().trim() || "";
        const type = $(element).find(".right").first().text().trim();
        const id = $(element).find("[data-id], [data-tip]").attr("data-id") || $(element).find("[data-id], [data-tip]").attr("data-tip") || "";
        if (title) {
          results.push({
            id,
            title,
            slug,
            thumbnail,
            episode,
            type,
            url: `${this.baseURL}/anime/${slug}`,
          });
        }
      });
      return results;
    } catch (error) {
      throw new Error("Genre failed: " + error.message);
    }
  }

  async watch(url) {
    try {
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const id = $("#watch-main").attr("data-id") || "";
      const malId = $("#watch-main").attr("data-mal-id") || "";
      const title = $(".media-title a").first().text().trim();
      const thumbnail = $(".media-info-poster img").first().attr("src") || "";
      const synopsis = $(".synopsis-full, .synopsis-short").first().text().trim();
      const rating = $(".score-line b").first().text().trim();
      const episodeNum = $("#watch-main").attr("data-ep-num") || "";
      return {
        id,
        malId,
        title,
        thumbnail,
        synopsis,
        rating,
        episodeNum,
        url,
      };
    } catch (error) {
      throw new Error("Watch failed: " + error.message);
    }
  }
}

const scraper = new AnichiScraper();

export default {
  name: "Anichi",
  description: "Scraper anime — search, latest, popular, genre, detail, watch (episode info)",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "genre"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "latest",
      description: "Action: search, detail, latest, popular, genre, watch",
      enum: ["search", "detail", "latest", "popular", "genre", "watch"],
    },
    query: {
      type: "string",
      required: false,
      default: "",
      description: "Kata kunci pencarian (untuk action search)",
    },
    url: {
      type: "string",
      required: false,
      default: "",
      description: "URL anime/episode (untuk action detail & watch)",
    },
    genre: {
      type: "string",
      required: false,
      default: "",
      description: "Nama genre (untuk action genre, contoh: action, romance)",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const type = params.action || params.type;
    try {
      let result;
      switch (type) {
        case "search":
          if (!params.query) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action search" });
          }
          result = await scraper.search(params.query);
          break;
        case "detail":
          if (!params.url) {
            return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi untuk action detail" });
          }
          result = await scraper.detail(params.url);
          break;
        case "latest":
          result = await scraper.latest();
          break;
        case "popular":
          result = await scraper.popular();
          break;
        case "genre":
          if (!params.genre) {
            return res.status(400).json({ status: false, message: "Parameter 'genre' wajib diisi untuk action genre" });
          }
          result = await scraper.genre(params.genre);
          break;
        case "watch":
          if (!params.url) {
            return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi untuk action watch" });
          }
          result = await scraper.watch(params.url);
          break;
        default:
          return res.status(400).json({
            status: false,
            message: "Invalid action. Use: search, detail, latest, popular, genre, watch",
          });
      }
      return res.json({ status: true, result });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },
};

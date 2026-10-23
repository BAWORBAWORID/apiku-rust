import axios from "axios";
import * as cheerio from "cheerio";

class AnichinScraper {
  constructor() {
    this.baseUrl = "https://anichin.help/";
    this.client = axios.create({
      timeout: 30000,
    });
  }

  getHeaders(customHeaders = {}) {
    return {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,id;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...customHeaders,
    };
  }

  _findSectionByHeading($, keyword) {
    return $("section h2")
      .filter(function () {
        return $(this).text().trim().includes(keyword);
      })
      .closest("section");
  }

  async latest() {
    try {
      const { data } = await this.client.get(this.baseUrl, {
        headers: this.getHeaders(),
      });
      const $ = cheerio.load(data);
      const results = [];
      const section = this._findSectionByHeading($, "Episode Terbaru");
      section.find("a.card-netflix").each((_, element) => {
        const $el = $(element);
        const title = $el.find("h3").text().trim();
        const url = $el.attr("href");
        const episode = $el.find(".badge-sub").text().trim();
        const thumbnail = $el.find("img").attr("src");
        const rating = $el
          .find(".badge-rating")
          .text()
          .replace("★", "")
          .trim();
        const isNew = $el.find(".badge-new").length > 0;
        if (url) {
          results.push({
            title,
            url,
            episode,
            thumbnail,
            rating,
            isNew,
          });
        }
      });
      return results;
    } catch (error) {
      throw new Error(`Gagal mengambil data episode terbaru: ${error.message}`);
    }
  }

  async episode(targetUrl) {
    if (!targetUrl) throw new Error("Parameter URL episode wajib diisi.");
    try {
      const { data } = await this.client.get(targetUrl, {
        headers: this.getHeaders(),
      });
      const $ = cheerio.load(data);
      const episodes = [];
      const epSection = $("section h2")
        .filter(function () {
          const t = $(this).text().trim();
          return t.includes("Daftar Episode") || t.includes("Pilih Episode");
        })
        .closest("section")
        .first();
      epSection.find("a").each((_, element) => {
        const $el = $(element);
        const link = $el.attr("href");
        const raw = $el.text().replace(/\s+/g, " ").trim();
        const m = raw.match(/^(Episode\s*[\d.]+(?:\s*[-–]\s*[\d.]+)?)(?:\s+(.*))?$/i);
        const episodeNumber = m ? m[1].trim() : raw;
        const date = m && m[2] ? m[2].trim() : "";
        if (link && link.includes("episode") && episodeNumber) {
          episodes.push({
            episodeNumber,
            date,
            link,
          });
        }
      });
      return episodes;
    } catch (error) {
      throw new Error(`Gagal mengambil daftar episode: ${error.message}`);
    }
  }

  async download(targetUrl) {
    if (!targetUrl) throw new Error("Parameter URL download wajib diisi.");
    try {
      const { data } = await this.client.get(targetUrl, {
        headers: this.getHeaders(),
      });
      const $ = cheerio.load(data);
      const sources = [];
      $("button[class*='btn']").each((_, el) => {
        const $el = $(el);
        const label = $el.text().trim();
        const click = $el.attr("@click") || "";
        const idx = click.match(/show\((\d+)\)/);
        if (idx) {
          const ref = "emb" + idx[1];
          const tpl = $(`template[x-ref="${ref}"]`);
          const content = tpl.html() || "";
          const $inner = cheerio.load(content);
          const iframeSrc = $inner("iframe").attr("src") || "";
          if (iframeSrc) {
            let src = iframeSrc.trim();
            if (src.startsWith("//")) src = "https:" + src;
            sources.push({ label, source: src });
          }
        }
      });
      return sources;
    } catch (error) {
      throw new Error(`Gagal mengambil link unduhan: ${error.message}`);
    }
  }

  async detail(targetUrl) {
    if (!targetUrl) throw new Error("Parameter URL detail wajib diisi.");
    try {
      const { data } = await this.client.get(targetUrl, {
        headers: this.getHeaders(),
      });
      const $ = cheerio.load(data);
      const article = $("article.card-netflix").first();
      const title = article.find("h1").text().trim();
      const thumbnail = article.find("img").attr("src");
      const rating = article
        .find(".badge-rating")
        .text()
        .replace("★", "")
        .trim();
      const type = article.find(".badge-sub").first().text().trim();
      const status = article.find("span.badge").text().trim();
      const year = article.find("a.badge-glass").text().trim();
      const altText = article.find("h1").next("p").text().trim();
      const alternativeTitles = altText
        ? altText.split("·").pop()?.trim() || ""
        : "";
      const dlInfo = {};
      article.find("dl > div").each((_, el) => {
        const $el = $(el);
        const label = $el.find("dt").text().trim();
        const value = $el.find("dd").text().trim();
        if (label && value) dlInfo[label] = value;
      });
      const genres = [];
      article.find('a[href*="/genre/"]').each((_, el) => {
        genres.push($(el).text().trim());
      });
      const synopsis = $('h2:contains("Sinopsis")')
        .parent()
        .find(".prose")
        .text()
        .trim();
      return {
        title,
        thumbnail,
        rating,
        type,
        status,
        year,
        alternativeTitles,
        episodes: dlInfo["Episode"] || "",
        duration: dlInfo["Durasi"] || "",
        studio: dlInfo["Studio"] || "",
        genres,
        synopsis,
      };
    } catch (error) {
      throw new Error(`Gagal mengambil detail donghua: ${error.message}`);
    }
  }

  async search(queryStr) {
    if (!queryStr)
      throw new Error("Kata kunci pencarian ('query' atau 's') wajib diisi.");
    const searchUrl = `${this.baseUrl}?s=${encodeURIComponent(queryStr)}`;
    try {
      const { data } = await this.client.get(searchUrl, {
        headers: this.getHeaders(),
      });
      const $ = cheerio.load(data);
      const results = [];
      $("a.card-netflix").each((_, el) => {
        const $el = $(el);
        const title = $el.find("h3").text().trim();
        const link = $el.attr("href");
        const image = $el.find("img").attr("src");
        const rating = $el
          .find(".badge-rating")
          .text()
          .replace("★", "")
          .trim();
        const status = $el.find(".badge").text().trim();
        const type = $el.find(".text-brand-300").first().text().trim();
        if (link) {
          results.push({
            title,
            type,
            status,
            rating,
            link,
            image,
          });
        }
      });
      return results;
    } catch (error) {
      throw new Error(`Gagal melakukan pencarian: ${error.message}`);
    }
  }

  async popular() {
    try {
      const { data } = await this.client.get(this.baseUrl, {
        headers: this.getHeaders(),
      });
      const $ = cheerio.load(data);
      const popularToday = [];
      const section = this._findSectionByHeading($, "Ongoing");
      section.find("a.card-netflix").each((_, element) => {
        const $el = $(element);
        const title = $el.find("h3").text().trim();
        const link = $el.attr("href");
        const image = $el.find("img").attr("src");
        const rating = $el
          .find(".badge-rating")
          .text()
          .replace("★", "")
          .trim();
        const status = $el.find(".badge").text().trim();
        const type = $el.find(".text-brand-300").first().text().trim();
        if (link) {
          popularToday.push({
            title,
            type,
            status,
            rating,
            link,
            image,
          });
        }
      });
      return popularToday;
    } catch (error) {
      throw new Error(`Gagal mengambil data populer: ${error.message}`);
    }
  }
}

const scraper = new AnichinScraper();

export default {
  name: "Anichin Help",
  description: "Scraper donghua — latest, popular, search, detail, episode, download (stream embed)",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "latest",
      description: "Action: latest, popular, search, detail, episode, download",
      enum: ["latest", "popular", "search", "detail", "episode", "download"],
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
      description: "URL target (untuk action detail, episode, download)",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const { action, type, url, link, query, s } = params;
    const selectedAction = action || type;
    const targetUrl = url || link;
    const searchQuery = query || s;
    const availableActions = {
      anichin_actions: ["latest", "popular", "search", "detail", "episode", "download"],
    };

    if (!selectedAction) {
      return res.status(400).json({
        status: false,
        error: "Parameter 'action' atau 'type' wajib diisi.",
        available_actions: availableActions,
      });
    }

    try {
      let response;
      switch (selectedAction) {
        case "latest":
          response = await scraper.latest();
          break;
        case "popular":
          response = await scraper.popular();
          break;
        case "search":
          response = await scraper.search(searchQuery);
          break;
        case "detail":
          response = await scraper.detail(targetUrl);
          break;
        case "episode":
          response = await scraper.episode(targetUrl);
          break;
        case "download":
          response = await scraper.download(targetUrl);
          break;
        default:
          return res.status(400).json({
            status: false,
            error: `Action/Type '${selectedAction}' tidak valid.`,
            available_actions: availableActions,
          });
      }
      return res.json({ status: true, result: response });
    } catch (error) {
      return res.status(500).json({
        status: false,
        error: error.message || "Terjadi kesalahan internal pada server.",
      });
    }
  },
};

/**
 * Frama Stream Downloader & Stream API
 * Shortcut/Alias for LK21 & Drama scraper
 * Creator: ShanMolvyr
 */

import { lk21Scraper } from './lk21.js';

export default {
  name: "Frama Series Stream Downloader",
  description: "Scrape and stream drama/movie series from Layarkaca21 and Nontondrama",
  category: "Downloader",
  methods: ["GET"],
  params: ["action", "q", "page", "slug", "genre", "category"],
  paramsSchema: {
    action: {
      type: "string",
      default: "latest",
      required: false
    },
    q: {
      type: "string",
      required: false
    },
    page: {
      type: "number",
      default: 1,
      required: false
    },
    slug: {
      type: "string",
      required: false
    },
    genre: {
      type: "string",
      required: false
    },
    category: {
      type: "string",
      default: "series",
      required: false
    }
  },

  async run(req, res) {
    try {
      const { action = 'latest', q, page = 1, slug, genre, category = 'series' } = req.query;
      const pageNum = parseInt(page, 10) || 1;

      let result;
      switch (action.toLowerCase()) {
        case 'home':
          result = await lk21Scraper.home(category);
          break;
        case 'search':
          if (!q) return res.status(400).json({ status: false, message: "Parameter 'q' wajib untuk search" });
          result = await lk21Scraper.search(q, category, pageNum);
          break;
        case 'genre':
          if (!genre) return res.status(400).json({ status: false, message: "Parameter 'genre' wajib" });
          result = await lk21Scraper.genre(genre, category, pageNum);
          break;
        case 'detail':
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib untuk detail" });
          result = await lk21Scraper.detail(slug, category);
          break;
        case 'watch':
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib untuk watch" });
          result = await lk21Scraper.watchSeries(slug);
          break;
        case 'latest':
        default:
          result = await lk21Scraper.latest(category, pageNum);
          break;
      }

      res.json({
        status: true,
        creator: "ShanMolvyr",
        action,
        category,
        result
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Failed to process Frama request"
      });
    }
  }
};

import { load } from 'cheerio';

const BASE_URL = 'https://4kwallpapers.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

const fetchHtml = async (path = '') => {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const parseWallpapers = async (html, page = 1) => {
  const $ = load(html);
  const wallpapers = $('.wallpapers__item').map((_, el) => {
    const $item = $(el);
    const href = $item.find('a.wallpapers__canvas_image').attr('href');
    if (!href || href.includes('collections-packs') || href.endsWith('-wallpapers/')) return null;
    const img = $item.find('img');
    const src2x = ((img.attr('srcset') || '').match(/(https:\/\/[^\s]+thumbs_2t\/[^\s]+)/) || [])[1];
    const keywords = ($item.find('meta[itemprop="keywords"]').attr('content') || '').split(',').map(s => s.trim()).filter(Boolean);
    return {
      id: (href.match(/-([0-9]+)\.html/) || [])[1] || null,
      title: $item.find('.title2, .title').text().trim() || img.attr('alt') || '',
      url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
      thumbnail: img.attr('src') || null,
      thumbnail2x: src2x || img.attr('src') || null,
      keywords
    };
  }).get().filter(Boolean);
  return {
    total: wallpapers.length,
    page: Number(page) || 1,
    hasNext: $('a[href*="page="]').length > 0,
    wallpapers
  };
};

const getWallpapers = async (path = '', page = 1) => {
  const sep = path.includes('?') ? '&' : '?';
  const queryPath = page > 1 ? `${path}${sep}page=${page}` : path;
  return parseWallpapers(await fetchHtml(queryPath), page);
};

const getCollections = async (page = 1) => {
  const $ = load(await fetchHtml(page > 1 ? `/collections-packs/?page=${page}` : '/collections-packs/'));
  const collections = $('#packs-list p, .pics p').map((_, el) => {
    const $item = $(el);
    const link = $item.find('a').attr('href');
    if (!link) return null;
    return {
      title: ($item.find('a').attr('title') || $item.find('.packtitle').text().trim()).replace(/Wallpapers\s*$/i, '').trim(),
      slug: link.replace(/^\/+|\/+$/g, ''),
      url: link.startsWith('http') ? link : `${BASE_URL}${link}`,
      thumbnail: $item.find('img').attr('src') || null
    };
  }).get().filter(Boolean);
  return { total: collections.length, page: Number(page) || 1, collections };
};

const getCollectionDetails = async (slug) => {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '');
  const $ = load(await fetchHtml(`/${cleanSlug}/`));
  const wallpapers = $('.wallpapers__item').map((_, el) => {
    const $item = $(el);
    const dl = $item.find('a[href*="/images/wallpapers/"]').attr('href');
    return {
      title: $item.find('.title.tags').text().trim() || $item.find('img').attr('alt') || '',
      preview: $item.find('img').attr('src') || null,
      download: dl ? (dl.startsWith('http') ? dl : `${BASE_URL}${dl}`) : null
    };
  }).get().filter(w => w.preview || w.download);
  return { title: $('h1').text().trim(), total: wallpapers.length, wallpapers };
};

const getCategories = async () => {
  const $ = load(await fetchHtml('/'));
  return $('.section-dropdown a').map((_, el) => ({
    name: $(el).text().trim(),
    slug: $(el).attr('href').replace(/^\/+|\/+$/g, '')
  })).get();
};

export default {
  name: "Search Wallpaper 4K",
  description: "Scraper wallpaper resolusi 4K: daftar terbaru/populer/featured, acak, pencarian, kategori, dan detail koleksi (link preview & download).",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "slug", "page"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Aksi: recent, popular, featured, random, search, category, categories, collections, collection",
      default: "recent",
      enum: ["recent", "popular", "featured", "random", "search", "category", "categories", "collections", "collection"]
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (wajib untuk action=search)"
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug kategori (action=category) atau koleksi (action=collection)"
    },
    page: {
      type: "integer",
      required: false,
      description: "Nomor halaman (opsional)"
    }
  },

  async run(req, res) {
    const { action = "recent", query, slug, page } = { ...req.query, ...req.body };

    try {
      const p = parseInt(page, 10) || 1;
      let result;

      switch (action) {
        case "recent":
          result = await getWallpapers('', p);
          break;
        case "popular":
          result = await getWallpapers('/most-popular-4k-wallpapers/', p);
          break;
        case "featured":
          result = await getWallpapers('/best-4k-wallpapers/', p);
          break;
        case "random":
          result = await getWallpapers('/random-wallpapers/', 1);
          break;
        case "search":
          if (!query) throw new Error("Parameter query wajib untuk action=search");
          result = await getWallpapers(`/search/?q=${encodeURIComponent(query)}`, p);
          break;
        case "category":
          if (!slug) throw new Error("Parameter slug wajib untuk action=category");
          result = await getWallpapers(`/${slug}/`, p);
          break;
        case "categories":
          result = { categories: await getCategories() };
          break;
        case "collections":
          result = await getCollections(p);
          break;
        case "collection":
          if (!slug) throw new Error("Parameter slug wajib untuk action=collection");
          result = await getCollectionDetails(slug);
          break;
        default:
          throw new Error(`Action tidak dikenal: ${action}`);
      }

      res.json({
        status: true,
        result: {
          action,
          ...result
        },
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("Wallpaper 4K Error:", err.message);
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mengambil data wallpaper",
        timestamp: Date.now()
      });
    }
  }
}
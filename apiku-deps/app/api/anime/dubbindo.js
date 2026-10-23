import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.dubbindo.site/';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: BASE_URL,
};

const CATEGORIES = [
  { id: '1', slug: 'film-movie', name: 'Film Movie' },
  { id: '3', slug: 'tv-series', name: 'TV Series' },
  { id: '4', slug: 'anime-movie', name: 'Anime Movie' },
  { id: '5', slug: 'anime-series', name: 'Anime Series' },
  { id: '790', slug: 'shorts', name: '#Shorts' },
  { id: 'other', slug: 'other', name: 'Other' },
  { id: '791', slug: 'uncategory', name: 'Uncategory' },
];

const CATEGORY_MAP = {
  '1': '1',
  film: '1',
  movie: '1',
  'film-movie': '1',
  '3': '3',
  series: '3',
  tv: '3',
  'tv-series': '3',
  '4': '4',
  animemovie: '4',
  'anime-movie': '4',
  '5': '5',
  animeseries: '5',
  'anime-series': '5',
  anime: '5',
  '790': '790',
  shorts: '790',
  '#shorts': '790',
  other: 'other',
  '791': '791',
  uncategory: '791',
};

async function fetchPage(url, customHeaders = {}) {
  const response = await axios.get(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...customHeaders,
    },
    timeout: 20000,
  });
  return response.data;
}

function parseVideoCards($, selector) {
  const videos = [];
  $(selector).each((_, elem) => {
    const item = $(elem);

    const isSearchCard =
      item.hasClass('video-latest-list') || item.find('.video-thumb').length > 0;

    const aImage = isSearchCard
      ? item.find('.video-thumb a')
      : item.find('.video-list-image a');
    if (aImage.length === 0) return;

    const href = aImage.attr('href') || '';
    let absoluteUrl = href;
    if (href && href.startsWith('/')) {
      absoluteUrl = new URL(href.substring(1), BASE_URL).href;
    }

    const img = aImage.find('img');
    const title =
      img.attr('alt') ||
      item.find('.video-title h4').text().trim() ||
      item.find('.video-list-title h4').text().trim() ||
      '';
    const thumbnail = img.attr('src') || '';

    const duration = isSearchCard
      ? item.find('.video-duration').text().trim()
      : aImage.find('.duration').text().trim();

    let creatorName = '';
    let creatorUrl = '';
    let creatorAvatar = '';
    let views = null;
    let uploadedAt = null;
    let description = '';

    if (isSearchCard) {
      const infoDiv = item.find('.video-info');
      const creatorLink = infoDiv.find('a[href*="/@"]');
      creatorName = creatorLink.text().trim();
      creatorUrl = creatorLink.attr('href') || '';

      const spans = infoDiv.find('span');
      if (spans.length > 0) views = $(spans[0]).text().trim();
      if (spans.length > 1) {
        const secondText = $(spans[1]).text().trim();
        if (secondText !== '·') {
          uploadedAt = secondText;
        } else if (spans.length > 2) {
          uploadedAt = $(spans[2]).text().trim();
        }
      }
      description = infoDiv.find('p').text().trim();
    } else {
      const byDiv = item.find('.video-list-by');
      const creatorLink = byDiv.find('a');
      creatorName = creatorLink.text().trim();
      creatorUrl = creatorLink.attr('href') || '';

      const textNodes = byDiv.contents().filter(function () {
        return this.nodeType === 3;
      });
      const metaText = textNodes.text().trim();
      if (metaText) {
        const parts = metaText.split('·').map((p) => p.trim());
        if (parts.length > 0) views = parts[0];
        if (parts.length > 1) uploadedAt = parts[1];
      }
    }

    if (creatorUrl && creatorUrl.startsWith('/')) {
      creatorUrl = new URL(creatorUrl.substring(1), BASE_URL).href;
    }

    videos.push({
      title,
      url: absoluteUrl,
      thumbnail,
      duration,
      creator: {
        name: creatorName,
        url: creatorUrl,
      },
      views,
      uploadedAt,
      ...(isSearchCard && { description }),
    });
  });
  return videos;
}

/**
 * 1. Get Homepage Videos
 */
async function getHomepage() {
  const html = await fetchPage(BASE_URL);
  const $ = cheerio.load(html);

  const featuredTitle = $('.pt_feat_vid_details h1 a').text().trim();
  const featuredUrl = $('.pt_feat_vid_details h1 a').attr('href') || '';
  const featuredMeta = $('.pt_feat_vid_details p').text().trim();
  let featuredDuration = '';
  if (featuredMeta) {
    const parts = featuredMeta.split('·').map((p) => p.trim());
    if (parts.length > 2) {
      featuredDuration = parts[2];
    }
  }

  const featured = featuredTitle
    ? {
        title: featuredTitle,
        url: featuredUrl.startsWith('/')
          ? new URL(featuredUrl.substring(1), BASE_URL).href
          : featuredUrl,
        duration: featuredDuration,
      }
    : null;

  const trending = parseVideoCards($, '.pt_four_videos_trend .video-list');
  const latest = parseVideoCards($, '.pt_four_videos_top .video-list');
  const shorts = parseVideoCards($, '.videos .video-list');

  return {
    featured,
    trending,
    latest,
    shorts,
  };
}

/**
 * 2. Search Videos by Keyword
 */
async function searchVideos(query) {
  const searchUrl = `${BASE_URL}search?keyword=${encodeURIComponent(query)}`;
  const html = await fetchPage(searchUrl);
  const $ = cheerio.load(html);

  const videos = parseVideoCards($, '.video-wrapper');
  return videos;
}

/**
 * 3. Get Category Videos
 */
async function getCategoryVideos(categoryId) {
  const mapped = CATEGORY_MAP[String(categoryId).toLowerCase()] || categoryId;
  const categoryUrl = `${BASE_URL}videos/category/${mapped}`;
  const html = await fetchPage(categoryUrl);
  const $ = cheerio.load(html);

  const videos = parseVideoCards($, '.video-wrapper, .video-list');
  return {
    categoryId: mapped,
    videos,
  };
}

/**
 * 4. Get Video Details & Streaming Direct MP4 Links
 */
async function getVideoDetails(targetUrl) {
  let watchUrl = targetUrl.trim();
  if (!watchUrl.startsWith('http://') && !watchUrl.startsWith('https://')) {
    if (watchUrl.startsWith('/')) {
      watchUrl = new URL(watchUrl.substring(1), BASE_URL).href;
    } else if (watchUrl.includes('watch/')) {
      watchUrl = `${BASE_URL}${watchUrl}`;
    } else {
      watchUrl = `${BASE_URL}watch/${watchUrl}`;
    }
  }

  const html = await fetchPage(watchUrl);
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const description = $('meta[property="og:description"]').attr('content') || '';
  const thumbnail =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="thumbnail"]').attr('content') ||
    '';

  let creatorName = '';
  let creatorAvatar = '';
  let creatorUrl = '';

  $('a').filter((_, el) => ($(el).attr('href') || '').includes('/@')).each((_, el) => {
    const href = $(el).attr('href');
    if (!creatorUrl && href) {
      creatorUrl = href.startsWith('/') ? new URL(href.substring(1), BASE_URL).href : href;
    }
    const text = $(el).text().trim();
    if (text && !creatorName) creatorName = text;
    const img = $(el).find('img');
    if (img.length && !creatorAvatar) {
      creatorAvatar = img.attr('src') || '';
      if (!creatorName) creatorName = img.attr('alt') || '';
    }
  });

  const viewsText = $('.video-views').first().text().replace(/\s+/g, ' ').trim();
  let views = null;
  let uploadedAt = null;
  if (viewsText) {
    const parts = viewsText.split('·').map((p) => p.trim());
    if (parts.length > 0) views = parts[0];
    if (parts.length > 1) uploadedAt = parts[1];
  }

  const streams = [];
  const mp4Regex = /src:\s*['"](https?:\/\/[^'"]+\.mp4)['"]/g;
  let match;
  const seenUrls = new Set();

  while ((match = mp4Regex.exec(html)) !== null) {
    const streamUrl = match[1];
    if (!seenUrls.has(streamUrl)) {
      seenUrls.add(streamUrl);
      let label = 'SD';
      if (streamUrl.includes('_240p')) label = '240p';
      else if (streamUrl.includes('_360p')) label = '360p';
      else if (streamUrl.includes('_480p')) label = '480p';
      else if (streamUrl.includes('_720p')) label = '720p';
      else if (streamUrl.includes('_1080p')) label = '1080p';

      streams.push({
        quality: label,
        url: streamUrl,
      });
    }
  }

  let videoId = null;
  const videoIdMatch = html.match(/video_id:\s*['"]?(\d+)['"]?/);
  if (videoIdMatch) {
    videoId = videoIdMatch[1];
  }

  return {
    title,
    description,
    thumbnail,
    creator: {
      name: creatorName,
      url: creatorUrl,
      avatar: creatorAvatar,
    },
    videoId,
    views,
    uploadedAt,
    streamsCount: streams.length,
    streams,
  };
}

const ACTIONS = [
  'home',
  'trending',
  'latest',
  'shorts',
  'categories',
  'category',
  'search',
  'detail',
  'watch',
  'stream',
];

export default {
  name: 'Dubbindo',
  description:
    'Scraper anime, kartun & film dubbing Indonesia dari dubbindo.site — home, trending, latest, shorts, search, category, detail & direct stream MP4',
  category: 'Anime',
  methods: ['GET', 'POST'],
  params: ['action', 'query', 'url', 'category'],
  paramsSchema: {
    action: {
      type: 'string',
      required: true,
      default: 'home',
      enum: ACTIONS,
      description:
        'Aksi yang ingin dijalankan: home, trending, latest, shorts, categories, category, search, detail/watch/stream',
    },
    query: {
      type: 'string',
      required: false,
      default: '',
      description: 'Kata kunci pencarian anime/film (wajib untuk action=search)',
      example: 'naruto',
    },
    url: {
      type: 'string',
      required: false,
      default: '',
      description: 'URL video watch dubbindo atau slug (wajib untuk action=detail / watch / stream)',
      example:
        'https://www.dubbindo.site/watch/happy-ending-2014-dubbing-indonesia_PaqiNb6b38NKxV1.html',
    },
    category: {
      type: 'string',
      required: false,
      default: '5',
      description:
        'ID atau nama kategori: 1 (Film), 3 (TV Series), 4 (Anime Movie), 5 (Anime Series), 790 (Shorts), other',
      example: '5',
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const action = String(params.action || params.type || 'home').trim().toLowerCase();

    try {
      switch (action) {
        case 'home': {
          const data = await getHomepage();
          return res.json({
            status: true,
            action,
            result: data,
          });
        }

        case 'trending': {
          const data = await getHomepage();
          return res.json({
            status: true,
            action,
            total: data.trending.length,
            result: data.trending,
          });
        }

        case 'latest': {
          const data = await getHomepage();
          return res.json({
            status: true,
            action,
            total: data.latest.length,
            result: data.latest,
          });
        }

        case 'shorts': {
          const data = await getHomepage();
          return res.json({
            status: true,
            action,
            total: data.shorts.length,
            result: data.shorts,
          });
        }

        case 'categories': {
          return res.json({
            status: true,
            action,
            total: CATEGORIES.length,
            result: CATEGORIES,
          });
        }

        case 'category': {
          const cat = params.category || params.id || '5';
          const { categoryId, videos } = await getCategoryVideos(cat);
          return res.json({
            status: true,
            action,
            categoryId,
            total: videos.length,
            result: videos,
          });
        }

        case 'search': {
          const query = params.query || params.q;
          if (!query) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'query' wajib diisi untuk action=search",
            });
          }
          const videos = await searchVideos(query);
          return res.json({
            status: true,
            action,
            query,
            total: videos.length,
            result: videos,
          });
        }

        case 'detail':
        case 'watch':
        case 'stream': {
          const targetUrl = params.url || params.query || params.slug;
          if (!targetUrl) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'url' wajib diisi untuk action=" + action,
            });
          }
          const details = await getVideoDetails(targetUrl);
          return res.json({
            status: true,
            action,
            result: details,
          });
        }

        default:
          return res.status(400).json({
            status: false,
            message: `Action '${action}' tidak valid. Gunakan salah satu: ${ACTIONS.join(', ')}`,
          });
      }
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Dubbindo request failed',
      });
    }
  },
};

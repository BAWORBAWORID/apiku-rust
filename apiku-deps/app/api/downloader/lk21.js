/**
 * LK21 Movie Scraper & Stream API
 * Creator: ShanMolvyr
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';
import getChromePath from '../../src/utils/chromePath.js';

const require = createRequire(import.meta.url);
const { addExtra } = require('puppeteer-extra');
const rebrowser = require('rebrowser-puppeteer');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const puppeteer = addExtra(rebrowser);
puppeteer.use(StealthPlugin());

const DOMAINS = {
  lk21: 'https://tv10.lk21official.cc',
  nontondrama: 'https://tv4.nontondrama.my',
};

const CHROME_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled', '--disable-infobars',
  '--disable-notifications', '--disable-popup-blocking',
  '--window-size=1366,768', '--hide-scrollbars', '--mute-audio',
];

async function fetchPage(url) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: getChromePath(),
    args: CHROME_ARGS,
    ignoreHTTPSErrors: true,
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const content = await page.content();
    await browser.close();
    return cheerio.load(content);
  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

function parseList($) {
  const results = [];
  $('article').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('figure a').first();
    const href = $a.attr('href') || '';
    if (!href) return;
    
    // Extract slug from href
    const slug = href.replace(/\/$/, '').split('/').pop();
    
    const title = $el.find('h3.poster-title, h2.poster-title').first().text().trim() || $a.attr('title') || '';
    const poster = $el.find('source[type="image/jpeg"]').attr('srcset') || $el.find('img').attr('data-src') || $el.find('img').attr('src') || '';
    const year = $el.find('span.year').text().trim() || '';
    const quality = $el.find('span.label').text().trim() || '';
    const rating = $el.find('span[itemprop="ratingValue"]').text().trim() || '';
    const episode = $el.find('span.episode strong').text().trim() || '';
    const duration = $el.find('span.duration').text().trim() || '';
    results.push({ title, slug, href, poster, year, quality, rating, episode, duration });
  });
  return results;
}

function getYear($) {
  let year = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    if (year) return;
    const m = ($(el).html() || '').match(/"datePublished":\s*"(\d{4})/);
    if (m) year = m[1];
  });
  if (!year) $('.tag-list a[href*="/year/"]').each((_, el) => { year = $(el).text().trim(); });
  return year;
}

function getTags($) {
  const tags = [];
  $('.tag-list .tag a').each((_, el) => tags.push({ label: $(el).text().trim(), href: $(el).attr('href') || '' }));
  return {
    genre: tags.filter(t => t.href.includes('/genre/')).map(t => t.label),
    country: tags.filter(t => t.href.includes('/country/')).map(t => t.label),
  };
}

function parseMovieDetail($) {
  const title = $('h1').first().text().trim();
  const rating = ($('.info-tag span strong').first().text().trim()).replace(/[^\d.]/g, '');
  const infoSpans = [];
  $('.info-tag span').each((_, el) => { const t = $(el).text().trim(); if (t) infoSpans.push(t); });
  const { genre, country } = getTags($);
  const synopsis = $('[data-full]').first().attr('data-full') || '';
  const poster = $('meta[property="og:image"]').attr('content') || '';
  const servers = [];
  const seen = new Set();
  $('[data-server]').each((_, el) => {
    const server = $(el).attr('data-server'), url = $(el).attr('data-url');
    if (server && url && !seen.has(server)) { seen.add(server); servers.push({ server, url }); }
  });
  return { title, rating, quality: infoSpans[1] || '', resolution: infoSpans[2] || '', duration: infoSpans[3] || '', year: getYear($), genre, country, synopsis, poster, servers };
}

function parseSeriesDetail($) {
  const title = $('h1').first().text().trim();
  const rating = ($('.info-tag span strong').first().text().trim()).replace(/[^\d.]/g, '');
  const infoSpans = [];
  $('.info-tag span').each((_, el) => { const t = $(el).text().trim(); if (t) infoSpans.push(t); });
  const { genre, country } = getTags($);
  const synopsis = $('[data-full]').first().attr('data-full') || '';
  const poster = $('meta[property="og:image"]').attr('content') || '';
  let episodes = [];
  $('script').each((_, el) => {
    const txt = $(el).html() || '';
    const m = txt.match(/^\s*(\{"1":\[.*\].*\})\s*$/);
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        Object.values(data).forEach(season => season.forEach(ep => {
          episodes.push({ episode: ep.episode_no, season: ep.s, title: ep.title, slug: ep.slug, href: `/${ep.slug}` });
        }));
      } catch (_) {}
    }
  });
  if (episodes.length === 0) {
    $('.episode-list a').each((_, el) => {
      const href = $(el).attr('href') || '', label = $(el).text().trim();
      const slug = href.replace(/\/$/, '').split('/').pop();
      if (href && href.includes('episode')) episodes.push({ label, slug, href });
    });
  }
  return { title, rating, airDate: infoSpans[1] || '', type: infoSpans[2] || '', status: infoSpans[3] || '', year: getYear($), genre, country, synopsis, poster, episodes };
}

function parseEpisodeWatch($) {
  const title = $('h1').first().text().trim();
  let meta = {};
  $('script').each((_, el) => {
    const txt = $(el).html() || '';
    const m = txt.match(/\{[^<]*"current_eps"[^<]*\}/);
    if (m) { try { meta = JSON.parse(m[0]); } catch (_) {} }
  });
  const servers = [];
  const seen = new Set();
  $('[data-server]').each((_, el) => {
    const server = $(el).attr('data-server'), url = $(el).attr('data-url');
    if (server && url && !seen.has(server)) { seen.add(server); servers.push({ server, url }); }
  });
  let prevEp = null;
  const nextEp = meta.next ? `/${meta.next}` : null;
  if (meta.current_eps > 1 && meta.slug) {
    prevEp = `/${meta.slug.replace(/-episode-\d+-/, `-episode-${meta.current_eps - 1}-`)}`;
  }
  return { title, season: meta.current_season || null, episode: meta.current_eps || null, totalEps: meta.total_eps || null, rating: meta.rating || null, poster: meta.poster || null, seriesSlug: meta.slug || null, servers, prevEp, nextEp };
}

export const lk21Scraper = {
  async home(category = 'movie') {
    const isSeries = category === 'series';
    const domain = isSeries ? DOMAINS.nontondrama : DOMAINS.lk21;
    const $ = await fetchPage(`${domain}/`);
    return parseList($);
  },

  async latest(category = 'movie', page = 1) {
    const isSeries = category === 'series';
    const domain = isSeries ? DOMAINS.nontondrama : DOMAINS.lk21;
    const path = isSeries
      ? (page > 1 ? `/latest-series/page/${page}/` : '/latest-series/')
      : (page > 1 ? `/latest/page/${page}/` : '/latest/');
    const $ = await fetchPage(`${domain}${path}`);
    return parseList($);
  },

  async search(q, category = 'movie', page = 1) {
    const isSeries = category === 'series';
    const domain = isSeries ? DOMAINS.nontondrama : DOMAINS.lk21;
    const b = `${domain}/search/`;
    const url = page > 1 ? `${b}page/${page}/?s=${encodeURIComponent(q)}` : `${b}?s=${encodeURIComponent(q)}`;
    const $ = await fetchPage(url);
    return parseList($);
  },

  async genre(genre, category = 'movie', page = 1) {
    const isSeries = category === 'series';
    const domain = isSeries ? DOMAINS.nontondrama : DOMAINS.lk21;
    const b = `${domain}/genre/${genre}/`;
    const url = page > 1 ? `${b}page/${page}/` : b;
    const $ = await fetchPage(url);
    return parseList($);
  },

  async detail(slug, category = 'movie') {
    const isSeries = category === 'series';
    const domain = isSeries ? DOMAINS.nontondrama : DOMAINS.lk21;
    const url = `${domain}/${slug}/`;
    const $ = await fetchPage(url);
    
    if (!isSeries) {
      const h1 = $('h1').first().text().toLowerCase();
      if (h1.includes('dialihkan') || h1.includes('nontondrama')) {
        const sUrl = `${DOMAINS.nontondrama}/${slug}/`;
        const $s = await fetchPage(sUrl);
        return { type: 'series', data: parseSeriesDetail($s) };
      }
      return { type: 'movie', data: parseMovieDetail($) };
    } else {
      const ogType = $('meta[property="og:type"]').attr('content') || '';
      const ogUrl = $('meta[property="og:url"]').attr('content') || '';
      const isMovie = ogType !== 'series' && (ogUrl.includes('d21.team') || ogUrl.includes('lk21official') || !ogUrl.includes('nontondrama'));
      if (isMovie) {
        const mUrl = `${DOMAINS.lk21}/${slug}/`;
        const $m = await fetchPage(mUrl);
        return { type: 'movie', data: parseMovieDetail($m) };
      }
      return { type: 'series', data: parseSeriesDetail($) };
    }
  },

  async watchSeries(slug) {
    const url = `${DOMAINS.nontondrama}/${slug}/`;
    const $ = await fetchPage(url);
    return parseEpisodeWatch($);
  }
};

export default {
  name: "LK21 Stream Downloader",
  description: "Scrape and stream movies and series from Layarkaca21 and Nontondrama",
  category: "Downloader",
  methods: ["GET"],
  params: ["action", "q", "page", "slug", "genre", "category", "url"],
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
      default: "movie",
      required: false
    },
    url: {
      type: "string",
      required: false
    }
  },

  async run(req, res) {
    try {
      const { action = 'latest', q, page = 1, slug, genre, category = 'movie', url } = req.query;
      const pageNum = parseInt(page, 10) || 1;

      // Handle iframe reverse proxy to bypass CSP
      if (action.toLowerCase() === 'proxy') {
        if (!url) return res.status(400).send("Parameter 'url' wajib");
        try {
          const proxyRes = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': url.includes('hownetwork.xyz') ? 'https://playeriframe.sbs/' : url
            },
            timeout: 10000
          });
          
          res.removeHeader('Content-Security-Policy');
          res.removeHeader('X-Frame-Options');
          res.setHeader('Content-Type', 'text/html; charset=UTF-8');
          
          let html = proxyRes.data;
          const base = new URL(url).origin;
          
          // Rewrite relative paths
          html = html.replace(/(src|href)=["'](?!https?:\/\/|\/\/)([^"']+)["']/g, `$1="${base}/$2"`);
          
          // Rewrite nested iframe source to go through our proxy as well to strip secondary CSPs
          html = html.replace(/<iframe([^>]+)src=["'](https?:\/\/[^"']+)["']/gi, (match, attrs, iframeUrl) => {
            if (iframeUrl.includes('hownetwork.xyz') || iframeUrl.includes('playeriframe') || iframeUrl.includes('mamamas.xyz')) {
              return `<iframe${attrs}src="/api/downloader/lk21?action=proxy&url=${encodeURIComponent(iframeUrl)}"`;
            }
            return match;
          });

          // Strip frame-buster scripts
          html = html.replace(/window\.self\s*===\s*window\.top/g, 'false');
          html = html.replace(/window\.top\.location\.replace/g, 'console.log');
          html = html.replace(/window\.location\.replace\(["']https:\/\/lk21\.de["']\)/g, 'console.log("no-redirect")');
          
          // Inject AD-BLOCK styling & script to remove overlay ads
          const adBlockCss = `
            <style>
              #uyeouyeo, #overlay, a[href*="organicowner.com"], .message-box, [class*="pub_"] {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
                z-index: -9999 !important;
                width: 0 !important;
                height: 0 !important;
                opacity: 0 !important;
              }
            </style>
          `;
          const adBlockJs = `
            <script>
              document.addEventListener("DOMContentLoaded", function() {
                // Periodically remove overlays to prevent dynamic ads
                setInterval(() => {
                  const badElements = document.querySelectorAll('#uyeouyeo, #overlay, a[href*="organicowner"], .message-box, [class*="pub_"]');
                  badElements.forEach(el => el.remove());
                }, 100);

                // Autoplay trigger
                setTimeout(() => {
                  try {
                    const video = document.querySelector('video');
                    if (video) {
                      video.muted = true;
                      video.play().then(() => {
                        setTimeout(() => { video.muted = false; }, 1500);
                      }).catch(e => {
                        // fallback click
                        const playBtn = document.querySelector('.jw-display-icon-container, .plyr__control--overlaid');
                        if (playBtn) playBtn.click();
                      });
                    } else {
                      const playBtn = document.querySelector('.jw-display-icon-container, .plyr__control--overlaid');
                      if (playBtn) playBtn.click();
                    }
                  } catch(e) {}
                }, 2000);
              });
            </script>
          `;
          html = html.replace('</head>', `${adBlockCss}${adBlockJs}</head>`);
          
          return res.send(html);
        } catch (e) {
          return res.status(500).send("Failed to proxy video page: " + e.message);
        }
      }

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
        message: err.message || "Failed to process LK21 request"
      });
    }
  }
};

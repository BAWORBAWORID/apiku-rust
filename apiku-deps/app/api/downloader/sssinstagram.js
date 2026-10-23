/**
 * SssInstagram Downloader
 * Provider : https://sssinstagram.com
 * Supports : Instagram Post, Reel, Video, Photo, Carousel & Story
 *
 * GET  /api/downloader/sssinstagram?url=<instagram-url-or-story-username>
 * POST /api/downloader/sssinstagram -d {"url": "..."}
 */

import axios from 'axios';

const JANTUNG = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://sssinstagram.com',
  Referer: 'https://sssinstagram.com/'
};

async function resolveCaptcha() {
  const { data: createTask } = await axios.post(
    'https://cap.jhx.my.id/api/createTask',
    {
      url: 'https://sssinstagram.com/',
      type: 'turnstile-min',
      sitekey: '0x4AAAAAABidZPD0BFP2LVxa'
    },
    { timeout: 15000 }
  );

  if (!createTask.success) throw new Error('Gagal membuat tugas captcha');

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { data: checkTask } = await axios.post(
      'https://cap.jhx.my.id/api/getResult',
      { jobId: createTask.jobId },
      { timeout: 15000 }
    );
    if (checkTask.status === 'ready' && checkTask.solution?.token) {
      return checkTask.solution.token;
    }
    if (checkTask.status === 'failed') {
      throw new Error('Solver gagal menyelesaikan captcha');
    }
  }
  throw new Error('Waktu tunggu penyelesaian captcha habis');
}

async function getSignatureFunction() {
  let chunkId = 'a8161cb908c227fb';
  try {
    const { data: mainHtml } = await axios.get('https://sssinstagram.com/en1', {
      headers: JANTUNG,
      timeout: 10000
    });
    const appId = mainHtml.match(/\/js\/app\.js\?id=([a-zA-Z0-9]+)/)?.[1];
    if (appId) {
      const { data: appData } = await axios.get(
        `https://sssinstagram.com/js/app.js?id=${appId}`,
        { headers: JANTUNG, timeout: 10000 }
      );
      chunkId = appData.match(/54:\s*"([a-zA-Z0-9]+)"/)?.[1] || chunkId;
    }
  } catch {}

  const { data: chunkCode } = await axios.get(
    `https://sssinstagram.com/js/link.chunk.js?ch=${chunkId}`,
    { headers: JANTUNG, timeout: 15000 }
  );

  // Setup mock browser globals tanpa isolasi node:vm
  Object.defineProperty(globalThis, 'webpackChunk', {
    value: [],
    writable: true,
    configurable: true
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true
  });
  Object.defineProperty(globalThis, 'self', {
    value: globalThis,
    writable: true,
    configurable: true
  });
  Object.defineProperty(globalThis, 'top', {
    value: globalThis,
    writable: true,
    configurable: true
  });
  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => ({ setAttribute: () => {} }),
      head: { appendChild: () => {} }
    },
    writable: true,
    configurable: true
  });
  Object.defineProperty(globalThis, 'location', {
    value: { href: 'https://sssinstagram.com/', hostname: 'sssinstagram.com' },
    writable: true,
    configurable: true
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr === '/msec' || urlStr.endsWith('/msec')) {
      return { json: async () => ({ msec: Date.now() / 1000 }) };
    }
    return originalFetch(url, opts);
  };

  let resolved;
  try {
    (0, eval)(chunkCode);
    const webpackEngine = globalThis.webpackChunk?.[0]?.[1];
    if (!webpackEngine) throw new Error('Gagal memuat modul Webpack');

    const moduleCache = {};
    const requireModule = (id) => {
      if (moduleCache[id]) return moduleCache[id].exports;
      const mod = { exports: {} };
      moduleCache[id] = mod;
      webpackEngine[id](mod, mod.exports, requireModule);
      return mod.exports;
    };
    requireModule.d = (exports, def) =>
      Object.keys(def).forEach(
        (k) =>
          !Object.prototype.hasOwnProperty.call(exports, k) &&
          Object.defineProperty(exports, k, { enumerable: true, get: def[k] })
      );
    requireModule.r = (exports) => {
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
      Object.defineProperty(exports, '__esModule', { value: true });
    };

    const targetModule = requireModule(7027);
    resolved = await (targetModule.default || targetModule);
  } finally {
    globalThis.fetch = originalFetch;
  }

  return resolved;
}

export async function downloadSssInstagram(urlInput) {
  let rawUrl = (urlInput || '').trim();
  let igUrl = rawUrl.match(/https?:\/\/(www\.)?instagram\.com[^\s]+/i)?.[0];

  if (!igUrl && rawUrl) {
    igUrl = `https://www.instagram.com/stories/${rawUrl.replace(/^@/, '')}/`;
  } else if (igUrl && igUrl.includes('/stories/')) {
    const storyMatch = igUrl.match(/\/stories\/([^\/?#]+)/);
    if (storyMatch) igUrl = `https://www.instagram.com/stories/${storyMatch[1]}/`;
  }

  if (!igUrl || !igUrl.includes('instagram.com')) {
    throw new Error('URL Instagram tidak valid.');
  }

  const isStory = igUrl.includes('/stories/');
  const apiEndpoint = isStory
    ? 'https://api-wh.sssinstagram.com/api/v1/instagram/story'
    : 'https://api-wh.sssinstagram.com/api/convert';

  const generateSignature = await getSignatureFunction();
  const requestPayload = await generateSignature(
    isStory ? { url: igUrl } : { target_url: igUrl }
  );

  let captchaToken = await resolveCaptcha();

  const exchangeToken = async (token) => {
    const { data } = await axios.post(
      'https://api-wh.sssinstagram.com/api/cf',
      `cfToken=${encodeURIComponent(token)}`,
      {
        headers: {
          ...JANTUNG,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      }
    );
    if (!data.result) throw new Error('Gagal menukar token captcha');
    return data.result;
  };

  let webhookToken = await exchangeToken(captchaToken);

  const fetchMedia = async (token) =>
    axios.post(apiEndpoint, requestPayload, {
      headers: {
        ...JANTUNG,
        'Content-Type': 'application/json',
        'wh-cf-token': token
      },
      timeout: 30000,
      validateStatus: () => true
    });

  let apiResponse = await fetchMedia(webhookToken);
  if (
    apiResponse.status === 422 ||
    apiResponse.data?.code === 'CAPTCHA_REQUIRED'
  ) {
    captchaToken = await resolveCaptcha();
    webhookToken = await exchangeToken(captchaToken);
    apiResponse = await fetchMedia(webhookToken);
  }

  const responseData = isStory ? apiResponse.data?.result : apiResponse.data;
  if (!Array.isArray(responseData) || responseData.length === 0) {
    throw new Error(
      apiResponse.data?.message ||
        'Server menolak permintaan atau data media tidak ditemukan'
    );
  }

  const metadata = {
    author: isStory
      ? responseData[0].user?.username || 'unknown'
      : responseData[0].meta?.username || 'unknown',
    caption: isStory ? '' : responseData[0].meta?.title || ''
  };

  const mediaList = [];
  responseData.forEach((item) => {
    if (isStory) {
      const videos = item.video_versions || [];
      const images = item.image_versions2?.candidates || [];
      if (videos.length) {
        mediaList.push({
          type: 'Video',
          url: videos[0].url_wrapped || videos[0].url
        });
      } else if (images.length) {
        mediaList.push({
          type: 'Image',
          url: images[0].url_wrapped || images[0].url
        });
      }
    } else {
      const assets = Array.isArray(item.url) ? item.url : [];
      assets.forEach((asset) => {
        const typeLabel =
          asset.type === 'mp4' || asset.ext === 'mp4' ? 'Video' : 'Image';
        mediaList.push({
          type: typeLabel,
          url: asset.url
        });
      });
    }
  });

  return {
    author: metadata.author,
    caption: metadata.caption,
    media: mediaList
  };
}

export default {
  name: 'SssInstagram Downloader',
  description:
    'Download Reels, Post, Carousel, Photo, Video, dan Story Instagram via sssinstagram.com',
  category: 'Downloader',
  methods: ['GET', 'POST'],
  params: ['url'],
  paramsSchema: {
    url: {
      type: 'string',
      required: true,
      description:
        'URL Instagram (Post, Reel, Story) atau username Instagram untuk Story',
      example: 'https://www.instagram.com/p/DZcugj-ICJF/'
    }
  },

  async run(req, res) {
    const { url, link } = { ...req.query, ...req.body };
    const target = (url || link || '').toString().trim();

    if (!target) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi"
      });
    }

    try {
      const result = await downloadSssInstagram(target);
      return res.json({
        status: true,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal mendownload media dari SssInstagram'
      });
    }
  }
};

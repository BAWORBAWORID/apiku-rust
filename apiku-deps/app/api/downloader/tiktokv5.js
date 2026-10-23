/**
 * TikTok Downloader Direct v5
 * Provider: Direct TikTok HTML Scraping (Universal Data & Player API)
 * Features: Support Video (No-WM & WM) + Photo Slideshow, Author Stats, Music Info
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function requestHtml(url) {
  const res = await axios.get(url, {
    headers: {
      "sec-ch-ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "upgrade-insecure-requests": "1",
      "user-agent": UA,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      "sec-fetch-user": "?1",
      "sec-fetch-dest": "document",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6",
      priority: "u=0, i",
    },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return { text: res.data, headers: res.headers };
}

function extractItemStruct(html) {
  const apiMatch = html.match(/<script id="api-data"[^>]*>([\s\S]*?)<\/script>/);
  if (apiMatch) {
    try {
      const j = JSON.parse(apiMatch[1]);
      let s = j?.videoDetail?.itemInfo?.itemStruct || j?.itemInfo?.itemStruct;
      if (s) return s;
      if (j?.ItemModule) {
        const firstId = Object.keys(j.ItemModule)[0];
        if (firstId && j.ItemModule[firstId]) return j.ItemModule[firstId];
      }
    } catch (_) {}
  }

  const uniMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (uniMatch) {
    try {
      const j = JSON.parse(uniMatch[1]);
      const defaultScope = j?.__DEFAULT_SCOPE__ || {};
      for (const key of Object.keys(defaultScope)) {
        const s = defaultScope[key]?.itemInfo?.itemStruct;
        if (s) return s;
      }
    } catch (_) {}
  }
  return null;
}

async function fetchPlayerApi(itemId) {
  try {
    const pUrl = `https://www.tiktok.com/player/api/v1/items?item_ids=${itemId}`;
    const res = await axios.get(pUrl, { headers: { "user-agent": UA }, timeout: 15000 });
    return res.data?.items?.[0]?.video_info?.url_list?.[0] || null;
  } catch (_) {
    return null;
  }
}

async function tiktokDirect(url) {
  const { text } = await requestHtml(url);
  const detail = extractItemStruct(text);

  if (!detail) {
    throw new Error("Gagal mengekstrak data dari HTML TikTok");
  }

  const isImage = Boolean(detail.imagePost);
  let directUrl = null;
  if (!isImage && detail.id) {
    directUrl = await fetchPlayerApi(detail.id);
  }

  const rawImages = isImage
    ? (detail.imagePost?.images || []).map((img, i) => {
        const urls = img?.imageURL?.urlList || [];
        return {
          index: i + 1,
          url: urls[0] || null,
        };
      })
    : [];

  const nowmVideo = directUrl || detail.video?.playAddr || null;
  const wmVideo = detail.video?.downloadAddr || null;
  const photos = isImage ? rawImages.map((img) => img.url).filter(Boolean) : [];

  return {
    id: detail.id || detail.aweme_id || null,
    type: isImage ? "image" : "video",
    title: detail.desc || detail.suggestedWords?.[0] || "",
    region: detail.locationCreated || null,
    duration: detail.video?.duration || detail.music?.duration || 0,
    cover: detail.video?.cover || detail.video?.originCover || null,
    video: isImage
      ? null
      : {
          nowm: nowmVideo,
          wm: wmVideo,
        },
    images: photos,
    music: {
      id: detail.music?.id || null,
      title: detail.music?.title || "",
      author: detail.music?.authorName || "",
      duration: detail.music?.duration || 0,
      url: detail.music?.playUrl || null,
      thumbnail:
        detail.music?.coverLarge || detail.music?.coverMedium || detail.music?.coverThumb || null,
    },
    stats: {
      views: detail.stats?.playCount || 0,
      likes: detail.stats?.diggCount || 0,
      shares: detail.stats?.shareCount || 0,
      comments: detail.stats?.commentCount || 0,
      collects: detail.stats?.collectCount || 0,
    },
    author: {
      id: detail.author?.id || "",
      secUid: detail.author?.secUid || "",
      username: detail.author?.uniqueId || "",
      nickname: detail.author?.nickname || "",
      avatar:
        detail.author?.avatarLarger ||
        detail.author?.avatarMedium ||
        detail.author?.avatarThumb ||
        null,
      verified: detail.author?.verified || false,
      followers: detail.authorStats?.followerCount || detail.author?.followerCount || 0,
      following: detail.authorStats?.followingCount || detail.author?.followingCount || 0,
      likes: detail.authorStats?.heartCount || detail.author?.heartCount || 0,
      videoCount: detail.authorStats?.videoCount || detail.author?.videoCount || 0,
    },
    downloads: {
      nowm: nowmVideo,
      wm: wmVideo,
      music: detail.music?.playUrl || null,
      photos,
    },
  };
}

export default {
  name: "TikTok Downloader Direct v5",
  description:
    "TikTok downloader langsung scrape HTML (support video no-watermark, photo slideshow, author stats lengkap, dan music detail)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "TikTok URL (vt.tiktok.com, tiktok.com, dll)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };
      if (!url || typeof url !== "string" || !url.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const result = await tiktokDirect(url.trim());
      return res.status(200).json({
        status: true,
        result,
      });
    } catch (err) {
      logger.error(`[TikTok v5] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data TikTok",
      });
    }
  },
};
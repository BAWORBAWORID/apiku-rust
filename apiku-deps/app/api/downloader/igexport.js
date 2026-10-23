/**
 * IGExport Instagram Downloader
 * Base URL: https://igexport.com
 * Supports: Instagram Reels, Posts, Photos & Carousel
 * 
 * GET  /api/downloader/igexport?url=<instagram-url>
 * POST /api/downloader/igexport -d {"url": "..."}
 */

import axios from "axios";

const BASE_URL = "https://igexport.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function cleanInstagramUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") return "";
  const trimmed = inputUrl.trim();
  const match = trimmed.match(/(https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[a-zA-Z0-9_-]+)/i);
  return match ? match[1] + "/" : trimmed;
}

function extractShortcode(inputUrl) {
  const match = inputUrl.match(/\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : "";
}

async function fetchFromApi(endpoint, targetUrl) {
  const isPhoto = endpoint.includes("photo");
  const refererPath = isPhoto ? "/id/photo-download/" : "/id/reels-download/";
  const requestUrl = `${BASE_URL}${endpoint}?url=${encodeURIComponent(targetUrl)}`;
  const response = await axios.get(requestUrl, {
    headers: {
      "User-Agent": UA,
      "Referer": `${BASE_URL}${refererPath}`,
      "Origin": BASE_URL,
      "Accept": "application/json, text/plain, */*"
    },
    timeout: 25000,
    validateStatus: () => true
  });

  return response.data;
}

export async function downloadInstagram(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Parameter 'url' wajib diisi.");
  }

  const cleanedUrl = cleanInstagramUrl(rawUrl);
  const shortcode = extractShortcode(cleanedUrl);

  if (!shortcode) {
    throw new Error("URL Instagram tidak valid. Contoh: https://www.instagram.com/reel/xxx/ atau /p/xxx/");
  }

  const isReel = cleanedUrl.includes("/reel/");
  const endpoints = isReel
    ? ["/api/ig-reels/", "/api/ig-photo/"]
    : ["/api/ig-photo/", "/api/ig-reels/"];

  let apiData = null;
  let lastErr = null;

  for (const ep of endpoints) {
    try {
      const data = await fetchFromApi(ep, cleanedUrl);
      if (data && data.ok && data.media) {
        apiData = data;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!apiData || !apiData.ok || !apiData.media) {
    const errorMsg = apiData?.error || lastErr?.message || "Media tidak ditemukan atau akun bersifat privat.";
    throw new Error(`Gagal mengambil media Instagram: ${errorMsg}`);
  }

  const media = apiData.media;
  const items = [];

  if (Array.isArray(media.items) && media.items.length > 0) {
    const isMulti = media.items.length > 1;
    media.items.forEach((item, idx) => {
      const isVideo = item.type === "video" || /\.mp4/i.test(item.url);
      const ext = isVideo ? "mp4" : "jpg";
      const name = item.filename || (isMulti ? `igexport-${shortcode}-${idx + 1}.${ext}` : `igexport-${shortcode}.${ext}`);
      items.push({
        index: idx + 1,
        type: isVideo ? "video" : "image",
        url: item.url,
        thumbnail: item.thumbnailUrl || null,
        filename: name
      });
    });
  } else if (media.videoUrl) {
    const isJpg = /\.jpe?g|\.png|\.webp/i.test(media.videoUrl);
    const mediaType = isJpg ? "image" : "video";
    items.push({
      index: 1,
      type: mediaType,
      url: media.videoUrl,
      thumbnail: media.thumbnailUrl || null,
      filename: media.filename || `igexport-${shortcode}.${isJpg ? "jpg" : "mp4"}`
    });
  }

  if (items.length === 0) {
    throw new Error("Tidak ada file media yang dapat diekstrak.");
  }

  const hasVideo = items.some(i => i.type === "video");
  const hasImage = items.some(i => i.type === "image");
  let overallType = items[0].type;
  if (items.length > 1) {
    overallType = hasVideo && hasImage ? "carousel_mixed" : hasVideo ? "carousel_video" : "carousel_image";
  }

  return {
    shortcode: media.shortcode || shortcode,
    post_url: cleanedUrl,
    type: overallType,
    total_items: items.length,
    download_url: items[0].url,
    media: items
  };
}

export default {
  name: "IGExport Instagram Downloader",
  description: "Download Reels, Post (Foto & Video), dan Carousel Instagram via igexport.com",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL post atau reels Instagram yang ingin didownload",
      example: "https://www.instagram.com/p/Dc-vZXEvzMD/"
    }
  },

  async run(req, res) {
    const { url, link } = { ...req.query, ...req.body };
    const target = (url || link || "").toString().trim();

    if (!target) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi"
      });
    }

    try {
      const result = await downloadInstagram(target);
      return res.json({
        status: true,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendownload media Instagram"
      });
    }
  }
};

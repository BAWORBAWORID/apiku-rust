/**
 * TikTok Downloader API v2
 * Provider: tikwm.com
 * Parameter: url
 */

import axios from "axios"

const BASE_API = "https://tikwm.com/api/"

const headers = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Cookie: "current_language=en",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
}

/* ===============================
   FETCH DATA FROM API
================================ */
async function fetchTikTokData(url) {
  try {
    const encodedParams = new URLSearchParams()
    encodedParams.set("url", url)
    encodedParams.set("hd", "1")

    const response = await axios({
      method: "POST",
      url: BASE_API,
      headers,
      data: encodedParams,
      timeout: 30000,
    })

    return response.data
  } catch (error) {
    throw new Error(`API Error: ${error.message}`)
  }
}

/* ===============================
   PARSE API RESPONSE
================================ */
function parseResponse(apiData) {
  const { data, code, msg } = apiData

  if (code !== 0 || !data) {
    throw new Error(msg || "Failed to fetch TikTok data")
  }

  const result = {
    id: data.id || null,
    region: data.region || null,
    title: data.title || null,
    cover: data.cover || null,
    origin_cover: data.origin_cover || null,
    duration: data.duration || 0,
    play: data.play || null,
    wmplay: data.wmplay || null,
    hdplay: data.hdplay || null,
    size: data.size || 0,
    wm_size: data.wm_size || 0,
    hd_size: data.hd_size || 0,
    music: data.music || null,
    music_info: data.music_info || null,
    play_count: data.play_count || 0,
    digg_count: data.digg_count || 0,
    comment_count: data.comment_count || 0,
    share_count: data.share_count || 0,
    download_count: data.download_count || 0,
    collect_count: data.collect_count || 0,
    create_time: data.create_time || 0,
    author: data.author || null,
    type: null,
    downloads: {
      nowm: [],
      wm: [],
      hd: [],
    },
    audio: [],
    images: [],
  }

  // ===============================
  // DETERMINE CONTENT TYPE
  // ===============================
  if (data.images && data.images.length > 0) {
    result.type = "photo"

    // Process images
    data.images.forEach((img, index) => {
      result.images.push({
        index: index + 1,
        url: img,
        preview: img,
      })
    })

    // Add watermark video if exists (for slides with music)
    if (data.wmplay) {
      result.downloads.wm.push({
        url: data.wmplay,
        quality: "watermarked",
        size: data.wm_size,
        format: "mp4",
      })
    }
  } else {
    result.type = "video"

    // Add video downloads
    if (data.play) {
      result.downloads.nowm.push({
        url: data.play,
        quality: "normal",
        size: data.size,
        format: "mp4",
      })
    }

    if (data.wmplay) {
      result.downloads.wm.push({
        url: data.wmplay,
        quality: "watermarked",
        size: data.wm_size,
        format: "mp4",
      })
    }

    if (data.hdplay) {
      result.downloads.hd.push({
        url: data.hdplay,
        quality: "hd",
        size: data.hd_size,
        format: "mp4",
      })
    }
  }

  // ===============================
  // ADD AUDIO/MUSIC DOWNLOAD
  // ===============================
  if (data.music) {
    result.audio.push({
      url: data.music,
      title: data.music_info?.title || "Unknown",
      author: data.music_info?.author || "Unknown",
      duration: data.music_info?.duration || 0,
      cover: data.music_info?.cover || null,
      format: "mp3",
    })
  }

  // ===============================
  // CLEAN UP AUTHOR DATA
  // ===============================
  if (result.author) {
    result.author = {
      id: result.author.id || null,
      unique_id: result.author.unique_id || null,
      nickname: result.author.nickname || null,
      avatar: result.author.avatar || null,
      signature: result.author.signature || null,
      verified: result.author.verified || false,
      private_account: result.author.private_account || false,
      region: result.author.region || null,
    }
  }

  // ===============================
  // ADD FORMATTED DATE
  // ===============================
  if (result.create_time) {
    result.create_time_formatted = new Date(result.create_time * 1000).toISOString()
  }

  return result
}

/* ===============================
   MAIN FUNCTION
================================ */
async function tiktokDownloaderV2(url) {
  const apiData = await fetchTikTokData(url)
  return parseResponse(apiData)
}

/* ===============================
   EXPORT API
================================ */

export default {
  name: "TikTok Downloader v2",
  description: "Download TikTok video/photo dengan kualitas HD tanpa watermark",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { 
      type: "string", 
      required: true,
      pattern: "(tiktok\\.com|vt\\.tiktok\\.com|vm\\.tiktok\\.com)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/"
    },
    hd: {
      type: "boolean",
      required: false,
      default: true,
      description: "Include HD quality if available"
    }
  },
  features: {
    no_watermark: true,
    hd_quality: true,
    audio_extract: true,
    slideshow_support: true,
    metadata: true
  },

  async run(req, res) {
    try {
      let { url } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string") {
        return res.status(400).json({
          status: false,
          code: 400,
          message: "Parameter 'url' wajib diisi",
          example: "https://vt.tiktok.com/ZSbm6fY8P/",
        })
      }
      url = url.trim()

      // Validate TikTok URL
      const tiktokPattern = /(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tt\.site)/
      if (!tiktokPattern.test(url)) {
        return res.status(400).json({
          status: false,
          code: 400,
          message: "URL tidak valid. Harus berupa link TikTok",
        })
      }

      if (url.includes("tt.site") || url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com")) {
        try {
          const head = await fetch(url, { method: "HEAD", redirect: "follow" })
          if (head.url) url = head.url
        } catch {}
      }

      const result = await tiktokDownloaderV2(url)

      res.json({
        status: true,
        code: 200,
        provider: "tikwm.com",
        input: url,
        result,
        timestamp: Date.now(),
      })
    } catch (err) {
      const errorCode = err.message.includes("API Error") ? 502 : 500
      
      res.status(errorCode).json({
        status: false,
        code: errorCode,
        message: err.message || "TikTok download failed",
        timestamp: Date.now(),
      })
    }
  },
}
/**
 * SnapAny Downloader API
 * Universal media (video/image/audio) downloader via api.snapany.com
 * Source: https://gist.github.com/NajmyW/d00d734914811f4d41f7bd897d573d94
 *
 * GET  /api/downloader/snapany?url=<post-url>&locale=en
 * POST /api/downloader/snapany -d {"url": "...", "locale": "en"}
 */

import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const API = "https://api.snapany.com"
const SECRET_KEY = "a5wU-SVyy5gXIyMbPQIfIz7UP7rCBp76U8Z8i-FtDMU"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

function generateHeaders(url, locale) {
  const timestamp = String(Date.now())
  const footer = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(`${url}${locale}${timestamp}`)
    .digest("hex")

  return {
    "Accept-Language": locale,
    "G-Timestamp": timestamp,
    "G-Footer": footer,
    "G-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

async function extract(url, locale) {
  const headers = generateHeaders(url, locale)
  const response = await fetch(`${API}/v1/extract/post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
      Origin: "https://snapany.com",
      Referer: "https://snapany.com/",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ link: url }),
  })

  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 500)
    throw new Error(`SnapAny API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

export default {
  name: "SnapAny Downloader",
  description: "Download media (video/audio/image) dari berbagai situs — 1000+ situs supported",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "locale"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL post/video yang ingin di-download (YouTube, TikTok, Instagram, dll)",
      example: "https://www.youtube.com/watch?v=yuc9qoh8uac",
    },
    locale: {
      type: "string",
      required: false,
      default: "en",
      description: "Locale/header Accept-Language",
      example: "en",
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { url, locale } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      let parsedUrl
      try {
        parsedUrl = new URL(url.trim())
        if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error()
      } catch {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' harus berupa URL http/https yang valid",
        })
      }

      const cleanUrl = parsedUrl.toString()
      const cleanLocale = locale || "en"

      logger.info(`[SNAPANY] extract ${cleanUrl} locale=${cleanLocale}`)

      const data = await extract(cleanUrl, cleanLocale)

      const medias = (data.medias || []).map((m) => ({
        media_type: m.media_type || null,
        resource_url: m.resource_url || null,
        resource_proxy_url: m.resource_proxy_url || null,
        preview_url: m.preview_url || null,
        duration: m.duration || null,
        variants: m.variants || null,
        subtitles: m.subtitles || null,
      }))

      const duration = Date.now() - startTime
      logger.info(`[SNAPANY] OK site=${data.site} medias=${medias.length} | ${duration}ms`)

      return res.json({
        status: true,
        url: data.post_url || cleanUrl,
        site: data.site || null,
        title: data.title || null,
        text: data.text || null,
        total_media: medias.length,
        medias,
        metadata: { processing_time: `${duration}ms` },
      })
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[SNAPANY] Error: ${error.message}`)
      return res.status(502).json({
        status: false,
        message: error.message || "SnapAny request failed",
        metadata: { processing_time: `${duration}ms` },
      })
    }
  },
}
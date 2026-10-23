/**
 * TikTok Downloader API
 * Provider: savett.cc
 * Parameter: url
 */

import dns from "node:dns"
import https from "node:https"
import axios from "axios"
import * as cheerio from "cheerio"

dns.setDefaultResultOrder("ipv4first")
const httpsAgent = new https.Agent({ family: 4, keepAlive: false })

const BASE_URL = "https://savett.cc/en1/download"

const headers = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Origin: "https://savett.cc",
  Referer: "https://savett.cc/en1/download",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/139.0.0.0 Mobile Safari/537.36",
}

/* ===============================
   GET CSRF + COOKIE
=============================== */
async function getSession() {
  const res = await axios.get(BASE_URL, {
    timeout: 30000,
    httpsAgent,
    headers: {
      "User-Agent": headers["User-Agent"],
      Accept: headers["Accept"],
      Referer: "https://savett.cc/",
    },
  })

  const csrf = res.data.match(/name="csrf_token" value="([^"]+)"/)?.[1]
  const cookie = res.headers["set-cookie"]
    ?.map((v) => v.split(";")[0])
    .join("; ")

  if (!csrf || !cookie) {
    throw new Error("Failed to get session: CSRF or Cookie not found")
  }

  return { csrf, cookie }
}

/* ===============================
   POST DOWNLOAD REQUEST
=============================== */
async function requestDownload(url, csrf, cookie) {
  const res = await axios.post(
    BASE_URL,
    `csrf_token=${encodeURIComponent(csrf)}&url=${encodeURIComponent(url)}`,
    {
      httpsAgent,
      headers: {
        ...headers,
        Cookie: cookie,
      },
      timeout: 60000,
    }
  )

  return res.data
}

/* ===============================
   PARSE RESULT HTML
=============================== */
function parse(html) {
  const $ = cheerio.load(html)

  const stats = []
  $("#video-info .my-1 span").each((_, el) => {
    stats.push($(el).text().trim())
  })

  const data = {
    username: $("#video-info h3").first().text().trim() || null,
    views: stats[0] || null,
    likes: stats[1] || null,
    bookmarks: stats[2] || null,
    comments: stats[3] || null,
    shares: stats[4] || null,
    duration:
      $("#video-info p.text-muted")
        .first()
        .text()
        .replace(/Duration:/i, "")
        .trim() || null,
    type: null,
    downloads: {
      nowm: [],
      wm: [],
    },
    mp3: [],
    slides: [],
  }

  // ===============================
  // PHOTO / SLIDES
  // ===============================
  const slides = $(".carousel-item[data-data]")
  if (slides.length) {
    data.type = "photo"

    slides.each((_, el) => {
      try {
        const json = JSON.parse(
          $(el).attr("data-data").replace(/&quot;/g, '"')
        )

        if (Array.isArray(json.URL)) {
          json.URL.forEach((url) => {
            data.slides.push({
              index: data.slides.length + 1,
              url,
            })
          })
        }
      } catch {}
    })

    return data
  }

  // ===============================
  // VIDEO
  // ===============================
  data.type = "video"

  $("#formatselect option").each((_, el) => {
    const label = $(el).text().toLowerCase()
    const raw = $(el).attr("value")
    if (!raw) return

    try {
      const json = JSON.parse(raw.replace(/&quot;/g, '"'))
      if (!json.URL) return

      if (label.includes("mp4") && !label.includes("watermark")) {
        data.downloads.nowm.push(...json.URL)
      }

      if (label.includes("watermark")) {
        data.downloads.wm.push(...json.URL)
      }

      if (label.includes("mp3")) {
        data.mp3.push(...json.URL)
      }
    } catch {}
  })

  return data
}

/* ===============================
   MAIN FUNCTION
=============================== */
async function tiktokDownloader(url) {
  const { csrf, cookie } = await getSession()
  const html = await requestDownload(url, csrf, cookie)
  return parse(html)
}

/* ===============================
   EXPORT API
=============================== */

export default {
  name: "TikTok Downloader",
  description: "Download TikTok video/photo tanpa watermark",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/",
      required: true,
    },
  },

  async run(req, res) {
    try {
      let { url } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }
      url = url.trim()

      if (!url.includes("tiktok.com") && !url.includes("tt.site") && !url.includes("douyin.com")) {
        return res.status(400).json({
          status: false,
          message: "URL harus dari domain tiktok.com atau tt.site",
        })
      }

      if (url.includes("tt.site") || url.includes("vt.tiktok.com") || url.includes("vm.tiktok.com")) {
        try {
          const head = await fetch(url, { method: "HEAD", redirect: "follow" })
          if (head.url) url = head.url
        } catch {}
      }

      const result = await tiktokDownloader(url)

      const toObj = (arr) => {
        if (!Array.isArray(arr)) return arr
        const obj = {}
        arr.forEach((v, i) => (obj[`url${i + 1}`] = v))
        return obj
      }

      result.downloads.nowm = toObj(result.downloads.nowm)
      result.downloads.wm = toObj(result.downloads.wm)
      result.mp3 = toObj(result.mp3)
      result.slides = toObj(result.slides)

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "TikTok download failed",
      })
    }
  },
}

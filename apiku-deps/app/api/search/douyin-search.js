import axios from "axios"
import * as cheerio from "cheerio"
import { createContext, runInContext } from "node:vm"
import logger from "../../src/utils/logger.js"

const CONFIG = {
  UA: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  BASE_URL: "https://so.douyin.com/",
  SEARCH_ENTRANCE: "aweme",
  ENTER_METHOD: "normal_search",
  INNER_WIDTH: "431",
  INNER_HEIGHT: "814",
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestWithRetry(config, label, attempts = CONFIG.MAX_RETRIES) {
  let lastError
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await axios({
        timeout: CONFIG.TIMEOUT,
        validateStatus: () => true,
        ...config,
      })
      return response
    } catch (e) {
      lastError = e
      if (i === attempts) throw new Error(`${label} gagal: ${e.message}`)
      await sleep(1000 * i)
    }
  }
  throw lastError
}

class DouyinSearch {
  constructor() {
    this.baseURL = CONFIG.BASE_URL
    this.cookies = {}
    this.defaultParams = {
      search_entrance: CONFIG.SEARCH_ENTRANCE,
      enter_method: CONFIG.ENTER_METHOD,
      innerWidth: CONFIG.INNER_WIDTH,
      innerHeight: CONFIG.INNER_HEIGHT,
      reloadNavStart: String(Date.now()),
      is_no_width_reload: "1",
      keyword: "",
    }
    // Cookie tracking untuk session
  }

  async initialize() {
    try {
      const response = await requestWithRetry(
        {
          method: "get",
          url: this.baseURL,
          headers: { "User-Agent": CONFIG.UA },
        },
        "initialize session"
      )
      return response.status === 200
    } catch {
      return false
    }
  }

  async search(query) {
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new Error("Query pencarian wajib diisi")
    }

    await this.initialize()

    const params = {
      ...this.defaultParams,
      keyword: query.trim(),
      reloadNavStart: String(Date.now()),
    }

    const response = await requestWithRetry(
      {
        method: "get",
        url: `${this.baseURL}s`,
        params,
        headers: { "User-Agent": CONFIG.UA },
      },
      "search douyin"
    )

    if (response.status !== 200) {
      throw new Error(`Gagal mengambil halaman pencarian: ${response.status}`)
    }

    const $ = cheerio.load(response.data)
    let scriptWithData = ""

    $("script").each((_, el) => {
      const text = $(el).html()
      if (text && text.includes("let data =") && text.includes('"business_data"')) {
        scriptWithData = text
      }
    })

    if (!scriptWithData) {
      throw new Error("Data tidak ditemukan di halaman")
    }

    const match = scriptWithData.match(/let\s+data\s*=\s*(\{[\s\S]+?\});/)
    if (!match) {
      throw new Error("Format data tidak dikenali")
    }

    const dataCode = `data = ${match[1]}`
    const sandbox = {}
    createContext(sandbox)
    runInContext(dataCode, sandbox)

    const awemeInfos =
      sandbox.data?.business_data
        ?.map((entry) => entry?.data?.aweme_info)
        .filter(Boolean) || []

    if (awemeInfos.length === 0) {
      throw new Error("Tidak ditemukan hasil pencarian")
    }

    const results = awemeInfos.slice(0, 10).map((video, index) => ({
      rank: index + 1,
      aweme_id: video.aweme_id,
      description: video.desc || "Tanpa deskripsi",
      author: {
        name: video.author?.nickname || "Unknown",
        unique_id: video.author?.unique_id || "",
        avatar: video.author?.avatar_thumb?.url_list?.[0] || null,
      },
      statistics: {
        likes: video.statistics?.digg_count || 0,
        comments: video.statistics?.comment_count || 0,
        shares: video.statistics?.share_count || 0,
        views: video.statistics?.play_count || 0,
      },
      duration: video.video?.duration || 0,
      cover: video.video?.cover?.url_list?.[0] || null,
      url: `https://www.douyin.com/video/${video.aweme_id}`,
      created_at: video.create_time
        ? new Date(video.create_time * 1000).toISOString()
        : null,
    }))

    return results
  }
}

export default {
  name: "Douyin Search",
  description: "Cari video di Douyin (TikTok China).",
  category: "Search",
  methods: ["GET"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian video Douyin",
      example: "makanan viral",
    },
  },

  features: {
    platform: "Douyin",
    region: "China",
  },

  async run(req, res) {
    try {
      const { query } = { ...req.query, ...req.body }

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        })
      }

      const douyin = new DouyinSearch()
      const results = await douyin.search(query.trim())

      res.json({
        status: true,
        result: {
          query: query.trim(),
          total: results.length,
          videos: results.map((v, i) => ({
            index: i + 1,
            aweme_id: v.aweme_id,
            description: v.description,
            author: v.author,
            statistics: v.statistics,
            duration: v.duration,
            cover: v.cover,
            url: v.url,
            created_at: v.created_at,
          })),
        },
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error("Douyin Search Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mencari video Douyin"

      if (
        err.message.includes("wajib diisi") ||
        err.message.includes("tidak ditemukan") ||
        err.message.includes("tidak dikenali")
      ) {
        statusCode = 400
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now(),
      })
    }
  },
}

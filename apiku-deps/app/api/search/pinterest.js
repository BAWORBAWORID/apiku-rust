import axios from "axios"
import { PROXY_MANAGER } from "../../src/app/index.js"

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
  'Accept-Language': 'en-US,en;q=0.9'
}

// Pinterest soft-blocks datacenter IPs (Aragon returns 200 + empty results).
// Route through the CORS worker proxies (prefix-style URL) like other endpoints do.
const WORKER_NAMES = ['caliph', 'rpoxy', 'prox', 'aged', 'wave', 'hill', 'icy', 'fazri', 'spring', 'sizable', 'jiashu', 'eu']

function getProxy() {
  const url = PROXY_MANAGER.getProxy(WORKER_NAMES)
  return url && /workers\.dev|1win\.eu\.org|\.my\.id\/|\/cors\//.test(url) ? url : null
}

async function getSession(proxyUrl) {
  const base = proxyUrl ? proxyUrl : ""
  const res = await axios.get(base + "https://id.pinterest.com/", { headers: HEADERS })
  const raw = res.headers['set-cookie'] || []
  const cookies = raw.map(c => c.split(";")[0]).join("; ")
  const csrf = raw.find(c => c.startsWith("csrftoken="))?.match(/csrftoken=([^;]+)/)?.[1] || ""
  return { cookies, csrf }
}

async function searchPinterest(query, options = {}, proxyUrl = null) {
  const { limit = 5, scope = "pins", bookmark = null } = options
  const session = await getSession(proxyUrl)
  const data = {
    options: {
      query,
      scope,
      page_size: limit,
      refine_search_with_filters: true,
      ...(bookmark ? { bookmarks: [bookmark] } : {})
    },
    context: {}
  }
  const sourceUrl = `/search/${scope}/?q=${encodeURIComponent(query)}`
  const base = proxyUrl ? proxyUrl : ""
  const url = base + `https://id.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(data))}&_=${Date.now()}`

  const res = await axios.get(url, {
    headers: {
      accept: "application/json, text/javascript, */*, q=0.01",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": HEADERS['User-Agent'],
      referer: base + `https://id.pinterest.com${sourceUrl}`,
      "x-requested-with": "XMLHttpRequest",
      "x-app-version": "6d51d5a",
      "x-pinterest-appstate": "active",
      "x-pinterest-pws-handler": "www/search/[scope].js",
      "x-pinterest-source-url": sourceUrl,
      ...(session.csrf ? { "x-csrftoken": session.csrf } : {}),
      ...(session.cookies ? { cookie: session.cookies } : {})
    }
  })

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}`)
  }

  const json = res.data
  const payload = json?.resource_response?.data
  if (!payload) {
    throw new Error("no data")
  }

  const arr = Array.isArray(payload) ? payload : payload.results || []
  const mapPin = pin => ({
    title: pin.title || pin.grid_title || "",
    image: pin.images?.orig?.url || pin.images?.["736x"]?.url || null,
    video: pin.videos?.video_list?.V_HLSV4?.url || pin.videos?.video_list?.V_EXP7?.url || pin.videos?.video_list?.V_720P?.url || null,
    username: pin.pinner?.username || null,
    fullName: pin.pinner?.full_name || null,
    pinUrl: `https://id.pinterest.com/pin/${pin.id}/`
  })

  return {
    query,
    count: arr.length,
    bookmark: payload.bookmark || null,
    results: arr.filter(x => x?.id).map(mapPin),
    viaProxy: !!proxyUrl
  }
}

export default {
  name: "Search Pinterest",
  description: "Cari gambar/video dari Pinterest.",
  category: "Search",
  methods: ["GET"],
  params: ["query", "limit"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian"
    },
    limit: {
      type: "number",
      required: false,
      default: 5,
      description: "Jumlah hasil (default: 5)"
    }
  },

  features: {
    platform: "Pinterest",
    region: "Global",
    author: "Rafli",
    base: "https://id.pinterest.com"
  },

  async run(req, res) {
    try {
      const { query, limit } = req.query || {}

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        })
      }

      // Try proxies in rotation; Pinterest soft-blocks direct datacenter IPs.
      let lastError = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const proxyUrl = getProxy()
        try {
          const result = await searchPinterest(query.trim(), { limit: parseInt(limit) || 5 }, proxyUrl)

          if (result.count > 0) {
            return res.json({
              status: true,
              result: {
                query: result.query,
                total: result.count,
                bookmark: result.bookmark,
                via_proxy: result.viaProxy,
                items: result.results.map((item, i) => ({
                  index: i + 1,
                  title: item.title,
                  image: item.image,
                  video: item.video,
                  username: item.username,
                  fullName: item.fullName,
                  pinUrl: item.pinUrl
                }))
              },
              timestamp: Date.now(),
            })
          }
          lastError = new Error("empty")
        } catch (err) {
          lastError = err
        }
      }

      // All proxies returned empty/failed — Pinterest IP soft-block.
      if (lastError?.message === "empty") {
        return res.status(404).json({
          status: false,
          message: "Pinterest memblokir IP ini (soft-block datacenter). Coba lagi nanti.",
          timestamp: Date.now()
        })
      }
      throw lastError

    } catch (err) {
      console.error("Pinterest Search Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mencari data"

      if (err.message.includes("no data")) {
        statusCode = 404
        errorMessage = "Data tidak ditemukan"
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      })
    }
  },
}
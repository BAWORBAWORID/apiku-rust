import axios from "axios"

const HEADERS = {
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest"
}

async function nowSecureSearch(query, platform = "android") {
  const config = {
    baseUrl: "https://www.nowsecure.com/wp-admin/admin-ajax.php",
    headers: HEADERS
  }

  try {
    const response = await axios.get(config.baseUrl, {
      params: {
        action: "live_search",
        query: query,
        platform: platform
      },
      headers: config.headers
    })

    // Handle response format - NowSecure may return string or array
    let results = []

    if (Array.isArray(response.data)) {
      // Full array response with all data
      results = response.data.map(app => ({
        title: app.title,
        developer: app.developer,
        link: app.link,
        logo: app.logo,
        hasImage: app.image !== false
      }))
    } else if (typeof response.data === 'string' && response.data.trim()) {
      // Single string response - treat as title only
      results = [{
        title: response.data.trim(),
        developer: "Unknown",
        link: "#",
        logo: null,
        hasImage: false
      }]
    }

    if (results.length === 0) {
      return {
        status: false,
        error: "No apps found for query: " + query
      }
    }

    return {
      status: true,
      query: query,
      platform: platform,
      total: results.length,
      results: results
    }

  } catch (e) {
    return {
      status: false,
      error: e.message
    }
  }
}

export default {
  name: "NowSecure Search",
  description: "Cari aplikasi Android di NowSecure.",
  category: "Search",
  methods: ["GET"],
  params: ["query", "platform"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Nama aplikasi yang dicari"
    },
    platform: {
      type: "string",
      required: false,
      default: "android",
      enum: ["android", "ios"],
      description: "Platform (android/ios)"
    }
  },

  features: {
    platform: "NowSecure",
    region: "Global",
    author: "dann",
    base: "https://www.nowsecure.com"
  },

  async run(req, res) {
    try {
      const { query, platform } = req.query || {}

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        })
      }

      const result = await nowSecureSearch(query.trim(), platform || "android")

      if (!result.status) {
        return res.status(404).json({
          status: false,
          message: result.error,
          timestamp: Date.now(),
        })
      }

      res.json({
        status: true,
        result: {
          query: result.query,
          platform: result.platform,
          total: result.total,
          items: result.results.map((item, i) => ({
            index: i + 1,
            title: item.title,
            developer: item.developer,
            link: item.link,
            logo: item.logo,
            hasImage: item.hasImage
          }))
        },
        timestamp: Date.now(),
      })

    } catch (err) {
      console.error("NowSecure Search Error:", err.message)

      res.status(500).json({
        status: false,
        message: err.message || "Gagal mencari data",
        timestamp: Date.now()
      })
    }
  },
}

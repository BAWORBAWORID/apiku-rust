import axios from "axios"
import * as cheerio from "cheerio"

async function searchSoundCloud(query) {
  const url = `https://m.soundcloud.com/search?q=${encodeURIComponent(query)}`
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
  const $ = cheerio.load(data)
  const results = []

  $('.List_VerticalList__2uQYU li').each((index, element) => {
    const title = $(element).find('.Cell_CellLink__3yLVS').attr('aria-label')
    const musicUrl = $(element).find('.Cell_CellLink__3yLVS').attr('href')
    if (title && musicUrl) {
      results.push({
        title,
        url: musicUrl.startsWith('http') ? musicUrl : `https://m.soundcloud.com${musicUrl}`
      })
    }
  })

  if (results.length === 0) {
    throw new Error(`Lagu "${query}" tidak ditemukan.`)
  }

  return results.slice(0, 10)
}

export default {
  name: "SoundCloud Search",
  description: "Cari lagu di SoundCloud.",
  category: "Search",
  methods: ["GET"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian lagu"
    }
  },

  features: {
    platform: "SoundCloud",
    region: "Global"
  },

  async run(req, res) {
    try {
      const { query } = req.query || {}

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        })
      }

      const result = await searchSoundCloud(query.trim())

      res.json({
        status: true,
        result: {
          total: result.length,
          tracks: result.map((t, i) => ({
            index: i + 1,
            title: t.title,
            url: t.url
          }))
        },
        timestamp: Date.now(),
      })

    } catch (err) {
      console.error("SoundCloud Search Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mencari lagu"

      if (err.message.includes("tidak ditemukan")) {
        statusCode = 404
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      })
    }
  },
}

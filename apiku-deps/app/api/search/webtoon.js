import axios from "axios"
import * as cheerio from "cheerio"

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.webtoons.com'
}

async function searchWebtoon(query) {
  let { data } = await axios.get(`https://www.webtoons.com/id/search?keyword=${encodeURIComponent(query)}`, { headers: HEADERS })
  let $ = cheerio.load(data)
  let link = $('.card_lst li a, .webtoon_list li a, .search_result li a').first().attr('href')

  if (!link) throw new Error(`Komik "${query}" tidak ditemukan.`)
  let detailUrl = link.startsWith('http') ? link : `https://www.webtoons.com${link}`

  let { data: detailData } = await axios.get(detailUrl, { headers: HEADERS })
  let $$ = cheerio.load(detailData)

  let episodes = $$('#_episodeList li, .detail_lst li').map((i, el) => ({
    index: i + 1,
    title: $$(el).find('.subj span, .subj').first().text().trim() || `Episode ${i + 1}`,
    url: $$(el).find('a').attr('href').startsWith('http') ? $$(el).find('a').attr('href') : `https://www.webtoons.com${$$(el).find('a').attr('href')}`
  })).get().reverse()

  return {
    title: $$('.info .subj').first().text().trim() || $$('meta[property="og:title"]').attr('content').split('|')[0].trim(),
    author: $$('.info .author').first().text().trim() || 'Unknown',
    synopsis: $$('.summary').first().text().trim() || $$('meta[property="og:description"]').attr('content'),
    link: detailUrl,
    episodes: episodes
  }
}

export default {
  name: "Webtoon Search",
  description: "Cari informasi komik Webtoon berdasarkan judul.",
  category: "Search",
  methods: ["GET"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Judul komik Webtoon"
    }
  },

  features: {
    platform: "Webtoon",
    region: "Indonesia"
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

      const result = await searchWebtoon(query.trim())

      res.json({
        status: true,
        result: {
          title: result.title,
          author: result.author,
          synopsis: result.synopsis?.substring(0, 500),
          link: result.link,
          total_episodes: result.episodes.length,
          episodes: result.episodes.map(e => ({ index: e.index, title: e.title }))
        },
        timestamp: Date.now(),
      })

    } catch (err) {
      console.error("Webtoon Search Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mencari Webtoon"

      if (err.message.includes('tidak ditemukan')) {
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

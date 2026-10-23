import axios from "axios"
import * as cheerio from "cheerio"

const BASE_URL = "https://www.manhwaindo.my"

const BROWSER_UA = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    timeout: 15000,
    maxRedirects: 5,
  })
  return res.data
}

function extractData(html) {
  const $ = cheerio.load(html)
  const result = {}

  result.title = $('h1.entry-title[itemprop="name"]').first().text().trim() || "Tidak ditemukan"
  result.alternative = $("span.alternative").first().text().trim() || "Tidak ditemukan"

  const infoText = $(".info-content, .infox, .spe").text() || ""
  const statusMatch = infoText.match(/Status\s*([^\n]+)/i)
  result.status = statusMatch ? statusMatch[1].trim() : "Tidak ditemukan"

  result.type = $('a[rel="tag"][href*="genres"]').first().text().trim() || $(".infox a").first().text().trim() || "Tidak ditemukan"

  result.author = $('i[itemprop="name"]').first().text().trim() || "Tidak ditemukan"

  const postedEl = $("time")
  if (postedEl.length > 0) {
    result.posted_on = postedEl.first().text().trim() || "Tidak ditemukan"
    result.updated_on = postedEl.length > 1 ? postedEl.last().text().trim() : "Tidak ditemukan"
  } else {
    result.posted_on = "Tidak ditemukan"
    result.updated_on = "Tidak ditemukan"
  }

  const ratingEl = $('div[itemprop="ratingValue"], .num[content]').first()
  result.rating = ratingEl.attr("content") || ratingEl.text().trim() || "Tidak ditemukan"

  const genres = []
  $('span.mgen a[rel="tag"]').each((i, el) => {
    const g = $(el).text().trim()
    if (g) genres.push(g)
  })
  result.genres = genres.length ? genres : $(".genres a, .genre a").map((i, el) => $(el).text().trim()).get()

  const synopsisEl = $('div.entry-content-single[itemprop="description"], div.entry-content').first()
  result.synopsis = synopsisEl.text().replace(/\s+/g, " ").trim() || "Tidak ditemukan"

  const thumbnailEl = $('img[post-id], .thumb img, .series-thumb img, img[itemprop="image"]').first()
  result.thumbnail = thumbnailEl.attr("src") || "Tidak ditemukan"

  return result
}

export default {
  name: "Manhwaindo Detail",
  description: "Scrape detail info manhwa — title, alternative, status, type, author, rating, genres, synopsis, thumbnail",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query"],
  paramsSchema: {
    query: {
      type: "string",
      required: true,
      default: "i-became-a-humans-daughter",
      description: "Judul manhwa atau slug URL"
    }
  },

  async run(req, res) {
    try {
      const { query } = { ...req.query, ...req.body }

      if (!query) {
        return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" })
      }

      const slug = query.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()
      const url = `${BASE_URL}/series/${slug}/`

      const html = await fetchHtml(url)
      const data = extractData(html)

      return res.json({
        status: true,
        result: {
          ...data,
          url,
        }
      })
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message.includes("404") ? "Manhwa tidak ditemukan" : err.message,
      })
    }
  }
}

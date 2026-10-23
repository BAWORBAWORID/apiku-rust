import axios from "axios"
import * as cheerio from "cheerio"

const BASE_URL = "https://ipa.pelajaran.co.id"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

async function searchIPA(query, page = 1) {
  const url = `${BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`
  const { data } = await axios.get(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    timeout: 15000,
  })

  const $ = cheerio.load(data)
  const results = []

  $("article.post").each((_, el) => {
    const title = $(el).find(".entry-title a").text().trim()
    const link = $(el).find(".entry-title a").attr("href") || ""
    const slug = link.split("/").filter(Boolean).pop() || ""
    const thumbnail = $(el).find(".content-thumbnail img").attr("src") || ""
    const excerpt = $(el).find(".entry-content p").text().trim().replace(/\[selengkapnya\]$/, "").trim()
    const author = $(el).find(".entry-author .fn").text().trim()
    const date = $(el).find(".posted-on time").attr("datetime") || ""

    if (title) {
      results.push({ title, slug, url: link, thumbnail, excerpt, author, date })
    }
  })

  let totalPages = 1
  const pageNumbers = []
  $(".page-numbers a.page-numbers, .page-numbers span.page-numbers.current").each((_, el) => {
    const text = $(el).text().trim()
    if (text && !isNaN(text) && text !== "...") {
      pageNumbers.push(parseInt(text))
    }
  })
  if (pageNumbers.length > 0) {
    totalPages = Math.max(...pageNumbers)
  }

  return {
    query,
    current_page: page,
    total_pages: totalPages,
    total_results: results.length,
    has_next_page: page < totalPages,
    has_prev_page: page > 1,
    results,
  }
}

async function getDetailIPA(slug) {
  const url = `${BASE_URL}/${slug}/`
  const { data } = await axios.get(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    timeout: 15000,
  })

  const $ = cheerio.load(data)
  const title = $(".entry-title").text().trim()
  const content = $(".entry-content").text().trim()
  const thumbnail = $(".content-thumbnail img").attr("src") || ""
  const author = $(".entry-author .fn").text().trim()
  const date = $(".posted-on time").attr("datetime") || ""

  return {
    title,
    slug,
    url,
    thumbnail,
    content: content.substring(0, 1000) + (content.length > 1000 ? "..." : ""),
    author,
    date,
  }
}

export default {
  name: "IPA Pelajaran Search",
  description: "Cari materi pelajaran IPA. Mendukung pencarian dengan pagination dan detail artikel.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "page", "slug"],

  paramsSchema: {
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian materi IPA (tidak wajib jika menggunakan slug)",
      example: "CO2",
      minLength: 1,
      maxLength: 200,
    },
    page: {
      type: "number",
      required: false,
      description: "Nomor halaman hasil pencarian (default: 1)",
      example: 1,
      default: 1,
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug artikel untuk mengambil detail konten (jika diisi, query dan page diabaikan)",
      example: "pengertian-co2",
    },
  },

  async run(req, res) {
    try {
      const { query, page, slug } = { ...req.query, ...req.body }

      // Jika slug diberikan, ambil detail artikel
      if (slug && typeof slug === "string" && slug.trim()) {
        const detail = await getDetailIPA(slug.trim())
        return res.json({
          status: true,
          result: detail,
        })
      }

      // Jika tidak ada query, error
      if (!query || typeof query !== "string" || !query.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' atau 'slug' wajib diisi",
        })
      }

      const pageNum = parseInt(page) || 1
      const result = await searchIPA(query.trim(), pageNum)

      if (result.total_results === 0) {
        return res.status(404).json({
          status: false,
          message: `Materi "${query}" tidak ditemukan`,
        })
      }

      return res.json({
        status: true,
        result,
      })
    } catch (err) {
      console.error("IPA Pelajaran Error:", err.message)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mencari materi IPA",
      })
    }
  },
}

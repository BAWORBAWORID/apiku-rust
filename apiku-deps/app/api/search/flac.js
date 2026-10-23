/**
 * FlacDownloader Search Endpoint
 * Cari track musik di flacdownloader.com
 * Method: POST
 * Parameter: q (required)
 */

import axios from "axios"
import * as cheerio from "cheerio"

const BASE_URL = "https://flacdownloader.com"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export default {
  name: "FlacDownloader Search",
  description: "Cari track musik berdasarkan judul atau artis",
  category: "Search",
  methods: ["POST"],
  params: ["q"],
  paramsSchema: {
    q: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian judul atau artis",
      example: "Imagine Dragons Believer"
    }
  },
  async run(req, res) {
    try {
      const { q } = { ...req.query, ...req.body }

      if (!q || typeof q !== "string" || q.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'q' wajib diisi",
          timestamp: Date.now()
        })
      }

      const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(q.trim())}`

      const { data: html, status } = await axios.get(searchUrl, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/\*;q=0.8",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          "Referer": BASE_URL + "/en",
          "Origin": BASE_URL + "/en"
        },
        timeout: 30000
      })

      const $ = cheerio.load(html)

      const tracks = []

      // Extract tracks from the page - adapted from the CLI script logic
      $(".trending-list li, .trending li, .popular li, [class*='trending'] li, [class*='popular'] li").each((i, el) => {
        const linkEl = $(el).find("a")
        const title = linkEl.text().trim() || $(el).text().trim() || null
        const link = linkEl.attr("href") || null

        if (title && link && title.length > 3) {
          const fullLink = link.startsWith("http") ? link : BASE_URL + link
          tracks.push({
            title: title.replace(/<[^>]+>/g, "").trim(),
            link: fullLink
          })
        }
      })

      // Fallback: cari link /berita/ /news/ jika tidak ada trending list
      if (tracks.length === 0) {
        $("a[href*='/berita/'], a[href*='/news/']").each((i, el) => {
          const href = $(el).attr("href")
          const text = $(el).text().trim()

          if (href && text && text.length > 10) {
            const fullLink = href.startsWith("http") ? href : BASE_URL + href
            tracks.push({
              title: text.replace(/<[^>]+>/g, "").trim(),
              link: fullLink
            })
          }
        })
      }

      // Remove duplicates based on link
      const seen = new Set()
      const unique = tracks.filter(t => {
        if (seen.has(t.link)) return false
        seen.add(t.link)
        return true
      })

      // Limit to 20 results
      const results = unique.slice(0, 20)

      res.json({
        status: true,
        timestamp: Date.now(),
        data: {
          source: BASE_URL,
          query: q.trim(),
          total: results.length,
          tracks: results
        }
      })
    } catch (err) {
      console.error("[FlacDownloader Search Error]", err.message)
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mencari track di FlacDownloader",
        timestamp: Date.now()
      })
    }
  }
}
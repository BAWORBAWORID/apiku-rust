/**
 * CineSubz — subtitle/stream scraper
 * Provider: cinesubz.net
 * Parameter: q (search) | url (detail), action (dl)
 * NO API KEY
 */

import axios from "axios"

const CFG = {
  base: "https://cinesubz.net",
  ua: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
}

const _dec = s => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&")

async function getHtml(url) {
  const { data } = await axios.get(url, { headers: { "User-Agent": CFG.ua }, timeout: 30000, maxRedirects: 5 })
  return data
}

async function search(q) {
  const html = await getHtml(CFG.base + "/?s=" + encodeURIComponent(q))
  return [...html.matchAll(/<div id="item-\d+" class="display-item">[\s\S]*?<a href="([^"]+)" data-url="[^"]+" data-ptype="([^"]+)" title="[^"]+">[\s\S]*?<img[^>]*data-original="([^"]+)"[\s\S]*?imdb-score">([^<]+)<[\s\S]*?badge-(?:quality|episode|season)-corner">([^<]+)<[\s\S]*?<h3>([^<]+)<\/h3>/g)].map(m => ({
    title: _dec(m[6]),
    url: m[1],
    type: m[2],
    poster: m[3],
    imdb: m[4].trim(),
    badge: m[5].trim()
  }))
}

async function detail(url) {
  const html = await getHtml(url)
  return {
    title: (html.match(/<title>([^<]+)<\/title>/) || [])[1]?.replace(/ \| සිංහල.*$/, "") || "",
    downloads: [...html.matchAll(/href='([^']+)'[^>]*class='(?:movie-)?download-button'[^>]*>[\s\S]*?(?:movie-)?download-meta'>([^<]+)</gs)].map(m => ({
      api: m[1],
      meta: m[2].trim()
    })),
    episodes: [...html.matchAll(/class='episode-link' href='([^']+)' data-pid='\d+' data-season='(\d+)' data-episode='(\d+)'>[\s\S]*?ep-title'>([^<]+)<[\s\S]*?ep-date'>([^<]+)</gs)].map(m => ({
      url: m[1],
      season: +m[2],
      episode: +m[3],
      title: _dec(m[4]),
      date: m[5]
    }))
  }
}

async function dl(url) {
  const html = await getHtml(url)
  const link = (html.match(/href="(https?:\/\/[^"]*\/server\d+\/[^"]+)"/) || [])[1]
  if (!link) throw new Error("direct link not found")
  return link
}

export default {
  name: "CineSubz",
  description: "Scraper subtitle Sinhaloa — search film/series, detail episode, dan ambil link download langsung. Tanpa API key.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["q", "url", "action"],
  paramsSchema: {
    q: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (mengembalikan hasil search). Wajib jika url tidak diisi.",
      example: "silo"
    },
    url: {
      type: "string",
      required: false,
      description: "URL item/episode cinesubz.net (mengembalikan detail + episode). Wajib jika q tidak diisi.",
      example: "https://cinesubz.net/tvshows/silo-2023-tv-series-sinhala-sub/"
    },
    action: {
      type: "string",
      required: false,
      description: "dengan url: 'dl' = ambil link download langsung (default: detail)",
      default: "detail"
    }
  },

  async run(req, res) {
    const { q, url, action } = { ...req.query, ...req.body }

    try {
      if (q && typeof q === "string" && q.trim()) {
        const found = await search(q.trim())
        return res.json({ status: true, result: { type: "search", query: q.trim(), total: found.length, items: found } })
      }

      if (url && typeof url === "string" && url.trim()) {
        if (String(action).toLowerCase() === "dl") {
          let info = null
          try {
            info = await detail(url)
          } catch {}
          const apiUrl = (info && info.downloads[0]?.api)
            || (info && info.episodes[0] && (await detail(info.episodes[0].url)).downloads[0]?.api)
          if (!apiUrl) throw new Error("download tidak ditemukan")
          const direct = await dl(apiUrl)
          return res.json({ status: true, result: { type: "download", direct } })
        }
        const info = await detail(url)
        return res.json({ status: true, result: { type: "detail", ...info } })
      }

      return res.status(400).json({ status: false, message: "Isi parameter 'q' (search) atau 'url' (detail/download)" })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || String(err) })
    }
  }
}
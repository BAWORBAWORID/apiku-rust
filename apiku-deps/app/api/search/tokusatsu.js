import axios from "axios"
import * as cheerio from "cheerio"

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Referer": "https://www.tokusatsuindo.com/",
}

async function fetchHtml(url) {
  const res = await axios.get(url, { headers: HTTP_HEADERS, timeout: 10000 })
  return res.data
}

async function scrapeHome() {
  const html = await fetchHtml("https://www.tokusatsuindo.com/")
  const $ = cheerio.load(html)

  const slider = []
  $(".gmr-slider-content").each((i, el) => {
    const title = $(el).find(".gmr-slide-titlelink").text().trim()
    const link = $(el).find(".gmr-slide-titlelink").attr("href")
    const imgEl = $(el).find(".other-content-thumbnail img")
    const image = imgEl.attr("data-src") || imgEl.attr("src") || ""
    if (title && link) slider.push({ title, link, image })
  })

  const movieSpecial = []
  const movieHeader = $('h3:contains("movie &")')
  if (movieHeader.length > 0) {
    const contentRow = movieHeader.closest(".row").next(".row.grid-container.gmr-module-posts")
    contentRow.find(".gmr-item-modulepost").each((i, el) => {
      const linkEl = $(el).find("a").first()
      const title = linkEl.attr("title")?.replace("Permalink to: ", "") || $(el).find(".entry-title a").text().trim()
      const link = linkEl.attr("href")
      const imgEl = $(el).find("img")
      const image = imgEl.attr("data-src") || imgEl.attr("src") || ""
      if (link) movieSpecial.push({ title, link, image })
    })
  }

  const tokusatsuUpdate = []
  $("article.item-infinite").each((i, el) => {
    const title = $(el).find("h2.entry-title a").text().trim()
    const link = $(el).find("h2.entry-title a").attr("href")
    const imgEl = $(el).find(".content-thumbnail img")
    const image = imgEl.attr("src") || imgEl.attr("data-src") || ""
    const categories = []
    $(el).find(".gmr-movie-on a").each((j, catEl) => {
      categories.push($(catEl).text().trim())
    })
    if (title && link) tokusatsuUpdate.push({ title, link, image, categories })
  })

  const mostView = []
  $(".idmuvi-rp-widget li").each((i, el) => {
    const linkEl = $(el).find("a").first()
    const title = linkEl.attr("title")?.trim().replace("Permalink to: ", "") || linkEl.text().trim()
    const link = linkEl.attr("href")
    const imgEl = $(el).find("img")
    const image = imgEl.attr("src") || imgEl.attr("data-src") || ""
    if (link) mostView.push({ title, link, image })
  })

  return { slider, movieSpecial, tokusatsuUpdate, mostView }
}

async function scrapeMovies(page = 1) {
  const url =
    page > 1
      ? `https://www.tokusatsuindo.com/movie/page/${page}/`
      : "https://www.tokusatsuindo.com/movie/"
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)

  const movies = []
  $("article.item-infinite").each((i, el) => {
    const title = $(el).find("h2.entry-title a").text().trim()
    const link = $(el).find("h2.entry-title a").attr("href")
    const imgEl = $(el).find(".content-thumbnail img")
    const image = imgEl.attr("src") || imgEl.attr("data-src") || ""
    const categories = []
    $(el).find(".gmr-movie-on a").each((j, catEl) => {
      categories.push($(catEl).text().trim())
    })
    if (title && link) movies.push({ title, link, image, categories })
  })

  let maxPage = 1
  $(".pagination .page-numbers").each((i, el) => {
    const num = parseInt($(el).text().trim())
    if (!isNaN(num) && num > maxPage) maxPage = num
  })

  return { movies, currentPage: page, maxPage }
}

async function scrapeMovieSpecial() {
  const html = await fetchHtml("https://www.tokusatsuindo.com/movie-special/")
  const $ = cheerio.load(html)

  const categories = { kamenRider: [], superSentai: [], ultraman: [], other: [] }
  const keys = ["kamenRider", "superSentai", "ultraman", "other"]

  $(".pt-cv-wrapper").each((i, el) => {
    if (i < keys.length) {
      const key = keys[i]
      $(el).find(".pt-cv-content-item").each((j, itemEl) => {
        const title = $(itemEl).find(".pt-cv-title a").text().trim()
        const link = $(itemEl).find(".pt-cv-title a").attr("href")
        const imgEl = $(itemEl).find("img.pt-cv-thumbnail")
        const image = imgEl.attr("src") || imgEl.attr("data-src") || ""
        if (title && link) categories[key].push({ title, link, image })
      })
    }
  })

  return categories
}

async function scrapeEraCategory(slug) {
  const html = await fetchHtml(`https://www.tokusatsuindo.com/${slug}/`)
  const $ = cheerio.load(html)

  const eras = { reiwa: [], heisei: [], showa: [] }
  $("h1").each((i, el) => {
    const headingText = $(el).text().trim().toLowerCase()
    let key = null
    if (headingText.includes("reiwa")) key = "reiwa"
    else if (headingText.includes("heasei") || headingText.includes("heisei")) key = "heisei"
    else if (headingText.includes("showa")) key = "showa"
    if (key) {
      const nextUl = $(el).nextAll("ul").first()
      nextUl.find("li").each((j, liEl) => {
        const textLink = $(liEl).find("a").filter((idx, aEl) => $(aEl).text().trim().length > 0).first()
        const imgEl = $(liEl).find("img").first()
        const image = imgEl.attr("src") || imgEl.attr("data-src") || null
        if (textLink.length > 0) {
          eras[key].push({ title: textLink.text().trim(), link: textLink.attr("href"), image })
        }
      })
    }
  })

  return eras
}

async function scrapeOtherTokusatsu() {
  const html = await fetchHtml("https://www.tokusatsuindo.com/other-tokusatsu-upload/")
  const $ = cheerio.load(html)

  const shows = []
  $(".entry-content ul").first().find("li").each((i, el) => {
    const textLink = $(el).find("a").filter((idx, aEl) => $(aEl).text().trim().length > 0).first()
    const imgEl = $(el).find("img").first()
    const image = imgEl.attr("src") || imgEl.attr("data-src") || null
    if (textLink.length > 0) {
      shows.push({ title: textLink.text().trim(), link: textLink.attr("href"), image })
    }
  })

  return shows
}

async function scrapeSearch(query, page = 1) {
  const url =
    page > 1
      ? `https://www.tokusatsuindo.com/page/${page}/?s=${encodeURIComponent(query)}`
      : `https://www.tokusatsuindo.com/?s=${encodeURIComponent(query)}`
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)

  const results = []
  $("article.item-infinite").each((i, el) => {
    const title = $(el).find("h2.entry-title a").text().trim()
    const link = $(el).find("h2.entry-title a").attr("href")
    const imgEl = $(el).find(".content-thumbnail img")
    const image = imgEl.attr("src") || imgEl.attr("data-src") || ""
    const categories = []
    $(el).find(".gmr-movie-on a").each((j, catEl) => {
      categories.push($(catEl).text().trim())
    })
    if (title && link) results.push({ title, link, image, categories })
  })

  let maxPage = 1
  $(".pagination .page-numbers").each((i, el) => {
    const num = parseInt($(el).text().trim())
    if (!isNaN(num) && num > maxPage) maxPage = num
  })

  return { results, currentPage: page, maxPage }
}

async function scrapeDetail(targetUrl) {
  const html = await fetchHtml(targetUrl)
  const $ = cheerio.load(html)

  const title = $("h1.entry-title").text().trim() || $("h1").first().text().trim() || $("title").text().trim()
  const playerContainer = $("#muvipro_player_content_id")
  const isEpisode = playerContainer.length > 0

  if (isEpisode) {
    const postId = playerContainer.attr("data-id")
    const servers = []
    $("ul.muvipro-player-tabs > li > a").each((i, el) => {
      const name = $(el).text().trim()
      const href = $(el).attr("href")
      const tab = href ? href.replace("#", "") : `p${i + 1}`
      servers.push({ name, tab })
    })

    let prevUrl = null
    let nextUrl = null
    const prevEl = $(".wp-next-post-navi-pre a")
    if (prevEl.length > 0) prevUrl = prevEl.attr("href")
    const nextEl = $(".wp-next-post-navi-next a")
    if (nextEl.length > 0) nextUrl = nextEl.attr("href")

    let info = ""
    $(".entry-content p").each((i, el) => {
      const txt = $(el).text().trim()
      if (txt && $(el).find("img").length === 0) info += txt + "\n\n"
    })

    let activeStreamUrl = null
    if (servers.length > 0) {
      activeStreamUrl = await fetchStreamLink(postId, servers[0].tab, targetUrl)
    }

    return { type: "episode", title, postId, servers, activeStreamUrl, prevUrl, nextUrl, info: info.trim() }
  }

  const coverEl = $(".content-thumbnail img, .entry-content img").first()
  const cover = coverEl.attr("src") || coverEl.attr("data-src") || ""

  let synopsis = ""
  $(".entry-content p").each((i, el) => {
    const txt = $(el).text().trim()
    if (txt.length > 40 && $(el).find("img").length === 0 && !txt.includes("var ") && !txt.includes("CDATA")) {
      synopsis += txt + "\n\n"
    }
  })

  const episodes = []
  const lcpItems = $(".entry-content ul.lcp_catlist li a")
  if (lcpItems.length > 0) {
    lcpItems.each((i, el) => {
      episodes.push({ title: $(el).text().trim(), url: $(el).attr("href") })
    })
  } else {
    $(".entry-content a").each((i, el) => {
      const text = $(el).text().trim()
      const href = $(el).attr("href") || ""
      if (
        href &&
        !href.endsWith(".jpg") &&
        !href.endsWith(".png") &&
        !href.includes("/category/") &&
        !href.includes("/tag/")
      ) {
        if (text.toLowerCase().includes("episode") || text.toLowerCase().includes("eps") || /\d+/.test(text)) {
          episodes.push({ title: text, url: href })
        }
      }
    })
  }

  return {
    type: "series",
    title,
    cover,
    synopsis: synopsis.trim(),
    episodes: episodes.filter((v, i, a) => a.findIndex((t) => t.url === v.url) === i),
  }
}

async function fetchStreamLink(postId, tabName, refererUrl) {
  const postBody = `action=muvipro_player_content&tab=${tabName}&post_id=${postId}`
  const response = await axios.post("https://www.tokusatsuindo.com/wp-admin/admin-ajax.php", postBody, {
    headers: {
      ...HTTP_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": refererUrl || "https://www.tokusatsuindo.com/",
    },
  })
  const $ = cheerio.load(response.data)
  const iframe = $("iframe")
  if (iframe.length > 0) {
    return iframe.attr("src")
  }
  return null
}

export default {
  name: "Tokusatsu Search",
  description: "Cari dan lihat info konten Tokusatsu (Kamen Rider, Super Sentai, Ultraman). Action: home, movie, movie-special, kamen-rider, super-sentai, ultraman, other, search, detail",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "page"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["home", "movie", "movie-special", "kamen-rider", "super-sentai", "ultraman", "other", "search", "detail"],
      description: "Jenis data: home, movie, movie-special, kamen-rider, super-sentai, ultraman, other, search, detail",
      default: "home",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (dipakai jika action=search)",
      example: "kamen rider",
    },
    url: {
      type: "string",
      required: false,
      description: "URL detail konten (dipakai jika action=detail)",
      example: "https://www.tokusatsuindo.com/garo-taiga-sub-indonesia/",
    },
    page: {
      type: "number",
      required: false,
      description: "Nomor halaman (dipakai jika action=movie/search)",
      example: "1",
      default: "1",
    },
  },
  async run(req, res) {
    const { action, query, url, page } = { ...req.query, ...req.body }

    if (!action) {
      return res.json({ status: "error", message: "Parameter action wajib (home/movie/movie-special/kamen-rider/super-sentai/ultraman/other/search/detail)" })
    }

    try {
      let result
      switch (action) {
        case "home":
          result = await scrapeHome()
          break
        case "movie":
          result = await scrapeMovies(parseInt(page) || 1)
          break
        case "movie-special":
          result = await scrapeMovieSpecial()
          break
        case "kamen-rider":
          result = await scrapeEraCategory("kamen-rider-2")
          break
        case "super-sentai":
          result = await scrapeEraCategory("super-sentai2")
          break
        case "ultraman":
          result = await scrapeEraCategory("ultraman2")
          break
        case "other":
          result = await scrapeOtherTokusatsu()
          break
        case "search":
          if (!query) return res.json({ status: "error", message: "Parameter query wajib untuk action=search" })
          result = await scrapeSearch(query, parseInt(page) || 1)
          break
        case "detail":
          if (!url) return res.json({ status: "error", message: "Parameter url wajib untuk action=detail" })
          result = await scrapeDetail(url)
          break
        default:
          return res.json({ status: "error", message: `Action "${action}" tidak dikenal` })
      }

      res.json({ status: "success", action, result })
    } catch (err) {
      res.json({ status: "error", message: "Gagal melakukan scraping", details: err.message })
    }
  },
}

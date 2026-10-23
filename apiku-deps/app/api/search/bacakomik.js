import * as cheerio from "cheerio"
import logger from "../../src/utils/logger.js"

const BASE_URL = "https://bacakomik.my"
const ALLOWED_HOST = "bacakomik.my"

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id,en-US;q=0.7,en;q=0.3",
  Referer: `${BASE_URL}/`,
}

function formatResponse(action, data, error = null) {
  return {
    status: error ? "error" : "success",
    action,
    timestamp: new Date().toISOString(),
    data,
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS })
  if (!res.ok) {
    throw new Error(`Gagal memuat URL (Status ${res.status}: ${res.statusText})`)
  }
  return await res.text()
}

function normalizeUrl(url) {
  if (!url) return ""
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  if (url.startsWith("//")) return "https:" + url
  if (url.startsWith("/")) return BASE_URL + url
  return `${BASE_URL}/${url}`
}

function ensureAllowed(url) {
  let host
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return false
  }
  return host === ALLOWED_HOST || host.endsWith(`.${ALLOWED_HOST}`)
}

/* ================================
   CARD PARSER (.animposx)
================================ */
function parseMangaCards($) {
  const results = []
  $(".animposx").each((_, el) => {
    const item = $(el)
    const linkEl = item.find("a").first()
    const href = normalizeUrl(linkEl.attr("href") || "")
    const title = item.find(".tt h4").text().trim() || item.find(".tt").text().trim() || linkEl.attr("title") || ""

    let thumbnail = item.find("img").attr("data-lazy-src") || item.find("img").attr("src") || ""
    if (thumbnail.startsWith("data:")) {
      const onError = item.find("img").attr("onerror") || ""
      const m = onError.match(/this\.src='([^']+)'/i)
      if (m) thumbnail = m[1]
    }
    thumbnail = normalizeUrl(thumbnail)

    let type = ""
    const typeEl = item.find(".typeflag")
    if (typeEl.length > 0) {
      const pText = typeEl.parent().text().trim()
      const cls = typeEl.attr("class") || ""
      const match = cls.match(/typeflag\s+([A-Za-z]+)/i)
      type = (match ? match[1] : pText) || ""
    }
    if (!type) type = item.find(".type").text().trim() || "Manga"

    const isColor = item.find(".warnalabel, .fa-palette").length > 0 || item.text().includes("Warna")
    const isHot = item.find(".hot").length > 0

    let score =
      item.find(".fa-star").parent().text().replace(/[^0-9.]/g, "").trim() ||
      item.find(".rating i").text().trim() ||
      item.find(".score").text().trim()
    if (!score) score = "N/A"

    const views = item.find(".fa-eye").parent().text().replace(/\s+/g, " ").trim() || "N/A"

    const cardChapters = []
    item.find(".lsch").each((_, lschEl) => {
      const a = $(lschEl).find("a")
      const chTitle = a.text().replace(/\s+/g, " ").trim()
      const chUrl = normalizeUrl(a.attr("href") || "")
      const date = $(lschEl).find(".datech").text().trim()
      if (chTitle && chUrl) {
        cardChapters.push({ title: chTitle, url: chUrl, released: date || "N/A" })
      }
    })

    if (title && href) {
      results.push({
        title,
        url: href,
        thumbnail,
        type,
        color: isColor ? "Color" : "Black & White",
        isHot,
        score,
        views: views !== "N/A" ? views : undefined,
        latestChapter: cardChapters.length > 0 ? cardChapters[0] : null,
        recentChapters: cardChapters,
      })
    }
  })
  return results
}

async function enrichMangaListWithDetails(list, limit = 10) {
  const targetItems = list.slice(0, limit)
  await Promise.all(
    targetItems.map(async (item) => {
      try {
        const html = await fetchHtml(item.url)
        const $ = cheerio.load(html)

        const firstA = $(".lchx a").first()
        const lastA = $(".lchx a").last()
        const totalCh = $("#chapter_list li").length || $(".lchx a").length

        let status = ""
        let scoreDetail = $('[itemprop="ratingValue"]').first().text().trim()
        let author = ""

        $(".infox .spe span").each((_, el) => {
          const t = $(el).text().trim()
          if (t.toLowerCase().startsWith("status")) status = t.split(":")[1]?.trim() || ""
          if (t.toLowerCase().startsWith("author")) author = t.split(":")[1]?.trim() || ""
        })

        if (firstA.length > 0) {
          item.latestChapter = {
            title: firstA.text().replace(/\s+/g, " ").trim(),
            url: normalizeUrl(firstA.attr("href") || ""),
          }
        }
        if (lastA.length > 0) {
          item.firstChapter = {
            title: lastA.text().replace(/\s+/g, " ").trim(),
            url: normalizeUrl(lastA.attr("href") || ""),
          }
        }
        if (totalCh > 0) item.totalChapters = totalCh
        if (status) item.status = status
        if (author) item.author = author
        if (item.score === "N/A" && scoreDetail) item.score = scoreDetail
      } catch {
        // skip
      }
    })
  )
  return list
}

/* ================================
   DETAIL & CHAPTER
================================ */
async function getMangaDetail(inputUrl) {
  if (!ensureAllowed(inputUrl)) throw new Error("URL harus dari domain bacakomik.my")

  const targetUrl = normalizeUrl(inputUrl)
  let html = await fetchHtml(targetUrl)
  let $ = cheerio.load(html)

  let isChapterPage = false
  let chapterImagesList = []
  let parentMangaUrl = targetUrl

  if (!targetUrl.includes("/komik/") && (targetUrl.includes("-chapter-") || targetUrl.includes("/ch-") || targetUrl.match(/-chapter-\d+/i))) {
    isChapterPage = true

    $("img").each((_, el) => {
      let src = $(el).attr("data-lazy-src") || $(el).attr("src") || ""
      if (!src || src.startsWith("data:")) {
        const onError = $(el).attr("onerror") || ""
        const m = onError.match(/this\.src='([^']+)'/i)
        if (m) src = m[1]
      }
      if (src && !src.startsWith("data:") && !src.includes("wp-content/uploads")) {
        chapterImagesList.push(normalizeUrl(src))
      }
    })
    chapterImagesList = [...new Set(chapterImagesList)]

    const parentLink = $('a[href*="/komik/"]').first().attr("href")
    if (parentLink) {
      parentMangaUrl = normalizeUrl(parentLink)
      const parentHtml = await fetchHtml(parentMangaUrl)
      html = parentHtml
      $ = cheerio.load(parentHtml)
    }
  }

  const rawTitle = $(".entry-title").first().text() || $("h1").first().text()
  const title = rawTitle.replace(/^Komik\s+/i, "").replace(/\s+/g, " ").trim()

  let thumbnail =
    $(".thumb img").attr("data-lazy-src") || $(".thumb img").attr("src") || ""
  if (thumbnail.startsWith("data:")) {
    const onError = $(".thumb img").attr("onerror") || ""
    const m = onError.match(/this\.src='([^']+)'/i)
    if (m) thumbnail = m[1]
  }
  thumbnail = normalizeUrl(thumbnail)

  const synopsis = $(".desc, .sinopsis, .entry-content-single, .entry-content")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
  const score =
    $('[itemprop="ratingValue"]').first().text().trim() ||
    $(".rating strong").text().replace(/[^0-9.]/g, "").trim() ||
    $(".rating-prc").text().trim() ||
    "N/A"

  const info = {}
  $(".infox .spe span").each((_, el) => {
    const text = $(el).text().trim()
    if (text.includes(":")) {
      const parts = text.split(":")
      info[parts[0].trim()] = parts.slice(1).join(":").trim()
    }
  })

  const genres = []
  $(".genre-info a, .genres-container a, a[href*=\"/genres/\"]").each((_, el) => {
    const g = $(el).text().trim()
    if (g && !genres.includes(g)) genres.push(g)
  })

  const spoilers = []
  $('img[alt*="Spoiler"], img[title*="Spoiler"], .spoiler img').each((_, el) => {
    let src = $(el).attr("data-lazy-src") || $(el).attr("src") || ""
    if (src.startsWith("data:")) {
      const onError = $(el).attr("onerror") || ""
      const m = onError.match(/this\.src='([^']+)'/i)
      if (m) src = m[1]
    }
    if (src && !src.startsWith("data:") && !src.includes("wp-content/uploads")) {
      spoilers.push(normalizeUrl(src))
    }
  })

  const similarManga = []
  $(".mirip li, #mirip li, .similarmanga li").each((_, el) => {
    const simLink = $(el).find("a").first()
    const simTitle = $(el).find("h4").text().trim() || simLink.attr("title") || simLink.text().trim()
    const simUrl = normalizeUrl(simLink.attr("href") || "")
    let simThumb = $(el).find("img").attr("data-lazy-src") || $(el).find("img").attr("src") || ""
    if (simThumb.startsWith("data:")) {
      const onError = $(el).find("img").attr("onerror") || ""
      const m = onError.match(/this\.src='([^']+)'/i)
      if (m) simThumb = m[1]
    }
    if (simTitle && simUrl) {
      similarManga.push({
        title: simTitle,
        url: simUrl,
        thumbnail: normalizeUrl(simThumb),
      })
    }
  })

  const chapters = []
  $("#chapter_list li, .chapter-list li, ul.clstyle li").each((_, el) => {
    const item = $(el)
    const link = item.find(".lchx a, a").first()
    const chUrl = normalizeUrl(link.attr("href") || "")
    const chTitle = link.text().replace(/\s+/g, " ").trim()
    const date = item.find(".dt, .chapterdate").text().trim()

    if (chUrl && chTitle) {
      chapters.push({ title: chTitle, url: chUrl, released: date || "N/A" })
    }
  })

  if (chapters.length === 0) {
    $('a[href*="-chapter-"], a[href*="/ch-"]').each((_, el) => {
      const link = $(el)
      const chUrl = normalizeUrl(link.attr("href") || "")
      const chTitle = link.text().replace(/\s+/g, " ").trim()
      if (chUrl && chTitle && !chapters.some((c) => c.url === chUrl)) {
        chapters.push({ title: chTitle, url: chUrl, released: "N/A" })
      }
    })
  }

  const resultData = {
    title,
    url: parentMangaUrl,
    originalInputUrl: targetUrl !== parentMangaUrl ? targetUrl : undefined,
    thumbnail,
    score,
    status: info.Status || "Unknown",
    type: info["Jenis Komik"] || "Manga",
    author: info.Author || "N/A",
    artist: info.Artis || "N/A",
    releasedYear: info.Rilis || "N/A",
    serialization: info.Serialisasi || "N/A",
    readersCount: info["Jumlah Pembaca"] || "N/A",
    alternativeTitle: info["Judul Alternatif"] || "N/A",
    synopsis,
    genres,
    spoilers,
    similarManga,
    totalChapters: chapters.length,
    firstChapter: chapters.length > 0 ? chapters[chapters.length - 1] : null,
    latestChapter: chapters.length > 0 ? chapters[0] : null,
    chapters,
  }

  if (isChapterPage && chapterImagesList.length > 0) {
    resultData.chapterImages = {
      chapterUrl: targetUrl,
      totalImages: chapterImagesList.length,
      images: chapterImagesList,
    }
  }

  return formatResponse("detail", resultData)
}

async function getChapterImages(chapterUrl) {
  if (!ensureAllowed(chapterUrl)) throw new Error("URL harus dari domain bacakomik.my")

  const targetUrl = normalizeUrl(chapterUrl)
  const html = await fetchHtml(targetUrl)
  const $ = cheerio.load(html)

  const rawTitle = $(".entry-title, h1").first().text()
  const title = rawTitle.replace(/^Komik\s+/i, "").replace(/\s+/g, " ").trim()

  const mangaLink = normalizeUrl($(".allc a, a[href*=\"/komik/\"]").first().attr("href") || "")

  const images = []
  $("img").each((_, el) => {
    const img = $(el)
    let src = img.attr("data-lazy-src") || ""
    if (!src || src.startsWith("data:")) {
      const onError = img.attr("onerror") || ""
      const m = onError.match(/this\.src='([^']+)'/i)
      if (m) src = m[1]
    }
    if (!src || src.startsWith("data:")) {
      src = img.attr("src") || ""
    }

    if (
      src &&
      !src.startsWith("data:") &&
      !src.includes("wp-content/uploads") &&
      (src.includes("/data/") || img.parents("#anjay_ini_id_kh, #chimg-besarge, #readerarea").length > 0)
    ) {
      images.push(normalizeUrl(src))
    }
  })

  const uniqueImages = [...new Set(images)]

  let prevUrl = ""
  let nextUrl = ""

  $(".nextprev a, a[rel=\"prev\"], a[rel=\"next\"]").each((_, el) => {
    const txt = $(el).text().trim()
    const href = $(el).attr("href") || ""
    if (txt.includes("Sebelum") || $(el).attr("rel") === "prev") {
      if (!prevUrl) prevUrl = href
    }
    if (txt.includes("Selanjutnya") || $(el).attr("rel") === "next") {
      if (!nextUrl) nextUrl = href
    }
  })

  return formatResponse("chapter_images", {
    title,
    url: targetUrl,
    mangaUrl: mangaLink || null,
    totalImages: uniqueImages.length,
    images: uniqueImages,
    navigation: {
      hasPrev: Boolean(prevUrl),
      prev: prevUrl ? normalizeUrl(prevUrl) : null,
      hasNext: Boolean(nextUrl),
      next: nextUrl ? normalizeUrl(nextUrl) : null,
    },
  })
}

export default {
  name: "BacaKomik",
  description: "Scraper komik lengkap — search, update terbaru, populer, direktori, genre, detail komik + semua chapter, dan gambar reader chapter",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "page"],

  paramsSchema: {
    action: {
      type: "string",
      required: false,
      description: "Aksi yang dijalankan (default: search)",
      default: "search",
      enum: ["search", "latest", "popular", "directory", "genres", "genre", "detail", "chapter"]
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (action=search) atau slug genre (action=genre)",
      example: "solo leveling"
    },
    url: {
      type: "string",
      required: false,
      description: "URL komik untuk action=detail, URL chapter untuk action=chapter",
      example: "https://bacakomik.my/komik/solo-leveling/"
    },
    page: {
      type: "string",
      required: false,
      description: "Nomor halaman (action=search, latest, directory, genre)",
      default: "1"
    }
  },

  async run(req, res) {
    const { action = "search", query = "", url = "", page = 1 } = { ...req.query, ...req.body }
    const cmd = String(action).toLowerCase()
    const pageNum = Number(page) || 1

    try {
      logger.info(`[BACAKOMIK] action=${cmd} | q=${query || url}`)

      switch (cmd) {
        case "search": {
          if (!query || !query.trim()) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action=search" })
          }
          const html = await fetchHtml(`${BASE_URL}/page/${pageNum}/?s=${encodeURIComponent(query.trim().toLowerCase())}`)
          const $ = cheerio.load(html)
          let list = parseMangaCards($)
          list = await enrichMangaListWithDetails(list, 10)
          return res.json({ status: true, ...formatResponse("search", { query, page: pageNum, totalResults: list.length, results: list }) })
        }

        case "latest": {
          const html = await fetchHtml(`${BASE_URL}/komik-terbaru/page/${pageNum}/`)
          const $ = cheerio.load(html)
          let list = parseMangaCards($)
          list = await enrichMangaListWithDetails(list, 10)
          return res.json({ status: true, ...formatResponse("latest", { page: pageNum, totalResults: list.length, results: list }) })
        }

        case "popular": {
          const html = await fetchHtml(`${BASE_URL}/komik-populer/`)
          const $ = cheerio.load(html)
          let list = parseMangaCards($)
          list = await enrichMangaListWithDetails(list, list.length)
          return res.json({ status: true, ...formatResponse("popular", { totalResults: list.length, results: list }) })
        }

        case "directory": {
          const html = await fetchHtml(`${BASE_URL}/daftar-komik/page/${pageNum}/`)
          const $ = cheerio.load(html)
          let list = parseMangaCards($)
          list = await enrichMangaListWithDetails(list, 10)
          return res.json({ status: true, ...formatResponse("directory", { page: pageNum, totalResults: list.length, results: list }) })
        }

        case "genres": {
          const html = await fetchHtml(`${BASE_URL}/daftar-genre/`)
          const $ = cheerio.load(html)
          const genres = []
          $('a[href*="/genres/"]').each((_, el) => {
            const name = $(el).text().trim()
            const href = normalizeUrl($(el).attr("href") || "")
            const slugMatch = href.match(/\/genres\/([^/]+)/)
            const slug = slugMatch ? slugMatch[1] : ""
            if (name && href && !genres.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
              genres.push({ name, slug, url: href })
            }
          })
          return res.json({ status: true, ...formatResponse("genres", { totalGenres: genres.length, genres }) })
        }

        case "genre": {
          if (!query || !query.trim()) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi (slug genre) untuk action=genre" })
          }
          const html = await fetchHtml(`${BASE_URL}/genres/${encodeURIComponent(query.trim().toLowerCase())}/page/${pageNum}/`)
          const $ = cheerio.load(html)
          let list = parseMangaCards($)
          list = await enrichMangaListWithDetails(list, 10)
          return res.json({ status: true, ...formatResponse("genre_manga", { genre: query.trim(), page: pageNum, totalResults: list.length, results: list }) })
        }

        case "detail": {
          if (!url || !url.trim()) {
            return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi untuk action=detail" })
          }
          const out = await getMangaDetail(url.trim())
          return res.json({ status: true, ...out })
        }

        case "chapter": {
          if (!url || !url.trim()) {
            return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi untuk action=chapter" })
          }
          const out = await getChapterImages(url.trim())
          return res.json({ status: true, ...out })
        }

        default:
          return res.status(400).json({ status: false, message: `Action tidak dikenal: ${cmd}`, available: ["search", "latest", "popular", "directory", "genres", "genre", "detail", "chapter"] })
      }
    } catch (err) {
      logger.error(`[BACAKOMIK] error | action=${cmd} | ${err.message}`)
      return res.status(500).json({ status: false, message: err.message })
    }
  }
}
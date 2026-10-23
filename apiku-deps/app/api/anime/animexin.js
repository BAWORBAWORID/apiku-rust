import fs from 'fs'
import path from 'path'
import logger from '../../src/utils/logger.js'

const CACHE_FILE = path.join(process.cwd(), 'data', '.animexin_cache.json')
const BASE_URL = 'https://animexin.dev'
const FETCH_TIMEOUT_MS = 15000

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'id,en-US;q=0.9,en;q=0.8'
}

function cleanText(str) {
  if (!str) return ''
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-')
    .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&#8216;/g, "'").replace(/&#8217;/g, "'").replace(/&#8230;/g, '...')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function isValidAnimexinUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false
  try {
    const u = new URL(urlStr)
    return u.hostname === 'animexin.dev' || u.hostname.endsWith('.animexin.dev')
  } catch (e) { return false }
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      return Array.isArray(parsed) ? parsed : []
    }
  } catch (e) {}
  return []
}

function saveCache(newItems) {
  try {
    const existing = loadCache()
    const map = new Map()
    existing.forEach(item => { if (item?.url || item?.id) map.set(item.url || item.id, item) })
    newItems.forEach(item => { if (item?.url || item?.id) map.set(item.url || item.id, item) })
    const merged = Array.from(map.values()).slice(-500)
    const dir = path.dirname(CACHE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(merged, null, 2), 'utf-8')
  } catch (e) {}
}

async function fetchHtml(url, allow404Empty = false) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (res.status === 404 && allow404Empty) return ''
    if (!res.ok) throw new Error(`HTTP ${res.status} [${url}]`)
    return await res.text()
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new Error(`Timeout ${FETCH_TIMEOUT_MS / 1000}s [${url}]`)
    throw err
  }
}

function parseItems(htmlBlock) {
  if (!htmlBlock) return []
  const items = htmlBlock.match(/<div class="bsx"[^>]*>([\s\S]*?)<\/a>\s*<\/div>/g) || []
  const results = []
  const cache = loadCache()
  const existingIds = new Set(cache.map(c => c.id))

  items.forEach((itemHtml) => {
    const titleMatch = itemHtml.match(/title="([^"]+)"/) || itemHtml.match(/<h2 itemprop="headline">([^<]+)<\/h2>/)
    let title = titleMatch ? cleanText(titleMatch[1]) : 'Judul tidak ditemukan'
    const imgMatch = itemHtml.match(/<img[^>]+src="([^"]+)"/)
    const thumbnail = imgMatch ? imgMatch[1] : ''
    const urlMatch = itemHtml.match(/<a[^>]+href="([^"]+)"/)
    const url = urlMatch ? urlMatch[1] : ''
    const epMatch = itemHtml.match(/<span class="epx">([^<]+)<\/span>/) ||
                    itemHtml.match(/<div class="epx">([^<]+)<\/div>/) ||
                    itemHtml.match(/<div class="eggepisode">([^<]+)<\/div>/) ||
                    itemHtml.match(/Ep (\d+)/i)
    let episode = epMatch ? cleanText(epMatch[1]) : ''
    if (!episode) {
      const epFromTitle = title.match(/Episode\s+(\d+(?:\s+END)?)/i) || title.match(/Ep\s*(\d+)/i)
      episode = epFromTitle ? `Episode ${epFromTitle[1]}` : 'Series / TBA'
    }
    const typeMatch = itemHtml.match(/class="(?:eggtype|typez)\s+([^"]+)"/i) || itemHtml.match(/<div class="(?:eggtype|typez)[^>]*>([^<]+)<\/div>/i)
    const type = typeMatch ? cleanText(typeMatch[1]) : 'TBA'
    const subMatch = itemHtml.match(/class="sb\s+([^"]+)"/i) || itemHtml.match(/<span class="sb[^>]*>([^<]+)<\/span>/i)
    const subInfo = subMatch ? cleanText(subMatch[1]) : 'RAW'

    const cachedItem = cache.find(c => c.url === url)
    let id
    if (cachedItem?.id) {
      id = cachedItem.id
    } else {
      do { id = Math.floor(100 + Math.random() * 900) } while (existingIds.has(id))
      existingIds.add(id)
    }
    results.push({ id, judul: title, episode, thumbnail, url, type, subInfo })
  })

  if (results.length > 0) saveCache(results)
  return results
}

async function fetchListData(category = 'home', page = 1) {
  const pageNum = parseInt(page, 10) || 1
  const url = pageNum > 1 ? `${BASE_URL}/page/${pageNum}/` : `${BASE_URL}/`
  const html = await fetchHtml(url, pageNum > 1)
  if (!html) return { category, page: pageNum, hasNextPage: false, total: 0, data: [] }

  let htmlBlock = ''
  const popularIdx = html.indexOf('<h2>Popular Today</h2>')
  const latestIdx = html.indexOf('<h3>Latest Release</h3>')
  const recommendIdx = html.indexOf('<h3>Recommendation</h3>')
  const blogIdx = html.indexOf('<h3>Latest Blog</h3>')

  if (category === 'popular' && popularIdx !== -1 && latestIdx !== -1) {
    htmlBlock = html.substring(popularIdx, latestIdx)
  } else if (category === 'recommend' && recommendIdx !== -1 && blogIdx !== -1) {
    htmlBlock = html.substring(recommendIdx, blogIdx)
  } else {
    if (latestIdx !== -1 && recommendIdx !== -1) htmlBlock = html.substring(latestIdx, recommendIdx)
    else htmlBlock = html
  }

  const data = parseItems(htmlBlock)
  const hasNextPage = html.includes(`/page/${pageNum + 1}/`) || /class="r"[^>]*>Next/i.test(html)
  return { category, page: pageNum, hasNextPage, total: data.length, data }
}

async function fetchSearchData(keyword, page = 1) {
  if (!keyword || !String(keyword).trim()) throw new Error('Parameter keyword tidak boleh kosong')
  const cleanKw = String(keyword).trim()
  const pageNum = parseInt(page, 10) || 1
  const searchUrl = pageNum > 1 ? `${BASE_URL}/page/${pageNum}/?s=${encodeURIComponent(cleanKw)}` : `${BASE_URL}/?s=${encodeURIComponent(cleanKw)}`
  const html = await fetchHtml(searchUrl, pageNum > 1)
  if (!html) return { keyword: cleanKw, page: pageNum, hasNextPage: false, total: 0, data: [] }
  const data = parseItems(html)
  const hasNextPage = html.includes(`page/${pageNum + 1}/?s=`) || /class="r"[^>]*>Next/i.test(html)
  return { keyword: cleanKw, page: pageNum, hasNextPage, total: data.length, data }
}

async function fetchScheduleData() {
  const html = await fetchHtml(BASE_URL)
  const schedule = {}
  const dayBlocks = [...html.matchAll(/<div class="listSchh"[^>]*>[\s\S]*?<h2>([^<]+)<\/h2>[\s\S]*?<div class="subSchh">([\s\S]*?)<\/div>\s*<\/div>/gi)]
  dayBlocks.forEach(block => {
    const dayName = cleanText(block[1]).toLowerCase()
    const links = [...block[2].matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi)].map(m => ({
      title: cleanText(m[2]), url: m[1]
    }))
    schedule[dayName] = links
  })
  return { totalDays: Object.keys(schedule).length, data: schedule }
}

async function fetchGenresData() {
  const html = await fetchHtml(BASE_URL)
  const genreMatches = [...html.matchAll(/<a[^>]+href="https:\/\/animexin\.dev\/genres\/([^"\/]+)\/"[^>]*>([^<]+)<\/a>/gi)]
  const genreMap = new Map()
  genreMatches.forEach(m => {
    const slug = m[1].trim().toLowerCase()
    const name = cleanText(m[2])
    if (slug && name && !genreMap.has(slug)) genreMap.set(slug, { slug, name, url: `${BASE_URL}/genres/${slug}/` })
  })
  return { total: genreMap.size, data: Array.from(genreMap.values()) }
}

async function fetchGenreAnimeData(genreSlug, page = 1) {
  if (!genreSlug || !String(genreSlug).trim()) throw new Error('Slug genre tidak boleh kosong')
  const cleanSlug = String(genreSlug).toLowerCase().trim()
  const pageNum = parseInt(page, 10) || 1
  const url = pageNum > 1 ? `${BASE_URL}/genres/${cleanSlug}/page/${pageNum}/` : `${BASE_URL}/genres/${cleanSlug}/`
  const html = await fetchHtml(url, pageNum > 1)
  if (!html) return { genre: cleanSlug, page: pageNum, hasNextPage: false, total: 0, data: [] }
  const data = parseItems(html)
  const hasNextPage = html.includes(`/genres/${cleanSlug}/page/${pageNum + 1}/`) || /class="r"[^>]*>Next/i.test(html)
  return { genre: cleanSlug, page: pageNum, hasNextPage, total: data.length, data }
}

async function fetchDetailData(query) {
  if (!query || !String(query).trim()) throw new Error('Berikan ID, URL, atau Judul Anime!')
  const cleanQuery = String(query).trim()
  let targetUrl = '', targetJudul = '', resolvedId = null

  if (cleanQuery.startsWith('http://') || cleanQuery.startsWith('https://')) {
    if (!isValidAnimexinUrl(cleanQuery)) throw new Error('URL tidak valid. Hanya animexin.dev')
    targetUrl = cleanQuery
  } else if (!isNaN(cleanQuery)) {
    resolvedId = parseInt(cleanQuery, 10)
    const cache = loadCache()
    const selected = cache.find(item => item.id === resolvedId)
    if (selected) { targetUrl = selected.url; targetJudul = selected.judul }
    else throw new Error(`ID [${resolvedId}] tidak ditemukan di cache`)
  } else {
    const searchRes = await fetchSearchData(cleanQuery)
    if (searchRes.data.length === 0) throw new Error(`Anime "${cleanQuery}" tidak ditemukan`)
    targetUrl = searchRes.data[0].url
    targetJudul = searchRes.data[0].judul
    resolvedId = searchRes.data[0].id
  }

  let html = await fetchHtml(targetUrl)

  if (!html.includes('class="eplister"') && (html.includes('<option value=') || html.includes('<iframe'))) {
    const seriesLinkMatch = html.match(/<span itemprop="itemListElement"[^>]*>\s*<a itemprop="item" href="([^"]+)"><span itemprop="name">([^<]+)<\/span><\/a>\s*<meta itemprop="position" content="2">/i) ||
                            html.match(/<div class="nvsc">[\s\S]*?<a href="([^"]+)"/i)
    if (seriesLinkMatch) {
      try {
        const seriesUrl = seriesLinkMatch[1]
        if (isValidAnimexinUrl(seriesUrl)) {
          const seriesHtml = await fetchHtml(seriesUrl)
          if (seriesHtml.includes('class="eplister"')) { html = seriesHtml; targetUrl = seriesUrl }
        }
      } catch (e) {}
    }
  }

  const titleMatch = html.match(/<h1 class="entry-title"[^>]*>([^<]+)<\/h1>/)
  const title = titleMatch ? cleanText(titleMatch[1]) : targetJudul
  const altMatch = html.match(/<span class="alter">([^<]+)<\/span>/i)
  const alterJudul = altMatch ? cleanText(altMatch[1]) : ''
  const ratingMatch = html.match(/<meta itemprop="ratingValue" content="([^"]+)"/) || html.match(/<div class="num"[^>]*>([^<]+)<\/div>/)
  const rating = ratingMatch ? cleanText(ratingMatch[1]) : 'N/A'
  const statusMatch = html.match(/<b>Status:<\/b>\s*([^<]+)<\/span>/i)
  const status = statusMatch ? cleanText(statusMatch[1]) : 'N/A'
  const typeMatch = html.match(/<b>Type:<\/b>\s*([^<]+)<\/span>/i)
  const type = typeMatch ? cleanText(typeMatch[1]) : 'TBA'
  const totalEpMatch = html.match(/<b>Episodes:<\/b>\s*([^<]+)<\/span>/i)
  const totalEpisodes = totalEpMatch ? cleanText(totalEpMatch[1]) : 'TBA'
  const releasedMatch = html.match(/<b>Released:<\/b>\s*([^<]+)<\/span>/i)
  const released = releasedMatch ? cleanText(releasedMatch[1]) : 'N/A'
  const durationMatch = html.match(/<b>Duration:<\/b>\s*([^<]+)<\/span>/i)
  const duration = durationMatch ? cleanText(durationMatch[1]) : 'N/A'
  const studioMatch = html.match(/<b>Studio:<\/b>\s*<a[^>]*>([^<]+)<\/a>/i) || html.match(/<b>Studio:<\/b>\s*([^<]+)<\/span>/i)
  const studio = studioMatch ? cleanText(studioMatch[1]) : 'N/A'
  const genreMatch = html.match(/<div class="genxed">([\s\S]*?)<\/div>/)
  let genres = []
  if (genreMatch) genres = [...new Set([...genreMatch[1].matchAll(/<a[^>]*>([^<]+)<\/a>/gi)].map(m => cleanText(m[1])))]
  const bannerMatch = html.match(/<div class="bigcover">[\s\S]*?<img[^>]+src="([^"]+)"/i)
  const banner = bannerMatch ? bannerMatch[1] : ''
  const thumbMatch = html.match(/<div class="thumb"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i)
  const thumbnail = thumbMatch ? thumbMatch[1] : ''
  const synMatch = html.match(/<div class="entry-content"[^>]*>([\s\S]*?)<\/div>/)
  const synopsis = synMatch ? cleanText(synMatch[1]) : 'Sinopsis tidak tersedia.'

  let subtitles = 'Tidak ada info subtitle'
  const descMatch = html.match(/<meta name="description" content="([^"]+)"/i)
  if (descMatch) {
    const descText = descMatch[1]
    const subIndex = descText.toLowerCase().indexOf('subtitle')
    if (subIndex !== -1) {
      let subStr = descText.substring(subIndex + 8).trim()
      const endIdx = subStr.toLowerCase().indexOf(title.toLowerCase())
      if (endIdx !== -1 && endIdx > 3) subStr = subStr.substring(0, endIdx).trim()
      if (subStr.endsWith('-') || subStr.endsWith(',')) subStr = subStr.slice(0, -1).trim()
      if (subStr.length > 0) subtitles = subStr.split(',').map(s => cleanText(s)).join(', ')
    }
  }

  const episodes = []
  const epsHtmlMatch = html.match(/<div class="eplister"[\s\S]*?<ul>([\s\S]*?)<\/ul>/i)
  if (epsHtmlMatch) {
    const liMatches = epsHtmlMatch[1].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || []
    liMatches.forEach((liHtml, idx) => {
      const urlMatch = liHtml.match(/<a[^>]+href="([^"]+)"/i)
      if (!urlMatch) return
      const epUrl = urlMatch[1]
      const titleMatch = liHtml.match(/<div class="epl-title">([^<]+)<\/div>/i) || liHtml.match(/<a[^>]*>([^<]+)<\/a>/i)
      const epTitle = titleMatch ? cleanText(titleMatch[1]) : `Episode ${idx + 1}`
      if (!epUrl.includes('animexin.dev') || epTitle.toLowerCase().includes('kofi') || epTitle.toLowerCase().includes('memberpage')) return
      const numMatch = liHtml.match(/<div class="epl-num">([^<]+)<\/div>/i)
      const subMatch = liHtml.match(/<div class="epl-sub">([\s\S]*?)<\/div>/i)
      const dateMatch = liHtml.match(/<div class="epl-date">([^<]+)<\/div>/i)
      const indexMatch = liHtml.match(/data-index="(\d+)"/i)
      episodes.push({
        index: indexMatch ? parseInt(indexMatch[1], 10) : idx,
        epNum: numMatch ? cleanText(numMatch[1]) : `${idx + 1}`,
        title: epTitle, sub: subMatch ? cleanText(subMatch[1]) : 'Sub',
        date: dateMatch ? cleanText(dateMatch[1]) : 'N/A', url: epUrl
      })
    })
  } else if (html.includes('<option value=') || html.includes('<iframe')) {
    episodes.push({ index: 0, epNum: '1', title, sub: 'Sub', date: released, url: targetUrl })
  }

  return {
    id: resolvedId,
    data: { judul: title, alterJudul, rating, status, type, totalEpisodes, rilis: released, durasi: duration, studio, genres, subtitle: subtitles, thumbnail, banner, sinopsis: synopsis, url: targetUrl, totalEpisodesFound: episodes.length, episodes }
  }
}

async function fetchEpisodeData(query) {
  if (!query || !String(query).trim()) throw new Error('Berikan URL atau judul episode!')
  const cleanQuery = String(query).trim()
  let targetUrl = ''

  if (cleanQuery.startsWith('http://') || cleanQuery.startsWith('https://')) {
    if (!isValidAnimexinUrl(cleanQuery)) throw new Error('URL tidak valid. Hanya animexin.dev')
    targetUrl = cleanQuery
  } else {
    const searchRes = await fetchSearchData(cleanQuery)
    if (searchRes.data.length === 0) throw new Error(`Episode/Anime "${cleanQuery}" tidak ditemukan`)
    targetUrl = searchRes.data[0].url
  }

  const html = await fetchHtml(targetUrl)
  const titleMatch = html.match(/<h1 class="entry-title"[^>]*>([^<]+)<\/h1>/)
  const title = titleMatch ? cleanText(titleMatch[1]) : ''

  const navBlock = html.match(/<div class="naveps[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  let navigation = { prev: null, next: null, series: null }
  if (navBlock) {
    const prevMatch = navBlock[0].match(/<a[^>]+rel="prev"[^>]+href="([^"]+)"/i) || navBlock[0].match(/<a[^>]+href="([^"]+)"[^>]*rel="prev"/i)
    const nextMatch = navBlock[0].match(/<a[^>]+rel="next"[^>]+href="([^"]+)"/i) || navBlock[0].match(/<a[^>]+href="([^"]+)"[^>]*rel="next"/i)
    const seriesMatch = navBlock[0].match(/<div class="nvsc">[\s\S]*?<a[^>]+href="([^"]+)"/i) || navBlock[0].match(/<a[^>]+href="([^"]+)"[^>]*>\s*All/i)
    navigation.prev = prevMatch ? prevMatch[1] : null
    navigation.next = nextMatch ? nextMatch[1] : null
    navigation.series = seriesMatch ? seriesMatch[1] : null
  }

  const serverMatches = [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/gi)]
  const streams = []
  serverMatches.forEach(match => {
    const base64Val = match[1]
    const serverName = cleanText(match[2])
    if (base64Val && serverName && !serverName.toLowerCase().includes('select video server') && !serverName.toLowerCase().includes('comment')) {
      try {
        const decoded = Buffer.from(base64Val, 'base64').toString('utf-8')
        const iframeSrc = decoded.match(/src=["']?([^"'\s>]+)["']?/i)
        if (iframeSrc) {
          let url = iframeSrc[1]
          if (url.startsWith('//')) url = 'https:' + url
          streams.push({ name: serverName, url })
        }
      } catch (e) {}
    }
  })

  if (streams.length === 0) {
    const iframeMatch = html.match(/<iframe[^>]+src=["']?([^"'\s>]+)["']?/i)
    if (iframeMatch) {
      let url = iframeMatch[1]
      if (url.startsWith('//')) url = 'https:' + url
      streams.push({ name: 'Direct Stream', url })
    }
  }

  const downloads = []
  const dlBlocks = [...html.matchAll(/<div class="soraddlx[^"]*">([\s\S]*?)<\/div>\s*(?=<div class="soraddlx|<\/div>\s*<\/div>)/gi)]
  dlBlocks.forEach(b => {
    const catMatch = b[1].match(/<div class="sorattlx"><h3>([^<]+)<\/h3>/i)
    const category = catMatch ? cleanText(catMatch[1]) : 'Download'
    const rows = [...b[1].matchAll(/<div class="soraurlx"[^>]*>([\s\S]*?)<\/div>/gi)]
    rows.forEach(r => {
      const qualityMatch = r[1].match(/<strong>([^<]+)<\/strong>/i)
      const quality = qualityMatch ? cleanText(qualityMatch[1]) : 'Default'
      const links = [...r[1].matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi)].map(m => {
        let linkUrl = m[1]
        if (linkUrl.startsWith('//')) linkUrl = 'https:' + linkUrl
        return { server: cleanText(m[2]), url: linkUrl }
      })
      if (links.length > 0) downloads.push({ category, quality, links })
    })
  })

  return {
    data: { title, url: targetUrl, navigation, totalStreams: streams.length, streams, totalDownloads: downloads.length, downloads }
  }
}

export default {
  name: "Animexin Anime",
  description: "Scraper anime — home, popular, search, detail, episode streaming & download",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "page", "genre"],
  paramsSchema: {
    action: {
      type: "string", required: true,
      enum: ["home", "popular", "recommend", "schedule", "genres", "genre", "search", "detail", "episode"],
      description: "Aksi: home, popular, recommend, schedule, genres, genre, search, detail, episode"
    },
    query: { type: "string", required: false, description: "Query pencarian / judul / URL (untuk search, detail, episode)" },
    url: { type: "string", required: false, description: "URL animexin.dev (untuk detail, episode)" },
    page: { type: "number", default: 1, required: false, description: "Halaman (untuk home, search, genre)" },
    genre: { type: "string", required: false, description: "Slug genre (untuk action=genre, contoh: action, romance)" }
  },

  async run(req, res) {
    try {
      const { action, query, url, page = 1, genre } = { ...req.query, ...req.body }

      if (!action) return res.status(400).json({ status: false, message: "Parameter 'action' wajib: home, popular, recommend, schedule, genres, genre, search, detail, episode" })

      if (action === 'home') {
        return res.json({ status: true, ...(await fetchListData('home', page)) })
      }
      if (action === 'popular') {
        return res.json({ status: true, ...(await fetchListData('popular', 1)) })
      }
      if (action === 'recommend') {
        return res.json({ status: true, ...(await fetchListData('recommend', 1)) })
      }
      if (action === 'schedule') {
        return res.json({ status: true, ...(await fetchScheduleData()) })
      }
      if (action === 'genres') {
        return res.json({ status: true, ...(await fetchGenresData()) })
      }
      if (action === 'genre') {
        if (!genre) return res.status(400).json({ status: false, message: "Parameter 'genre' wajib untuk action=genre" })
        return res.json({ status: true, ...(await fetchGenreAnimeData(genre, page)) })
      }
      if (action === 'search') {
        if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search" })
        return res.json({ status: true, ...(await fetchSearchData(query, page)) })
      }
      if (action === 'detail') {
        const q = query || url
        if (!q) return res.status(400).json({ status: false, message: "Parameter 'query' atau 'url' wajib untuk action=detail" })
        return res.json({ status: true, ...(await fetchDetailData(q)) })
      }
      if (action === 'episode') {
        const q = query || url
        if (!q) return res.status(400).json({ status: false, message: "Parameter 'query' atau 'url' wajib untuk action=episode" })
        return res.json({ status: true, ...(await fetchEpisodeData(q)) })
      }

      return res.status(400).json({ status: false, message: `Action '${action}' tidak valid` })
    } catch (err) {
      logger.error(`[ANIMEXIN] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Animexin request failed' })
    }
  }
}

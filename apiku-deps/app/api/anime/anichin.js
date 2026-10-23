import logger from '../../src/utils/logger.js'

const BASE_URL = 'https://anichin.cafe'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://anichin.cafe/',
}

async function fetchHtml(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal })
    if (res.status !== 200) throw new Error(`Failed ${url}: HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timeout)
  }
}

function cleanText(text) {
  if (!text) return ''
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(url, prefix) {
  return url
    .replace(BASE_URL, '')
    .replace(prefix, '')
    .replace(/^\/+|\/+$/g, '')
}

function parseSeriesList(html) {
  const series = []
  const regex = /<article[^>]*class="[^"]*bs[^"]*"[^>]*>([\s\S]*?)<\/article>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const block = match[1]
    const linkMatch = block.match(/<a\s+href="([^"]+)"[^>]*title="([^"]*)"/i) || block.match(/<a\s+href="([^"]+)"/i)
    const titleMatch = block.match(/<div class="tt">([\s\S]*?)<\/div>/i) || block.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/i)
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/i) || block.match(/<img[^>]*data-src="([^"]+)"/i)
    const statusMatch = block.match(/<span\s+class="status[^"]*">([\s\S]*?)<\/span>/i)
    const typeMatch = block.match(/<span\s+class="typez[^"]*">([\s\S]*?)<\/span>/i)
    const epMatch = block.match(/<span\s+class="epx">([\s\S]*?)<\/span>/i)

    if (linkMatch) {
      const url = linkMatch[1]
      const title = titleMatch ? cleanText(titleMatch[1]) : linkMatch[2] ? cleanText(linkMatch[2]) : ''
      series.push({
        title,
        url,
        slug: slugify(url, /^\/seri\//),
        thumbnail: imgMatch ? imgMatch[1] : null,
        type: typeMatch ? cleanText(typeMatch[1]) : 'Donghua',
        status: statusMatch ? cleanText(statusMatch[1]) : null,
        latestEpisode: epMatch ? cleanText(epMatch[1]) : null,
      })
    }
  }

  if (series.length === 0) {
    const altRegex = /<div class="bsx">[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<div class="tt">([\s\S]*?)<\/div>/gi
    while ((match = altRegex.exec(html)) !== null) {
      series.push({
        title: cleanText(match[3]),
        url: match[1],
        slug: slugify(match[1], /^\/seri\//),
        thumbnail: match[2],
        type: 'Donghua',
        status: null,
        latestEpisode: null,
      })
    }
  }

  return series
}

function parseSeriesDetail(html, url) {
  const titleMatch = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i)
  const alterMatch = html.match(/<span[^>]*class="alter"[^>]*>([\s\S]*?)<\/span>/i)
  const synMatch = html.match(/<div[^>]*class="synp"[^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div[^>]*class="entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  const thumbMatch = html.match(/<div[^>]*class="thumb"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i)

  let rating = null
  const ratingWidthMatch = html.match(/<div class="rtb"><span style="width:([0-9.]+)%"><\/span><\/div>/i)
  if (ratingWidthMatch) {
    rating = (parseFloat(ratingWidthMatch[1]) / 10).toFixed(1)
  } else {
    const ratingTextMatch = html.match(/<div[^>]*class="rating"[^>]*>[\s\S]*?([0-9.]+)/i)
    if (ratingTextMatch) rating = ratingTextMatch[1]
  }

  const info = {}
  const infoRegex = /<span><b>([^<]+):<\/b>\s*([\s\S]*?)<\/span>/gi
  let infoMatch
  while ((infoMatch = infoRegex.exec(html)) !== null) {
    info[cleanText(infoMatch[1]).toLowerCase()] = cleanText(infoMatch[2])
  }

  const genres = []
  const genreBlock = html.match(/<div[^>]*class="genxed"[^>]*>([\s\S]*?)<\/div>/i) || html.match(/<span[^>]*class="mgen"[^>]*>([\s\S]*?)<\/span>/i)
  if (genreBlock) {
    const gmRegex = /<a[^>]*>([^<]+)<\/a>/gi
    let gm
    while ((gm = gmRegex.exec(genreBlock[1])) !== null) {
      genres.push(cleanText(gm[1]))
    }
  }

  const episodes = []
  const epRegex = /<li[^>]*data-index="[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)<\/div>[\s\S]*?<div class="epl-title">([^<]+)<\/div>[\s\S]*?<div class="epl-date">([^<]+)<\/div>/gi
  let epMatch
  while ((epMatch = epRegex.exec(html)) !== null) {
    const epUrl = epMatch[1]
    episodes.push({
      episodeNumber: cleanText(epMatch[2]),
      title: cleanText(epMatch[3]),
      releaseDate: cleanText(epMatch[4]),
      url: epUrl,
      slug: slugify(epUrl, /\/$/),
    })
  }

  if (episodes.length === 0) {
    const altEp = [...html.matchAll(/<a href="([^"]+)"[^>]*><div class="epl-title">([^<]+)<\/div>/gi)]
    altEp.forEach((m, i) => {
      episodes.push({
        episodeNumber: `${altEp.length - i}`,
        title: cleanText(m[2]),
        releaseDate: '-',
        url: m[1],
        slug: slugify(m[1], /\/$/),
      })
    })
  }

  const batchDownloads = []
  const batchSections = [...html.matchAll(/<div[^>]*class="soraurlx"[^>]*>([\s\S]*?)<\/div>/gi)]
  batchSections.forEach((section) => {
    const titleMatch = section[1].match(/<strong>([\s\S]*?)<\/strong>/i)
    const links = [...section[1].matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((l) => ({
      provider: cleanText(l[2]),
      link: l[1],
    }))
    if (links.length > 0) {
      batchDownloads.push({
        batchName: titleMatch ? cleanText(titleMatch[1]) : 'Batch',
        links,
      })
    }
  })

  return {
    title: titleMatch ? cleanText(titleMatch[1]) : '',
    alternativeTitle: alterMatch ? cleanText(alterMatch[1]) : null,
    url,
    slug: slugify(url, /^\/seri\//),
    thumbnail: thumbMatch ? thumbMatch[1] : null,
    rating: rating ? `${rating} / 10` : null,
    synopsis: synMatch ? cleanText(synMatch[1]) : '',
    genres,
    info: {
      status: info['status'] || null,
      type: info['type'] || 'Donghua',
      studio: info['studio'] || null,
      network: info['network'] || null,
      duration: info['duration'] || null,
      season: info['season'] || null,
      country: info['country'] || null,
      released: info['released'] || info['released on'] || null,
      updatedOn: info['updated on'] || null,
    },
    totalEpisodes: episodes.length,
    episodes,
    batchDownloads,
  }
}

function parseEpisodeDetail(html, url) {
  const titleMatch = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i)
  const defaultEmbedMatch = html.match(/<div class="player-embed"[^>]*>[\s\S]*?<iframe[^>]*src="([^"]+)"/i)
  const defaultEmbed = defaultEmbedMatch ? defaultEmbedMatch[1] : null

  const streamingServers = []
  const serverOptions = [...html.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*data-index=["']?([^"'>]*)["']?[^>]*>([\s\S]*?)<\/option>/gi)]
  for (const opt of serverOptions) {
    const base64Value = opt[1]
    const serverName = cleanText(opt[3])
    let streamUrl = null
    if (base64Value) {
      try {
        const decoded = Buffer.from(base64Value, 'base64').toString('utf-8')
        const srcMatch = decoded.match(/src=["']([^"']+)["']/i)
        if (srcMatch) streamUrl = srcMatch[1]
      } catch (err) {}
    }
    streamingServers.push({
      serverName,
      serverIndex: opt[2],
      streamUrl: streamUrl || defaultEmbed,
    })
  }

  const downloads = []
  const dlBlocks = [...html.matchAll(/<div[^>]*class="soraurlx"[^>]*>([\s\S]*?)<\/div>/gi)]
  dlBlocks.forEach((block) => {
    const qMatch = block[1].match(/<strong>([\s\S]*?)<\/strong>/i)
    const links = [...block[1].matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((l) => ({
      provider: cleanText(l[2]),
      link: l[1],
    }))
    if (links.length > 0) {
      downloads.push({
        resolution: qMatch ? cleanText(qMatch[1]) : 'Direct',
        links,
      })
    }
  })

  const prevMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*class="prev"/i) || html.match(/<a[^>]*href="([^"]+)"[^>]*rel="prev"/i)
  const nextMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*class="next"/i) || html.match(/<a[^>]*href="([^"]+)"[^>]*rel="next"/i)
  const allMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*class="allsub"/i) || html.match(/<div class="allsub"><a href="([^"]+)"/i)

  return {
    episodeTitle: titleMatch ? cleanText(titleMatch[1]) : 'Episode',
    url,
    slug: slugify(url, /\/$/),
    navigation: {
      prevEpisodeUrl: prevMatch ? prevMatch[1] : null,
      nextEpisodeUrl: nextMatch ? nextMatch[1] : null,
      seriesUrl: allMatch ? allMatch[1] : null,
    },
    streamingServers,
    downloads,
  }
}

function parseSchedule(html) {
  const schedule = {}
  const sections = [...html.matchAll(/<div class="releases"><h3><span>([^<]+)<\/span><\/h3><\/div>\s*<div class="listupd">([\s\S]*?)<\/div>\s*<\/div>/gi)]
  sections.forEach((sec) => {
    const dayName = cleanText(sec[1])
    const blockContent = sec[2]
    const items = []
    const itemRegex = /<div class="bsx">[\s\S]*?<a\s+href="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<div class="tt">([\s\S]*?)<\/div>/gi
    let m
    while ((m = itemRegex.exec(blockContent)) !== null) {
      const url = m[1]
      const title = cleanText(m[4]) || cleanText(m[2])
      const parentBlock = blockContent.slice(m.index, m.index + 500)
      const timeMatch = parentBlock.match(/<span class=['"]epx[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i)
      const subMatch = parentBlock.match(/<span class=['"]sb[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i)
      items.push({
        title,
        url,
        slug: slugify(url, /^\/seri\//),
        thumbnail: m[3],
        time: timeMatch ? cleanText(timeMatch[1]) : '',
        episode: subMatch ? cleanText(subMatch[1]) : '',
      })
    }
    if (items.length > 0) {
      schedule[dayName] = items
    }
  })
  return schedule
}

function parseGenres(html) {
  const genres = []
  const genreBlock = html.match(/<div class="filter dropdown">([\s\S]*?)<\/div>\s*<\/div>/i) ||
    html.match(/<ul class="dropdown-menu c4 scrollz">([\s\S]*?)<\/ul>/i) ||
    html.match(/<form[^>]*class="filters"[^>]*>([\s\S]*?)<\/form>/i)
  if (genreBlock) {
    const regex = /<input[^>]*name=["']genre\[\]["'][^>]*value=["']([^"']+)["'][^>]*>\s*<label[^>]*>([\s\S]*?)<\/label>/gi
    let match
    while ((match = regex.exec(genreBlock[1])) !== null) {
      genres.push({
        name: cleanText(match[2]),
        slug: cleanText(match[1]),
        url: `${BASE_URL}/genres/${match[1]}/`,
      })
    }
  }
  if (genres.length === 0) {
    const anyCheckbox = [...html.matchAll(/<input[^>]*name=["']genre\[\]["'][^>]*value=["']([^"']+)["'][^>]*>\s*<label[^>]*>([\s\S]*?)<\/label>/gi)]
    anyCheckbox.forEach((m) => {
      genres.push({
        name: cleanText(m[2]),
        slug: cleanText(m[1]),
        url: `${BASE_URL}/genres/${m[1]}/`,
      })
    })
  }
  return genres
}

// Handlers
async function handleSearch(query) {
  const html = await fetchHtml(`${BASE_URL}/?s=${encodeURIComponent(query)}`)
  return parseSeriesList(html)
}

async function handleOngoing() {
  const html = await fetchHtml(`${BASE_URL}/ongoing/`)
  return parseSeriesList(html)
}

async function handleCompleted() {
  const html = await fetchHtml(`${BASE_URL}/completed/`)
  return parseSeriesList(html)
}

async function handleSchedule() {
  const html = await fetchHtml(`${BASE_URL}/schedule/`)
  return parseSchedule(html)
}

async function handleGenres() {
  const html = await fetchHtml(`${BASE_URL}/`)
  return parseGenres(html)
}

async function handleGenreFilter(genreSlug) {
  const clean = genreSlug.replace(/^\/genres\/|\/$/g, '')
  const html = await fetchHtml(`${BASE_URL}/genres/${clean}/`)
  return parseSeriesList(html)
}

async function handleDetail(urlOrSlug) {
  let targetUrl = urlOrSlug.trim()
  if (!targetUrl.startsWith('http')) {
    const cleanSlug = targetUrl.replace(/^\/seri\/|^\/|\/$/g, '')
    targetUrl = `${BASE_URL}/seri/${cleanSlug}/`
  }
  const html = await fetchHtml(targetUrl)
  return parseSeriesDetail(html, targetUrl)
}

async function handleEpisode(urlOrSlug) {
  let targetUrl = urlOrSlug.trim()
  const cleanSlug = targetUrl.startsWith('http')
    ? targetUrl.replace(BASE_URL, '').replace(/^\/seri\/|^\/|\/$/g, '')
    : targetUrl.replace(/^\/seri\/|^\/|\/$/g, '')

  if (!targetUrl.startsWith('http')) {
    targetUrl = `${BASE_URL}/${cleanSlug}/`
  }

  let html = await fetchHtml(targetUrl)
  let note = null

  if (html.includes('class="eplister"') || html.includes('class="synp"') || html.includes('class="infox"')) {
    const seriesDetail = parseSeriesDetail(html, targetUrl)
    if (seriesDetail.episodes && seriesDetail.episodes.length > 0) {
      const latestEpUrl = seriesDetail.episodes[0].url
      const epHtml = await fetchHtml(latestEpUrl)
      const epData = parseEpisodeDetail(epHtml, latestEpUrl)
      note = `Input terdeteksi sebagai Series "${seriesDetail.title}". Menampilkan episode terbaru.`
      return { note, ...epData }
    }
  }

  return parseEpisodeDetail(html, targetUrl)
}

export default {
  name: "Anichin Donghua",
  description: "Scraper donghua — search, ongoing, completed, schedule, genres, genre, detail, episode streaming & download",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "genre"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["search", "ongoing", "completed", "schedule", "genres", "genre", "detail", "episode"],
      description: "Aksi: search, ongoing, completed, schedule, genres, genre, detail, episode",
    },
    query: {
      type: "string",
      required: false,
      description: "Keyword pencarian (action=search) atau judul/slug/URL (action=detail, episode)",
      example: "Soul Land",
    },
    url: {
      type: "string",
      required: false,
      description: "URL/slug seri atau episode (action=detail, episode)",
      example: "https://anichin.cafe/seri/soul-land-2-the-unrivaled-tang-sect/",
    },
    genre: {
      type: "string",
      required: false,
      description: "Slug genre (action=genre, contoh: action, cultivation, fantasy)",
      example: "cultivation",
    },
  },

  async run(req, res) {
    try {
      const { action, query, url, genre } = { ...req.query, ...req.body }

      if (!action) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' wajib: search, ongoing, completed, schedule, genres, genre, detail, episode",
        })
      }

      const a = String(action).trim().toLowerCase()
      const q = query || url || ''

      if (a === 'search') {
        if (!q) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search" })
        const data = await handleSearch(q)
        return res.json({ status: true, total: data.length, result: data })
      }
      if (a === 'ongoing') {
        const data = await handleOngoing()
        return res.json({ status: true, total: data.length, result: data })
      }
      if (a === 'completed') {
        const data = await handleCompleted()
        return res.json({ status: true, total: data.length, result: data })
      }
      if (a === 'schedule') {
        const data = await handleSchedule()
        return res.json({ status: true, daysCount: Object.keys(data).length, result: data })
      }
      if (a === 'genres') {
        const data = await handleGenres()
        return res.json({ status: true, total: data.length, result: data })
      }
      if (a === 'genre') {
        if (!genre) return res.status(400).json({ status: false, message: "Parameter 'genre' wajib untuk action=genre" })
        const data = await handleGenreFilter(genre)
        return res.json({ status: true, genre, total: data.length, result: data })
      }
      if (a === 'detail') {
        if (!q) return res.status(400).json({ status: false, message: "Parameter 'query' atau 'url' wajib untuk action=detail" })
        const data = await handleDetail(q)
        return res.json({ status: true, result: data })
      }
      if (a === 'episode') {
        if (!q) return res.status(400).json({ status: false, message: "Parameter 'query' atau 'url' wajib untuk action=episode" })
        const data = await handleEpisode(q)
        return res.json({ status: true, result: data })
      }

      return res.status(400).json({ status: false, message: `Action '${a}' tidak valid` })
    } catch (err) {
      logger.error(`[ANICHIN] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Anichin request failed' })
    }
  },
}

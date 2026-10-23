import axios from "axios"
import * as cheerio from "cheerio"

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
}

export async function searchAnime(query) {
  const searchUrl = `https://www.livechart.me/search?q=${encodeURIComponent(query)}`
  const { data } = await axios.get(searchUrl, {
    timeout: 20000,
    headers: { ...HEADERS, Referer: 'https://www.livechart.me/', Origin: 'https://www.livechart.me' }
  })

  const $$ = cheerio.load(data)
  let animeUrl = ''

  $$('a').each((i, el) => {
    const href = $$(el).attr('href')
    if (href && href.startsWith('/anime/') && href.split('/').length === 3) {
      animeUrl = 'https://www.livechart.me' + href
      return false
    }
  })

  if (!animeUrl) throw new Error('Anime tidak ditemukan')

  const urlObj = new URL(animeUrl)
  const res = await axios.get(animeUrl, {
    timeout: 20000,
    headers: { ...HEADERS, Referer: animeUrl, Origin: urlObj.origin }
  })

  const $ = cheerio.load(res.data)

  let title = ''
  let englishTitle = ''
  let japaneseTitle = ''
  let image = ''
  let description = ''
  let genres = []
  let studios = []
  let releaseDate = 'Unknown'
  let status = 'Unknown'
  let totalEpisodes = 'Unknown'
  let runtime = 'Unknown'
  let score = 'Unknown'
  let ratingCount = '0'
  let season = 'Unknown'
  let format = 'Unknown'
  let source = 'Unknown'
  let latestEpisode = 'Unknown'
  let website = ''
  let officialX = ''

  const jsonLdScript = $('script[type="application/ld+json"]').html()

  if (jsonLdScript) {
    try {
      const jsonData = JSON.parse(jsonLdScript)
      title = jsonData.name || ''
      englishTitle = (jsonData.alternateName && jsonData.alternateName[0]) || ''
      japaneseTitle = (jsonData.alternateName && jsonData.alternateName[1]) || ''
      image = jsonData.image || ''
      description = jsonData.description || ''
      genres = jsonData.genre || []
      totalEpisodes = jsonData.numberOfEpisodes ? jsonData.numberOfEpisodes.toString() : 'Unknown'

      if (jsonData.datePublished) {
        const d = new Date(jsonData.datePublished)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        releaseDate = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
      }

      if (jsonData.productionCompany?.length) {
        studios = jsonData.productionCompany.map(s => s.name)
      }

      if (jsonData.aggregateRating) {
        score = jsonData.aggregateRating.ratingValue + '/10'
        ratingCount = jsonData.aggregateRating.ratingCount?.toString() || '0'
      }

      if (jsonData.url) animeUrl = jsonData.url
    } catch {}
  }

  if (!title) title = $('meta[property="og:title"]').attr('content') || $('title').text().trim()
  if (!image) image = $('meta[property="og:image"]').attr('content')
  if (!description) description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''

  if (genres.length === 0) {
    const blacklist = ['Manga','Light Novel','Original','Web Manga','Game','Visual Novel','Novel']
    $('a[href*="/tags/"]').each((i, el) => {
      const g = $(el).text().trim()
      if (g && g.length < 25 && !blacklist.includes(g)) genres.push(g)
    })
  }

  if (studios.length === 0) {
    $('a[href*="/studios/"]').each((i, el) => {
      const s = $(el).text().trim()
      if (s) studios.push(s)
    })
  }

  if (status === 'Unknown') {
    $('.text-sm .font-medium').each((i, el) => {
      if ($(el).text().trim() === 'Status') {
        const st = $(el).parent().text().replace('Status', '').trim()
        if (st) status = st.split('\n')[0].trim()
      }
    })
  }

  if (releaseDate === 'Unknown') {
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
    const m = bodyText.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}\b/)
    if (m) releaseDate = m[0]
  }

  if (season === 'Unknown') {
    $('a[href*="/summer-"][href*="/tv"],a[href*="/winter-"][href*="/tv"],a[href*="/spring-"][href*="/tv"],a[href*="/fall-"][href*="/tv"]').each((i, el) => {
      const href = $(el).attr('href')
      if (href) {
        const sm = href.match(/\/(winter|spring|summer|fall)-\d{4}/)
        if (sm) season = sm[0].replace('/', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())
        else season = $(el).text().trim()
        return false
      }
    })
  }

  if (latestEpisode === 'Unknown') {
    const epEl = $('.line-clamp-1.text-sm.text-base-content\\/75.link-hover .font-medium')
    if (epEl.length) latestEpisode = epEl.text().trim()
  }

  if (format === 'Unknown') {
    $('.grid.grid-flow-col.auto-cols-fr .text-xs.text-base-content\\/75').each((i, el) => {
      if ($(el).text().trim() === 'Format') format = $(el).parent().text().replace('Format', '').trim()
    })
  }

  if (source === 'Unknown') {
    $('.grid.grid-flow-col.auto-cols-fr .text-xs.text-base-content\\/75').each((i, el) => {
      if ($(el).text().trim() === 'Source') {
        const st = $(el).parent().text().replace('Source', '').trim()
        if (st) source = st
      }
    })
  }

  if (runtime === 'Unknown') {
    $('.grid.grid-flow-col.auto-cols-fr .text-xs.text-base-content\\/75').each((i, el) => {
      if ($(el).text().trim() === 'Run time') {
        const rt = $(el).parent().text().replace('Run time', '').trim()
        if (rt) runtime = rt
      }
    })
  }

  if (totalEpisodes === 'Unknown') {
    const epCount = $('[data-anime-details-target="viewerProgress"]')
    if (epCount.length) {
      const epMatch = epCount.parent().text().trim().match(/\/(\d+)/)
      if (epMatch) totalEpisodes = epMatch[1]
    }
  }

  $('.lc-btn.lc-btn-sm.lc-btn-outline').each((i, el) => {
    const href = $(el).attr('href')
    const text = $(el).text().trim()
    if (text === 'Website' && href) website = href
    if (text === 'Official X' && href) officialX = href
  })

  const cleanGenres = [...new Set(genres)].filter(g => g && g.length < 30).slice(0, 10)
  const cleanStudios = [...new Set(studios)]

  return {
    title,
    englishTitle: englishTitle !== title ? englishTitle : '',
    japaneseTitle: japaneseTitle !== title && japaneseTitle !== englishTitle ? japaneseTitle : '',
    image,
    synopsis: description || 'Tidak ada deskripsi',
    status,
    rating: score,
    ratingCount,
    format,
    runtime,
    source: source || 'Unknown',
    genres: cleanGenres,
    studios: cleanStudios,
    season,
    releaseDate,
    episodes: latestEpisode !== 'Unknown' ? latestEpisode : '1',
    totalEpisodes,
    website: website || null,
    officialX: officialX || null,
    url: animeUrl
  }
}

async function getMovieDetail(url) {
  const { data } = await axios.get(url, { headers: { ...HEADERS, 'Accept-Language': 'en-US,en;q=0.9' } })
  const $ = cheerio.load(data)

  const poster = $('.blurred img.poster').attr('src') || ''
  const userScore = $('.user_score_chart').attr('data-percent') || ''
  const description = $('.overview p').text().trim()

  const cast = []
  $('.people.scroller li.card').each((_, element) => {
    const personUrl = $(element).find('a').attr('href')
    const name = $(element).find('p a').text().trim()
    const character = $(element).find('.character').text().trim()
    const episodes = $(element).find('.episode_count').text().trim()

    if (personUrl && name) {
      cast.push({
        name,
        character: character || null,
        episodes: episodes || null,
        url: personUrl?.startsWith('http') ? personUrl : `https://www.themoviedb.org${personUrl}`
      })
    }
  })

  const topContributors = []
  $('.leaderboard .edit_leader').each((_, element) => {
    const contributorUrl = $(element).find('a').attr('href')
    const contributorName = $(element).find('.info a').text().trim()
    const editCount = $(element).find('.edit_count').text().split('\n')[0].trim()
    const profilePic = $(element).find('.avatar img').attr('src') || ''

    if (contributorUrl && contributorName) {
      topContributors.push({
        name: contributorName,
        edits: editCount || null,
        profilePic: profilePic || null,
        url: contributorUrl?.startsWith('http') ? contributorUrl : `https://www.themoviedb.org${contributorUrl}`
      })
    }
  })

  const title = $('h2 a').first().text().trim() || $('h1').first().text().trim() || 'Unknown'

  return {
    title,
    poster: poster || null,
    userScore: userScore || null,
    description: description || null,
    cast,
    topContributors
  }
}

export default {
  name: "Movie Detail (TMDB)",
  description: "Ambil detail film/series secara lengkap.",
  category: "Search",
  methods: ["GET"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL halaman TMDB (contoh: https://www.themoviedb.org/tv/122665)"
    }
  },

  features: {
    platform: "TMDB",
    region: "Global"
  },

  async run(req, res) {
    try {
      const { url } = req.query || {}

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      if (!url.includes('themoviedb.org')) {
        return res.status(400).json({
          status: false,
          message: "URL harus dari themoviedb.org",
        })
      }

      const result = await getMovieDetail(url.trim())

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      })

    } catch (err) {
      console.error("Movie Detail Error:", err.message)

      res.status(500).json({
        status: false,
        message: err.message || "Gagal mengambil detail film",
        timestamp: Date.now()
      })
    }
  },
}



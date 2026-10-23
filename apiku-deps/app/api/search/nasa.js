/**
 * NASA Scraper
 * Scrape dari nasa.gov (News Releases, Missions A-Z, Image of the Day)
 * Parameter: type (news|missions|images), limit, query, detail
 * NO API KEY
 */

import https from 'https'
import http from 'http'
import zlib from 'zlib'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const NEWS_BASE = 'https://www.nasa.gov/2026-news-releases/'
const NEWS_PAGES = 7
const NEWS_API = 'https://www.nasa.gov/wp-json/nasa-hds/v1/content-lists'
const MISSIONS_URL = 'https://www.nasa.gov/a-to-z-of-nasa-missions/'
const IOTD_URL = 'https://www.nasa.gov/image-of-the-day/'
const TIMEOUT_MS = 30000

function httpGet(url, redirects) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(new Error('Invalid URL: ' + url)) }
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(u, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Connection': 'close'
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirects < 5) return resolve(httpGet(new URL(res.headers.location, u).href, redirects + 1))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        let buf = Buffer.concat(chunks)
        const enc = (res.headers['content-encoding'] || '').toLowerCase()
        let dec = null
        if (enc === 'gzip') dec = zlib.gunzipSync
        else if (enc === 'deflate') dec = zlib.inflateSync
        else if (enc === 'br') dec = zlib.brotliDecompressSync
        if (dec) { try { buf = dec(buf) } catch {} }
        resolve({ status: res.statusCode, body: buf.toString('utf8') })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Timeout: ' + url)))
  })
}

async function get(url) {
  const r = await httpGet(url, 0)
  if (r.status >= 400) throw new Error('HTTP ' + r.status + ' untuk ' + url)
  return r.body
}

async function getJSON(url) {
  return JSON.parse(await get(url))
}

function clean(s) {
  return String(s || '')
    .replace(/&#0?38;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function filterList(list, query) {
  if (!query) return list
  const q = query.toLowerCase()
  return list.filter(i => JSON.stringify(i).toLowerCase().includes(q))
}

/* ============================ NEWS ============================ */
async function fetchNewsPage(page) {
  const qs = new URLSearchParams({
    postType: 'press-release',
    postId: 940636,
    perPage: 25,
    newsTags: 16635,
    layout: 'list',
    showThumbnails: 'yes',
    showReadTime: 'yes',
    showExcerpts: 'yes',
    showContentTypeTags: 'yes',
    pageClicked: String(page)
  })
  const json = await getJSON(NEWS_API + '?' + qs.toString())
  const html = json.html || ''
  const items = []
  const re = /<div class="hds-content-item">([\s\S]*?)(?=<div class="hds-content-item"|$)/g
  let m
  while ((m = re.exec(html)) !== null) {
    const block = m[1]
    const ha = block.match(/<a href="([^"]+)" class="hds-content-item-heading">[\s\S]*?<div class="hds-a11y-heading-22">([\s\S]*?)<\/div>/)
    if (!ha) continue
    const url = ha[1]
    const title = clean(ha[2])
    if (!/^https?:/.test(url) || title.length < 10) continue
    const thumb = block.match(/<a href="[^"]+" class="hds-content-item-thumbnail">[\s\S]*?<img[^>]*src="([^"]+)"/)
    const rt = block.match(/<div class="hds-content-item-readtime[^"]*"[^>]*>([^<]*)</)
    const ex = block.match(/<p class="margin-top-0 margin-bottom-1">([\s\S]*?)<\/p>/)
    items.push({
      title,
      url,
      description: ex ? clean(ex[1]) : '',
      readTime: rt ? clean(rt[1]) : '',
      contentType: 'News Release',
      imageUrl: thumb ? thumb[1] : ''
    })
  }
  return items
}

function parseNewsDetail(html) {
  const main = (html.match(/<main[\s\S]*<\/main>/i) || [''])[0] || html
  const h1m = main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  const title = h1m ? clean(h1m[1]) : ''
  const paragraphs = []
  const reP = /<p\b[^>]*>([\s\S]*?)<\/p>/g
  let pm
  while ((pm = reP.exec(main)) !== null) {
    const t = clean(pm[1])
    if (t.length < 40) continue
    if (/^(Media|News|Contact|Privacy|FOIA|Budget|Follow|Sitemap)/i.test(t)) continue
    if (/(National Aeronautics and Space Administration|NASA explores the unknown|Was this page helpful)/.test(t)) continue
    paragraphs.push(t)
  }
  let publishDate = ''
  let rawDate = ''
  let releaseType = ''
  let releaseId = ''
  let author = ''
  let location = ''
  const dateRe = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/
  const metaBlocks = main.match(/class="article-meta-item[\s\S]*?<\/div>/g) || []
  for (const blk of metaBlocks) {
    const dm = blk.match(dateRe)
    if (dm) {
      rawDate = dm[0]
      const d = new Date(rawDate)
      if (!isNaN(d)) publishDate = d.toISOString()
    }
    const sp = blk.match(/<span class="heading-12 text-uppercase">([\s\S]*?)<\/span>/)
    if (sp && !sp[1].match(/\d{4}/)) {
      const s = clean(sp[1])
      const rm = s.match(/\b([A-Z]{0,4}\d{2}-\d{3,4})\b/)
      if (rm) releaseId = rm[1]
      const typ = rm ? s.replace(rm[1], '').trim() : s
      if (typ && /^[A-Z ]+$/.test(typ)) releaseType = typ
    }
    if (/article-location-tags|hds-location-tag/.test(blk) && !location) {
      const lA = blk.match(/<a class="hds-location-tag-name[^"]*"[^>]*>([\s\S]*?)<\/a>/)
      location = clean(lA ? lA[1] : blk)
    }
  }
  const am = main.match(/<p class="font-weight-bold">([^<]+)<\/p>/)
  if (am) author = clean(am[1])
  if (!releaseId) {
    const rm2 = main.match(/\b([A-Z]{0,4}\d{2}-\d{3,4})\b/)
    if (rm2) releaseId = rm2[1]
  }
  if (!releaseType) {
    const tm2 = main.match(/<span class="heading-12 text-uppercase">([A-Z\s]{3,})<\/span>/)
    if (tm2) releaseType = clean(tm2[1])
  }
  if (!location) {
    const lm2 = main.match(/<a class="hds-location-tag-name[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    if (lm2) location = clean(lm2[1])
  }
  return {
    title,
    fullContent: paragraphs.join('\n\n'),
    publishDate,
    publishedDateRaw: rawDate,
    releaseType,
    releaseId,
    author,
    location
  }
}

async function scrapeNews() {
  const list = []
  for (let page = 1; page <= NEWS_PAGES; page++) {
    try {
      const items = await fetchNewsPage(page)
      const seen = new Set(list.map(i => i.url))
      for (const it of items) if (!seen.has(it.url)) list.push(it)
    } catch {}
    await sleep(150)
  }
  return list
}

function addNewsDetail(item) {
  return get(item.url).then(html => {
    const d = parseNewsDetail(html)
    item.fullContent = d.fullContent
    if (d.publishDate) item.publishDate = d.publishDate
    if (d.publishedDateRaw) item.publishedDateRaw = d.publishedDateRaw
    if (d.releaseType) item.releaseType = d.releaseType
    if (d.releaseId) item.releaseId = d.releaseId
    if (d.author) item.author = d.author
    if (d.location) item.location = d.location
    if (d.title) item.title = d.title
    return item
  }).catch(() => { item.fullContent = ''; return item })
}

/* ============================ MISSIONS ============================ */
function parseMissionList(html) {
  const missions = []
  let currentLetter = '#'
  const re = /<h2\b[^>]*class="wp-block-heading"[^>]*id="([A-Z0-9])"[^>]*>|<p\b[^>]*class="wp-block-paragraph"[^>]*>([\s\S]*?)<\/p>/g
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      currentLetter = m[1]
      continue
    }
    const inner = m[2]
    const lm = inner.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!lm) continue
    const name = clean(lm[2])
    if (!name) continue
    const desc = clean(inner.replace(lm[0], ''))
    missions.push({ name, url: lm[1], letter: currentLetter, description: desc })
  }
  return missions
}

function parseMissionDetail(html, url) {
  const main = (html.match(/<main[\s\S]*<\/main>/i) || [''])[0] || html
  const h1m = main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  const name = h1m ? clean(h1m[1]) : ''
  const facts = {}
  const reF = /<div class="grid-col-6">[\s\S]*?<p class="label[^"]*"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/g
  let fm
  while ((fm = reF.exec(main)) !== null) {
    const label = clean(fm[1])
    const value = clean(fm[2])
    if (label && value && !/^\s*$/.test(value)) facts[label] = value
  }
  const keyDates = []
  const reP = /<p\b[^>]*class="wp-block-paragraph"[^>]*>([\s\S]*?)<\/p>/g
  let pm
  const DATE_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*\d{1,2},?\s*\d{4}$/i
  while ((pm = reP.exec(main)) !== null) {
    const inner = pm[1]
    const bm = inner.match(/<b>([^<]+)<\/b>/)
    if (!bm) continue
    let date = clean(bm[1]).replace(/[:.\s]+$/, '')
    if (!DATE_RE.test(date)) continue
    const event = clean(inner.slice(inner.indexOf('</b>') + 4))
    if (event) keyDates.push(`${date}: ${event}`)
  }
  const paragraphs = []
  while ((pm = reP.exec(main)) !== null) {
    const t = clean(pm[1])
    if (t.length < 40) continue
    if (/(National Aeronautics and Space Administration|NASA explores the unknown|Follow NASA|Privacy Policy|Was this page helpful)/.test(t)) continue
    if (/^(Related Terms|Multimedia|Highlights)/.test(t)) continue
    paragraphs.push(t)
  }
  return { name, url, facts, keyDates, overview: paragraphs.slice(0, 12) }
}

function addMissionDetail(misi) {
  let url = misi.url
  if (url.startsWith('/')) url = 'https://www.nasa.gov' + url
  if (!/^https?:/.test(url)) {
    misi.detail = { error: 'URL tidak valid' }
    return Promise.resolve(misi)
  }
  return get(url).then(html => {
    const d = parseMissionDetail(html, url)
    misi.detail = { facts: d.facts, keyDates: d.keyDates, overview: d.overview }
    if (d.name) misi.name = d.name
    return misi
  }).catch(e => { misi.detail = { error: e.message.slice(0, 60) }; return misi })
}

async function scrapeMissions() {
  return parseMissionList(await get(MISSIONS_URL))
}

/* ============================ IMAGES ============================ */
function parseImages(html) {
  const images = []
  const re = /<div class="hds-gallery-item-single[^"]*">([\s\S]*?)(?=<div class="hds-gallery-item-single|$)/g
  let m
  while ((m = re.exec(html)) !== null) {
    const block = m[1]
    const href = (block.match(/<a class="hds-gallery-item-link[^"]*" href="([^"]+)"/) || [])[1] || ''
    const img = block.match(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/)
    const cap = (block.match(/<div class="hds-gallery-item-caption[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''
    const alt = img ? clean(img[2]) : ''
    const slug = href.split('/').filter(Boolean).pop() || ''
    const title = slug
      ? slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : cap
    images.push({
      title,
      url: href,
      imageUrl: img ? img[1] : '',
      alt,
      caption: clean(cap)
    })
  }
  return images
}

async function scrapeImages() {
  return parseImages(await get(IOTD_URL))
}

/* ============================ EXPORT ============================ */
const TYPE_CONFIG = {
  news: { label: 'News Releases', maxLimit: 154 },
  missions: { label: 'Missions A-Z', maxLimit: 666 },
  images: { label: 'Image of the Day', maxLimit: 40 }
}

export default {
  name: 'NASA Search',
  description: 'Scrape nasa.gov — News Releases 2026, Misi A-Z, dan Image of the Day. Tanpa API key.',
  category: 'Search',
  methods: ['GET', 'POST'],
  params: ['type', 'limit', 'query', 'detail'],
  paramsSchema: {
    type: {
      type: 'string',
      required: true,
      description: 'Jenis data NASA: news | missions | images',
      enum: ['news', 'missions', 'images'],
      example: 'images'
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Jumlah item yang dikembalikan (default 5, terpotong otomatis)',
      default: 5
    },
    query: {
      type: 'string',
      required: false,
      description: 'Filter pencarian nama/judul (case-insensitive)',
      example: 'roman'
    },
    detail: {
      type: 'boolean',
      required: false,
      description: 'true = ambil konten penuh (news) / detail misi (missions). Maks 5 item.',
      default: false
    }
  },

  async run(req, res) {
    const { type, limit, query, detail } = { ...req.query, ...req.body }

    const cleanType = String(type || '').toLowerCase()
    if (!TYPE_CONFIG[cleanType]) {
      return res.status(400).json({ status: false, message: "Parameter 'type' wajib salah satu: news | missions | images" })
    }

    let lim = parseInt(limit, 10)
    if (isNaN(lim) || lim < 1) lim = 5
    lim = Math.min(lim, TYPE_CONFIG[cleanType].maxLimit)

    const wantDetail = String(detail).toLowerCase() === 'true' || detail === true
    const detailN = wantDetail ? Math.min(lim, 5) : 0

    try {
      let result = {}
      let list = []

      if (cleanType === 'news') {
        list = await scrapeNews()
        list = filterList(list, query)
        if (detailN > 0) await Promise.all(list.slice(0, detailN).map(addNewsDetail))
        result = { totalArticles: list.length, detailFetched: detailN, articles: list.slice(0, lim) }
      } else if (cleanType === 'missions') {
        list = await scrapeMissions()
        list = filterList(list, query)
        if (detailN > 0) await Promise.all(list.slice(0, detailN).map(addMissionDetail))
        const byLetter = {}
        for (const m of list) (byLetter[m.letter] = byLetter[m.letter] || []).push(m.name)
        result = { totalMissions: list.length, detailFetched: detailN, groupedByLetter: byLetter, missions: list.slice(0, lim) }
      } else {
        list = await scrapeImages()
        list = filterList(list, query)
        if (list.length) list[0].isToday = true
        result = { totalImages: list.length, images: list.slice(0, lim) }
      }

      return res.json({
        status: true,
        result: {
          type: cleanType,
          source: cleanType === 'news' ? NEWS_BASE : cleanType === 'missions' ? MISSIONS_URL : IOTD_URL,
          scrapedAt: new Date().toISOString(),
          ...result
        }
      })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || String(err) })
    }
  }
}
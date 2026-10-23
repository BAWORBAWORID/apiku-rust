import axios from 'axios'
import * as cheerio from 'cheerio'
import logger from "../../src/utils/logger.js"

const BASE = 'https://apkmody.mobi'
const HOSTS = ['apkmody.com', 'apkmody.io', 'apkmody.mobi']
const FILE_RE = /\.(apk|obb|zip|rar|7z|xapk)$/i
const SLUG_RE = /\/(games|apps)\/[^/]+/
const SIZE_RE = /([\d.,]+)\s*(TB|GB|MB|KB)/i
const SIZE_MULT = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 }

const headers = {
  'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
  'sec-ch-ua-platform': '"Android"',
  'sec-ch-ua-mobile': '?1',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'referer': 'https://apkmody.mobi/'
}

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  maxRedirects: 5,
  validateStatus: () => true,
  headers
})

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

function finalUrlOf(res) {
  const req = res.request
  return (
    (req && req.res && req.res.responseUrl) ||
    (req && req._redirectable && req._redirectable._currentUrl) ||
    null
  )
}

async function fetchPage(url, { referer } = {}) {
  let res
  try {
    res = await client.get(url, { headers: referer ? { referer } : {} })
  } catch (e) {
    const status = e.response && e.response.status
    throw new Error((status ? 'HTTP ' + status + ' untuk ' : 'Gagal memuat ') + url)
  }
  if (res.status >= 400) throw new Error('HTTP ' + res.status + ' untuk ' + url)
  return { status: res.status, body: res.data, url: finalUrlOf(res) || url }
}

function isApkmodyUrl(url) {
  let host
  try { host = new URL(url).hostname } catch { return false }
  return HOSTS.some((d) => host === d || host.endsWith('.' + d))
}

function normalizeUrl(url) {
  const u = new URL(url)
  return BASE + u.pathname + u.search
}

function parseSize(str) {
  const m = String(str || '').match(SIZE_RE)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, '.'))
  return Math.round(n * (SIZE_MULT[m[2].toLowerCase()] || 1))
}

function packageFromIcon(iconUrl) {
  const m = String(iconUrl || '').match(/\/packages\/([^/]+)\/icon_/)
  return m ? m[1] : null
}

function classifyPage(url) {
  const u = new URL(url)
  const p = u.pathname
  if (u.searchParams.has('s')) return 'search'
  if (/\/(?:games|apps)\/[^/]+\/history\/[A-Za-z0-9]+/.test(p)) return 'version'
  if (/\/history\/?$/.test(p)) return 'history'
  if (/\/download\/?$/.test(p)) return 'download'
  if (/\/(?:games|apps)\/[^/]+/.test(p)) return 'detail'
  return 'other'
}

function parseDetail($) {
  const h1Strong = $('h1 strong').first().text()
  const title = clean(h1Strong) ||
    $('title').first().text().replace(/\s*[-|]\s*APKMODY\s*$/i, '').trim() || ''
  const spanText = $('h1 strong').first().parent().find('span').first().text()
  const version = (spanText.match(/v(\d+(?:\.\d+)+)/) || [])[1] || null
  const mod = (spanText.match(/\(([^()]*?)\)/) || [])[1] || null
  const icon =
    $('img[src^="https://cdn.topmongo.com/packages/"]').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null
  const updated = $('time[datetime]').first().attr('datetime') || null
  return { title, version, mod, icon, package: packageFromIcon(icon), updated }
}

function parseFiles($) {
  const files = []
  const seen = new Set()
  $('a[href^="https://cdn.topmongo.com/packages/"]').each((_, el) => {
    const url = $(el).attr('href') || ''
    if (!FILE_RE.test(url) || seen.has(url)) return
    seen.add(url)
    const text = clean($(el).text())
    const size = (text.match(SIZE_RE) || [])[0] || null
    files.push({
      fileName: url.split('/').pop(),
      size,
      sizeBytes: parseSize(size),
      type: (url.match(FILE_RE) || [])[1] || null,
      url
    })
  })
  return files
}

function parseHistory($) {
  const items = []
  $('.historyItem a[href*="/history/"]').each((_, el) => {
    const version = clean($(el).find('.font18').text())
    const date = clean($(el).find('.top .grayColor').text())
    const name = clean($(el).find('.gameTitle').text())
    const size = clean($(el).find('.bottom .grayColor').text())
    items.push({ version, date, name, size, sizeBytes: parseSize(size), url: BASE + ($(el).attr('href') || '') })
  })
  return items
}

function parseListing($) {
  const items = []
  const seen = new Set()
  $('a.app[href]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(SLUG_RE)
    if (!m) return
    const url = BASE + m[0]
    if (seen.has(url)) return
    seen.add(url)
    const icon = $(el).find('img[src*="topmongo.com/packages/"]').attr('src') || null
    const title = clean($(el).find('.has-normal-font-size').first().text())
    const version = clean($(el).find('.has-small-font-size').first().text())
    items.push({ title, version, icon, package: packageFromIcon(icon), url })
  })
  return items
}

function parseSearchItems($) {
  const items = []
  const seen = new Set()
  $('article.card a[href]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(SLUG_RE)
    if (!m) return
    const url = BASE + m[0]
    if (seen.has(url)) return
    seen.add(url)
    const cover = $(el).find('img').first().attr('src') || null
    const title = clean($(el).find('.card-title .truncate').first().text())
    const version = clean($(el).find('.card-excerpt').first().text())
    items.push({ title, version, cover, url })
  })
  return items
}

const basePath = (isApp, slug) => BASE + '/' + (isApp ? 'apps' : 'games') + '/' + slug

async function detail(url, { history = true } = {}) {
  const type = classifyPage(url)
  const page = await fetchPage(url)

  if (['detail', 'version', 'history', 'download'].includes(type)) {
    if (new URL(page.url).pathname === '/') {
      throw new Error('Halaman tidak ditemukan: ' + url + ' (diredirect ke homepage)')
    }
  }

  const $ = cheerio.load(page.body)

  if (type === 'search') {
    const items = parseSearchItems($)
    return { type: 'search', query: new URL(url).searchParams.get('s'), source: url, count: items.length, items }
  }

  if (type === 'other') {
    const items = parseListing($)
    if (items.length) return { type: 'listing', source: url, count: items.length, items }
    throw new Error('Halaman tidak dikenali / bukan halaman game, app, atau listing')
  }

  const isApp = /\/apps\//.test(url)
  const kind = isApp ? 'app' : 'game'
  const slug = (url.match(/\/(?:games|apps)\/([^/]+)/) || [])[1] || null
  const parsed = parseDetail($)

  if (type === 'version') {
    return {
      type: kind,
      title: parsed.title,
      version: parsed.version,
      mod: parsed.mod,
      icon: parsed.icon,
      package: parsed.package,
      updated: parsed.updated,
      source: url,
      downloads: parseFiles($),
      history: history ? parseHistory($) : []
    }
  }

  if (type === 'history' || type === 'download') {
    let files = parseFiles($)
    let page2 = page
    if (!files.length && type === 'download') {
      page2 = await fetchPage(basePath(isApp, slug) + '/history')
      files = parseFiles(cheerio.load(page2.body))
    }
    const hist = history ? parseHistory(cheerio.load(page2.body)) : []
    const hasH1 = $('h1 strong').length > 0
    return {
      type: kind,
      title: hasH1 ? parsed.title : hist.length ? hist[0].name : parsed.title,
      version: parsed.version || (hist.length ? hist[0].version.replace(/^Ver\s*/i, '') : null),
      mod: parsed.mod,
      icon: parsed.icon,
      package: parsed.package,
      updated: parsed.updated,
      source: type === 'history' ? url : normalizeUrl(page2.url),
      downloads: files,
      history: hist
    }
  }

  let files = []
  let hist = []
  try {
    const histPage = await fetchPage(basePath(isApp, slug) + '/history')
    const $h = cheerio.load(histPage.body)
    files = parseFiles($h)
    if (history) hist = parseHistory($h)
  } catch {
    files = []
  }
  if (!files.length) {
    const dlPage = await fetchPage(basePath(isApp, slug) + '/download')
    files = parseFiles(cheerio.load(dlPage.body))
  }
  return {
    type: kind,
    title: parsed.title,
    version: parsed.version,
    mod: parsed.mod,
    icon: parsed.icon,
    package: parsed.package,
    updated: parsed.updated,
    source: url,
    downloads: files,
    history: hist
  }
}

async function search(query, { page } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new Error('Query pencarian kosong')
  const u = new URL(BASE + '/')
  u.searchParams.set('s', q)
  if (page && page > 1) u.searchParams.set('page', String(page))
  const url = u.toString()
  const res = await fetchPage(url)
  const items = parseSearchItems(cheerio.load(res.body))
  return { type: 'search', query: q, source: url, count: items.length, page: page || 1, items }
}

export default {
  name: "APKModY Downloader",
  description: "Download APK/OBB/ZIP mod (search, detail, history, download)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "page"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["search", "detail", "history", "download"],
      description: "Aksi: search (cari), detail (info), history (riwayat versi), download (link download)"
    },
    query: {
      type: "string",
      required: false,
      description: "Query pencarian (wajib untuk action=search)"
    },
    url: {
      type: "string",
      required: false,
      description: "URL apkmody.mobi (wajib untuk action=detail/history/download)"
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman pencarian (untuk action=search)"
    }
  },

  async run(req, res) {
    try {
      const { action, query, url, page = 1 } = { ...req.query, ...req.body }

      if (!action) return res.status(400).json({ status: false, message: "Parameter 'action' wajib: search, detail, history, download" })

      if (action === 'search') {
        if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk search" })
        const result = await search(query, { page })
        return res.json({ status: true, result })
      }

      if (action === 'detail') {
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk detail" })
        const result = await detail(url, { history: true })
        return res.json({ status: true, result })
      }

      if (action === 'history') {
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk history" })
        const result = await detail(url, { history: true })
        return res.json({ status: true, result: { title: result.title, version: result.version, history: result.history } })
      }

      if (action === 'download') {
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk download" })
        const result = await detail(url, { history: false })
        if (!result.downloads || !result.downloads.length) {
          return res.status(404).json({ status: false, message: "Tidak ada file download ditemukan" })
        }
        return res.json({
          status: true,
          result: {
            title: result.title,
            version: result.version,
            mod: result.mod,
            downloads: result.downloads.map(f => ({
              fileName: f.fileName,
              size: f.size,
              sizeBytes: f.sizeBytes,
              type: f.type,
              url: f.url
            }))
          }
        })
      }

      return res.status(400).json({ status: false, message: "Action tidak valid: search, detail, history, download" })

    } catch (err) {
      logger.error(`[APKMODY] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "APKModY request failed" })
    }
  }
}
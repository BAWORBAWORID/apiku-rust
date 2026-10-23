/**
 * YouTube Search (YTScrape)
 * Cari video YouTube — tanpa API key, tanpa login, tanpa captcha
 * Menggunakan ytInitialData + InnerTube continuation
 *
 * GET  /api/search/ytscrape?q=one+piece+opening&limit=10
 * POST /api/search/ytscrape
 *
 * Params:
 *   q     — query pencarian (wajib)
 *   limit — jumlah hasil, max 60 (default: 20)
 */

import { request as httpsReq } from 'node:https'

const YT = 'https://www.youtube.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const TIMEOUT = 30_000
const RETRIES = 2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function req(url, { method = 'GET', headers = {}, body, maxRedirect = 5, timeout = TIMEOUT, retries = RETRIES } = {}) {
  let cur = url
  for (let hop = 0; hop <= maxRedirect; hop++) {
    const u = new URL(cur)
    let out = null
    for (let i = 0; i <= retries; i++) {
      out = await new Promise((resolve) => {
        const rq = httpsReq(
          { protocol: u.protocol, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, servername: u.hostname, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers } },
          (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), finalUrl: cur })) }
        )
        rq.setTimeout(timeout, () => rq.destroy(new Error('timeout')))
        rq.on('error', (e) => resolve({ status: 0, error: e.message }))
        if (body) rq.write(body)
        rq.end()
      })
      if ((out.status >= 500 || out.status === 429 || out.status === 0) && i < retries) { await sleep(700 * (i + 1)); continue }
      break
    }
    const loc = out.headers?.location
    if (loc && out.status >= 300 && out.status < 400) { cur = new URL(loc, cur).toString(); continue }
    return out
  }
  throw new Error('gagal: kebanyakan redirect')
}

function scanJson(text, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

const runs = (o) => (o?.runs || []).map((r) => r.text).join('')

function walkSearch(node, out, tokenRef) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const v of node) walkSearch(v, out, tokenRef); return }
  const v = node.videoRenderer
  if (v?.videoId) {
    out.push({
      id: v.videoId,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      title: runs(v.title) || null,
      length: v.lengthText?.simpleText || null,
      views: v.viewCountText?.simpleText || null,
      channel: runs(v.ownerText) || null,
      channelUrl: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
        ? `${YT}/channel/${v.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId}` : null,
      published: v.publishedTimeText?.simpleText || null,
      thumb: v.thumbnail?.thumbnails?.at?.(-1)?.url || null,
    })
  }
  if (!tokenRef.token) {
    const t = node.continuationCommand?.token || node.continuationEndpoint?.continuationCommand?.token
    if (t) tokenRef.token = t
  }
  for (const val of Object.values(node)) walkSearch(val, out, tokenRef)
}

async function search(query, { limit = 20, pages = 3 } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new Error('query kosong')
  const max = Math.max(1, Math.min(Number(limit) || 20, 60))

  const page = await req(`${YT}/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US`, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  })
  if (page.status !== 200) throw new Error(`halaman search HTTP ${page.status}`)

  const key = page.text.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const ver = page.text.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] || '2.20261009.01.00'
  const at = page.text.indexOf('var ytInitialData')
  const brace = page.text.indexOf('{', at)
  if (at < 0 || brace < 0) throw new Error('ytInitialData tidak ditemukan')
  const data = JSON.parse(scanJson(page.text, brace))

  const results = [], tokenRef = {}
  walkSearch(data, results, tokenRef)

  let token = tokenRef.token
  for (let p = 1; p < Math.max(1, pages) && results.length < max && token; p++) {
    await sleep(350)
    const body = JSON.stringify({ context: { client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: ver } }, continuation: token })
    const res = await req(`${YT}/youtubei/v1/search?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': ver },
      body,
    })
    if (res.status !== 200) break
    const before = results.length, ref = {}
    walkSearch(JSON.parse(res.text), results, ref)
    if (results.length === before) break
    token = ref.token
  }

  const seen = new Set(), dedup = []
  for (const r of results) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    dedup.push({ ...r, rank: dedup.length + 1 })
    if (dedup.length >= max) break
  }
  return { query: q, limit: max, count: dedup.length, results: dedup }
}

export default {
  name: 'YouTube Search (YTScrape)',
  description: 'Cari video YouTube — tanpa API key, tanpa login, tanpa captcha. Menggunakan ytInitialData + InnerTube continuation.',
  category: 'Search',
  methods: ['GET', 'POST'],
  params: ['q', 'limit'],
  paramsSchema: {
    q: { type: 'string', required: true, default: '', description: 'Query pencarian YouTube', example: '' },
    limit: { type: 'number', required: false, default: 20, description: 'Jumlah hasil (max 60)', example: 20 },
  },
  async run(req, res) {
    try {
      const rawQ = req.query.q || req.body?.q || req.query.query || req.body?.query
      const q = rawQ && typeof rawQ === 'string' ? rawQ.trim() : null
      if (!q) return res.status(400).json({ status: false, message: "Parameter 'q' wajib diisi." })
      const limit = Math.max(1, Math.min(Number(req.query.limit || req.body?.limit || 20), 60))
      const result = await search(q, { limit, pages: 3 })
      return res.json({ status: true, result })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || 'Gagal memproses request.' })
    }
  },
}

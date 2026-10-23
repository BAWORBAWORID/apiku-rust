/**
 * YouTube Downloader (via Invidious + Y2Mate)
 * Download video/audio YouTube — zero dependency, tanpa API key
 * Provider: Invidious (multi-instance) + Y2Mate.gs
 *
 * GET  /api/downloader/ytscrape?url=https://youtu.be/xxx&format=mp4
 * POST /api/downloader/ytscrape
 *
 * Params:
 *   url      — URL atau video ID YouTube (wajib)
 *   format   — mp4 | mp3 (default: mp4)
 *   provider — auto | invidious | y2mate (default: auto)
 *   itag     — paksa itag stream invidious (opsional)
 */

import { request as httpsReq } from 'node:https'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const TIMEOUT = 30_000
const RETRIES = 2
const IV_FALLBACK = [
  'invidious.f5.si', 'inv.nadeko.net', 'invidious.tiekoetter.com', 'yewtu.be',
  'invidious.nerdvpn.de', 'invidious.privacyredirect.com', 'invidious.materialio.us',
  'invidious.fdn.fr', 'iv.ggtyler.dev', 'invidious.protokolla.fi',
]

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

async function probe(url) {
  try {
    let cur = url
    for (let hop = 0; hop < 5; hop++) {
      const u = new URL(cur)
      const out = await new Promise((resolve) => {
        const rq = httpsReq(
          { protocol: u.protocol, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', servername: u.hostname, headers: { 'User-Agent': UA, Range: 'bytes=0-0', Accept: '*/*' } },
          (res) => { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, finalUrl: cur }) }
        )
        rq.setTimeout(12_000, () => rq.destroy(new Error('timeout')))
        rq.on('error', (e) => resolve({ status: 0, error: e.message }))
        rq.end()
      })
      const loc = out.headers?.location
      if (loc && out.status >= 300 && out.status < 400) { cur = new URL(loc, cur).toString(); continue }
      const range = out.headers?.['content-range'] || ''
      const total = Number((range.split('/')[1] || out.headers?.['content-length'] || '').trim())
      return { ok: out.status === 200 || out.status === 206, status: out.status, contentType: out.headers?.['content-type'] || null, totalBytes: Number.isFinite(total) && total > 0 ? total : null }
    }
    return { ok: false, status: 0 }
  } catch (e) { return { ok: false, status: 0, error: e.message } }
}

function videoId(input) {
  const value = String(input || '').trim()
  if (/^[\w-]{11}$/.test(value)) return value
  let url
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`) } catch { throw new Error('link YouTube tidak valid') }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  const id = host === 'youtu.be' ? parts[0] : (url.searchParams.get('v') || (['embed', 'live', 'shorts', 'v'].includes(parts[0]) ? parts[1] : ''))
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('link YouTube tidak didukung')
  return id
}

async function ivInstances() {
  const list = new Set(IV_FALLBACK)
  try {
    const r = await req('https://api.invidious.io/instances.json', { timeout: 12_000, retries: 0 })
    const j = JSON.parse(r.text)
    if (Array.isArray(j)) for (const [host, meta] of j) if (meta?.type?.includes('http') || meta?.api) list.add(host)
  } catch {}
  return [...list]
}

async function ivFetch(host, id) {
  const r = await req(`https://${host}/api/v1/videos/${id}`, { headers: { Accept: 'application/json', Referer: `https://${host}/` }, timeout: 16_000, retries: 0 })
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
  let j; try { j = JSON.parse(r.text) } catch { throw new Error('respons bukan JSON') }
  const adaptive = j.adaptiveFormats || [], muxed = j.formatStreams || []
  if (!adaptive.length && !muxed.length) throw new Error('tidak ada stream')
  const wh = (f) => { for (const k of ['resolution', 'size']) { const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(f[k] || '')); if (m) return m } return null }
  const bytesOf = (f) => { const n = Number(f.clen ?? f.size); return Number.isFinite(n) && n > 1000 ? n : null }
  return {
    instance: host, title: j.title || null, author: j.author || null,
    lengthSeconds: j.lengthSeconds || null, hlsUrl: j.hlsUrl || null, dashUrl: j.dashUrl || null,
    muxed: muxed.map((f) => { const m = wh(f); return { itag: Number(f.itag) || null, kind: 'muxed', type: f.type || null, quality: f.qualityLabel || f.quality || null, container: f.container || null, width: m ? Number(m[1]) : null, height: m ? Number(m[2]) : null, bytes: bytesOf(f), url: f.url } }),
    adaptive: adaptive.map((f) => { const m = wh(f); const label = f.qualityLabel || ''; return { itag: Number(f.itag) || null, kind: String(f.type || '').startsWith('audio') ? 'audio' : 'video', type: f.type || null, quality: label || f.quality || null, container: f.container || null, encoding: f.encoding || null, width: m ? Number(m[1]) : null, height: m ? Number(m[2]) : (Number((label.match(/(\d{3,4})p/) || [])[1]) || null), fps: f.fps || null, bitrate: Number(f.bitrate) || null, bytes: bytesOf(f), url: f.url } }).filter((f) => f.url),
  }
}

async function viaInvidious(id) {
  const hosts = await ivInstances()
  const errors = []
  for (const host of hosts) {
    try { const info = await ivFetch(host, id); return { provider: 'invidious', videoId: id, ...info, errors } }
    catch (e) { errors.push({ host, why: e.message }) }
  }
  throw new Error(`semua instance invidious gagal: ${errors.slice(0, 3).map((e) => `${e.host}=${e.why}`).join('; ')}`)
}

const Y2 = 'https://y2mate.gs'
const y2json = async (url, label, extra = {}) => {
  const r = await req(url, { headers: { Accept: 'application/json, text/plain, */*', 'Cache-Control': 'no-cache', Pragma: 'no-cache', Referer: `${Y2}/`, Origin: Y2, ...extra } })
  if (r.status !== 200) throw new Error(`${label} HTTP ${r.status}`)
  let j; try { j = JSON.parse(r.text) } catch { throw new Error(`${label} bukan JSON`) }
  const code = Number(j.error ?? j.err ?? 0)
  if (Number.isFinite(code) && code > 0) throw new Error(`${label} kode ${code}`)
  return j
}

async function y2discover() {
  const html = await req(Y2, { headers: { Accept: 'text/html' } })
  const apiKey = html.text.match(/\bapiKey\s*=\s*(['"])([A-Za-z0-9_-]{16,128})\1/)?.[2]
  const scriptSrc = html.text.match(/<script\b[^>]*\bsrc\s*=\s*(['"])([^'"]*y2mate(?:\.min)?\.js[^'"]*)\1/i)?.[2]
  if (!apiKey || !scriptSrc) throw new Error('struktur y2mate berubah')
  const script = await req(new URL(scriptSrc, Y2).toString(), { headers: { Accept: 'text/javascript' } })
  const encHost = script.text.match(/\bendpoint\s*=\s*atob\(\s*(['"])([A-Za-z0-9+/=]+)\1\s*\)/)?.[2]
  return { apiKey, apiOrigin: `https://eta.${encHost ? Buffer.from(encHost, 'base64').toString() : 'etacloud.org'}` }
}

async function viaY2mate(id, format) {
  let site = await y2discover()
  let init = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await y2json(`${site.apiOrigin}/api/v1/auth?api_key=${site.apiKey}&_=${Date.now()}`, 'auth y2mate')
    if (!auth.key) throw new Error('token y2mate tidak ada')
    try { init = await y2json(`${site.apiOrigin}/api/v1/init?_=${Date.now()}`, 'init y2mate', { Authorization: `Bearer ${auth.key}` }); break }
    catch (e) { if (attempt === 0 && /403/.test(e.message)) { await sleep(900); site = await y2discover(); continue } throw e }
  }
  if (!init?.convertURL) throw new Error('URL convert tidak ada')
  const { apiOrigin } = site
  let url = init.convertURL, job = null
  const withParams = (raw, params) => { const u = new URL(raw); for (const [k, val] of Object.entries(params)) u.searchParams.set(k, String(val)); return u.toString() }
  for (let hop = 0; hop <= 5; hop++) {
    const data = await y2json(withParams(url, { v: id, f: format, _: Date.now() }), 'convert y2mate')
    const dl = String(data.downloadURL || '').trim(), st = String(data.status || '').toLowerCase()
    if (st === 'download' && dl) { job = { title: data.title || null, downloadUrl: dl }; break }
    if (String(data.redirect) === '1' && data.redirectURL) { url = data.redirectURL; continue }
    if (data.progressURL && dl) { job = { title: data.title || null, downloadUrl: dl, progressUrl: data.progressURL, progress: Number(data.progress) || 0 }; break }
    throw new Error('convert tidak mengembalikan status valid')
  }
  if (!job) throw new Error('convert gagal')
  if (job.progressUrl && (job.progress || 0) < 3) {
    for (let i = 0; i < 20 && (job.progress || 0) < 3; i++) {
      await sleep(3000)
      const data = await y2json(withParams(job.progressUrl, { _: Date.now() }), 'progress y2mate')
      if (String(data.status || '').toLowerCase() === 'download' && data.downloadURL) { job = { title: data.title || job.title, downloadUrl: data.downloadURL }; break }
      job.progress = Number(data.progress) || job.progress
      job.downloadUrl = data.downloadURL || job.downloadUrl
    }
  }
  if (!job.downloadUrl) throw new Error('download URL tidak keluar')
  return { provider: 'y2mate', videoId: id, format, title: job.title || null, downloadUrl: withParams(job.downloadUrl, { v: id, f: format, r: 'y2mate.gs' }) }
}

function pickStream(info, { format = 'mp4', itag } = {}) {
  if (itag) { const all = [...info.muxed, ...info.adaptive]; const hit = all.find((f) => Number(f.itag) === Number(itag)); if (!hit) throw new Error(`itag ${itag} tidak ada`); return hit }
  if (format === 'mp3') { const audio = info.adaptive.filter((f) => f.kind === 'audio'); const best = audio.find((f) => f.itag === 251) || audio.find((f) => f.itag === 140) || audio[0]; if (!best) throw new Error('tidak ada stream audio'); return { ...best, note: 'bukan hasil konversi mp3 — m4a/opus mentah' } }
  const muxed = [...info.muxed].sort((a, b) => (b.height || 0) - (a.height || 0))
  if (muxed.length) return muxed[0]
  const video = info.adaptive.filter((f) => f.kind === 'video' && f.container === 'mp4').sort((a, b) => (b.height || 0) - (a.height || 0))
  if (!video.length) throw new Error('tidak ada stream video')
  return { ...video[0], note: 'video-only (DASH)' }
}

async function download(input, { format = 'mp4', provider = 'auto', itag, check = true } = {}) {
  const id = videoId(input)
  const fmt = ['mp3', 'mp4'].includes(String(format).toLowerCase()) ? String(format).toLowerCase() : 'mp4'
  const order = provider === 'invidious' ? ['invidious'] : provider === 'y2mate' ? ['y2mate'] : (fmt === 'mp3' ? ['y2mate', 'invidious'] : ['invidious', 'y2mate'])
  const attempts = []
  for (const name of order) {
    try {
      if (name === 'invidious') {
        const info = await viaInvidious(id)
        const stream = pickStream(info, { format: fmt, itag })
        const result = { source: String(input), videoId: id, title: info.title, author: info.author, provider: 'invidious', instance: info.instance, format: fmt, stream, streams: { muxed: info.muxed, videoOnly: info.adaptive.filter((f) => f.kind === 'video'), audioOnly: info.adaptive.filter((f) => f.kind === 'audio') }, hlsUrl: info.hlsUrl, dashUrl: info.dashUrl, lengthSeconds: info.lengthSeconds }
        if (check) result.probe = await probe(stream.url)
        if (check && result.probe && result.probe.ok === false) { attempts.push({ provider: 'invidious', ok: false, why: `link mati (HTTP ${result.probe.status})` }); continue }
        attempts.push({ provider: 'invidious', ok: true }); result.attempts = attempts; return result
      }
      const y = await viaY2mate(id, fmt)
      const result = { source: String(input), videoId: id, title: y.title, provider: 'y2mate', format: fmt, downloadUrl: y.downloadUrl }
      if (check) result.probe = await probe(y.downloadUrl)
      if (check && result.probe && result.probe.ok === false) { attempts.push({ provider: 'y2mate', ok: false, why: `link mati (HTTP ${result.probe.status})` }); continue }
      attempts.push({ provider: 'y2mate', ok: true }); result.attempts = attempts; return result
    } catch (e) { attempts.push({ provider: name, ok: false, why: e.message }) }
  }
  throw new Error(`semua provider gagal: ${attempts.map((a) => `${a.provider}=${a.why}`).join('; ')}`)
}

export default {
  name: 'YouTube Downloader (YTScrape)',
  description: 'Download video/audio YouTube via Invidious (multi-instance, link langsung) + Y2Mate fallback. Zero dependency, tanpa API key.',
  category: 'Downloader',
  methods: ['GET', 'POST'],
  params: ['url', 'format', 'provider', 'itag'],
  paramsSchema: {
    url: { type: 'string', required: true, default: '', description: 'URL atau video ID YouTube', example: '' },
    format: { type: 'string', required: false, default: 'mp4', description: 'Format: mp4 | mp3', example: 'mp4' },
    provider: { type: 'string', required: false, default: 'auto', description: 'Provider: auto | invidious | y2mate', example: 'auto' },
    itag: { type: 'string', required: false, default: '', description: 'Paksa itag stream invidious (mis. 137)', example: '' },
  },
  async run(req, res) {
    try {
      const rawUrl = req.query.url || req.body?.url
      const input = rawUrl && typeof rawUrl === 'string' ? rawUrl.trim() : null
      if (!input) return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi." })
      const format = (req.query.format || req.body?.format || 'mp4').toLowerCase()
      if (!['mp4', 'mp3'].includes(format)) return res.status(400).json({ status: false, message: 'Format harus mp4 atau mp3.' })
      const provider = (req.query.provider || req.body?.provider || 'auto').toLowerCase()
      if (!['auto', 'invidious', 'y2mate'].includes(provider)) return res.status(400).json({ status: false, message: 'Provider harus auto, invidious, atau y2mate.' })
      const itagRaw = req.query.itag || req.body?.itag
      const itag = itagRaw ? Number(itagRaw) : undefined
      const result = await download(input, { format, provider, itag, check: true })
      return res.json({ status: true, result })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || 'Gagal memproses request.' })
    }
  },
}

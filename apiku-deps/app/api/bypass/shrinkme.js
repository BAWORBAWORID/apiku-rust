import { createRequire } from 'module'
import logger from '../../src/utils/logger.js'

const require = createRequire(import.meta.url)
const cloudscraper = require('cloudscraper')
const cheerio = require('cheerio')

const DOMAINS = [
  'https://en.shrinke.me',
  'https://shrinkme.click',
  'https://shrinkme.io'
]

const HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function bypassShrinkme(url) {
  url = url.replace(/\/+$/, '')
  const code = url.split('/').pop()

  for (const domain of DOMAINS) {
    try {
      const finalUrl = `${domain}/${code}`
      const headers = { ...HEADERS_BASE, Referer: 'https://mrproblogger.com/' }

      const resp = await cloudscraper.get({ url: finalUrl, headers, timeout: 20000 })

      const $ = cheerio.load(resp)
      const inputs = $('input')
      if (!inputs.length) continue

      const data = {}
      inputs.each((_, el) => {
        const name = $(el).attr('name')
        const value = $(el).attr('value') || ''
        if (name) data[name] = value
      })

      await sleep(12000)

      const postHeaders = {
        ...headers,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded'
      }

      const body = new URLSearchParams(data).toString()
      const goResp = await cloudscraper.post({ url: `${domain}/links/go`, headers: postHeaders, body, timeout: 20000 })

      try {
        const result = JSON.parse(goResp)
        if (result.url && result.url.startsWith('http')) return result.url
      } catch {
        if (typeof goResp === 'string' && goResp.startsWith('http') && !goResp.includes('<html')) {
          return goResp.trim()
        }
      }
    } catch {
      continue
    }
  }

  return null
}

export default {
  name: "Shrinkme Bypass",
  description: "Bypass shrinkme.click / shrinkme.io / shrinke.me shortlink",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "Shrinkme URL to bypass", example: "https://shrinkme.click/blckrose" }
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      if (!url.match(/shrinkme\.(click|io)|shrinke\.me/)) {
        return res.status(400).json({ status: false, message: "URL harus dari shrinkme.click / shrinkme.io / shrinke.me" })
      }

      const result = await bypassShrinkme(url)

      if (!result) {
        return res.status(500).json({ status: false, message: "Gagal bypass shortlink" })
      }

      return res.json({ status: true, result })
    } catch (err) {
      logger.error(`[SHRINKME] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Internal error' })
    }
  }
}

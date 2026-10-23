import getChromePath from "../../src/utils/chromePath.js"
import { connect } from "puppeteer-real-browser"

const sleep = ms => new Promise(r => setTimeout(r, ms))

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7339.0 Mobile Safari/537.36"

async function isChallenging(page) {
  try {
    const title    = await page.title()
    const url      = page.url()
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '')
    return [
      title.includes('Just a moment'), title.includes('Checking your browser'),
      title.includes('Please Wait'), title.includes('Attention Required'),
      url.includes('/cdn-cgi/challenge-platform'), url.includes('/cdn-cgi/l/chk_jschl'),
      bodyText.includes('Checking if the site connection is secure'),
      bodyText.includes('Please enable JS and disable any ad blocker'),
      bodyText.includes('DDoS protection by'),
    ].some(Boolean)
  } catch { return false }
}

export async function solveUam({ url, proxy, timeoutMs = 60000 }) {
  const chromePath = getChromePath()
  if (!chromePath) throw new Error('Chrome tidak ditemukan')

  const proxyOpt = proxy ? { host: proxy.split(':')[0], port: proxy.split(':')[1] } : {}

  const { page, browser } = await connect({
    headless: true,
    turnstile: true,
    disableXvfb: false,
    executablePath: chromePath,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--window-size=412,915',
    ],
    customConfig: { executablePath: chromePath },
    connectOption: { defaultViewport: { width: 412, height: 915, isMobile: true } },
    proxy: proxyOpt,
  })

  try {
    await page.setUserAgent(UA)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const challenging = await isChallenging(page)
      if (!challenging) { await sleep(2000); break }
      await sleep(1500)
    }

    if (await isChallenging(page)) {
      await browser.close()
      return null
    }

    await sleep(5000)

    const cookies = await page.cookies()
    const cf_clearance = cookies.find(c => c.name === 'cf_clearance')
    const liveUA = await page.evaluate(() => navigator.userAgent).catch(() => UA)
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    await browser.close()

    return {
      cf_clearance: cf_clearance?.value || null,
      cookie: cookieStr,
      user_agent: liveUA,
      fingerprint: 'chrome139-android',
      headers: {
        'user-agent': liveUA,
        'cookie': cookieStr,
      },
      cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
    }
  } catch (e) {
    try { await browser.close() } catch {}
    throw e
  }
}

export default {
  name: "UAM Solver v4",
  description: "Bypass Cloudflare UAM + Turnstile — puppeteer-real-browser + ghost-cursor + Xvfb",
  category: "Solve",
  methods: ["GET", "POST"],
  params: ["url", "proxy"],

  paramsSchema: {
    url: {
      type: "string", required: true,
      description: "Target URL yang dilindungi Cloudflare",
      default: "https://motionhub.lanncodex.biz.id"
    },
    proxy: {
      type: "string", required: false,
      description: "Proxy opsional (http://host:port)",
      example: "http://127.0.0.1:8080"
    }
  },

  async run(req, res) {
    const { url, proxy } = { ...req.query, ...req.body }

    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' is required",
        example: { get: "/api/solve/uam?url=https://motionhub.lanncodex.biz.id", post: { url: "https://motionhub.lanncodex.biz.id" } }
      })
    }

    try { new URL(url) } catch {
      return res.status(400).json({ status: false, message: "Invalid URL format" })
    }

    const startTime = Date.now()
    try {
      const result = await solveUam({ url, proxy, timeoutMs: 60000 })
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

      if (!result) {
        return res.json({
          status: false,
          message: "Gagal bypass Cloudflare setelah 60 detik",
          elapsed_seconds: parseFloat(elapsed),
        })
      }

      return res.json({
        status: true,
        result: { ...result, elapsed_seconds: parseFloat(elapsed) },
      })
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to solve UAM",
      })
    }
  }
}

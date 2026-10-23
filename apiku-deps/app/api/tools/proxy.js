/**
 * CORS Proxy via hideproxy.me
 *
 * GET /tools/proxy?url=https://example.com
 *
 * CORS Proxy — mengakses halaman web melalui proxy hideproxy.me random
 * (Netherlands/Germany). Mengembalikan konten asli sesuai tipe aslinya
 * (HTML/JSON/teks/gambar/dll) + header CORS agar bisa dipakai dari browser.
 *
 * Berguna untuk:
 * - Bypass CORS restriction dari frontend
 * - Akses website yang diblokir
 * - Testing response dari berbagai IP proxy
 */

import logger from "../../src/utils/logger.js"

const COUNTRY_CODES = ["nl", "de"]
const BASE_PROXY = "hideproxy.me"

function randomCountry() {
  return COUNTRY_CODES[Math.floor(Math.random() * COUNTRY_CODES.length)]
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36"

/**
 * Akses URL melalui proxy hideproxy.me
 * Returns: { status, contentType, content, redirectUrl, country, proxy }
 */
async function proxyRequest(targetUrl, countryCode) {
  const base = `https://${countryCode}.${BASE_PROXY}`

  // Step 1: POST ke process.php untuk mendapatkan redirect
  const postRes = await fetch(`${base}/includes/process.php?action=update`, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      origin: base,
      referer: `${base}/`,
      "user-agent": USER_AGENT,
    },
    body: new URLSearchParams({ u: targetUrl }),
  })

  // Ambil cookies
  const setCookies = postRes.headers.get("set-cookie")
  const cookieStr = setCookies
    ? setCookies
        .split(",")
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ")
    : ""

  // Ambil lokasi redirect
  const location = postRes.headers.get("location")
  if (!location) {
    const errorBody = await postRes.text().catch(() => "(gagal baca body)")
    logger.warn(
      `[PROXY] Redirect not found | country=${countryCode} | body=${errorBody.substring(0, 500)}`
    )
    throw new Error(`Redirect tidak ditemukan untuk proxy ${countryCode}`)
  }

  // Step 2: GET ke redirect URL dengan cookies
  const redirectUrl = new URL(location, base).href
  const pageRes = await fetch(redirectUrl, {
    headers: {
      cookie: cookieStr,
      referer: `${base}/`,
      "user-agent": USER_AGENT,
    },
  })

  const contentType = pageRes.headers.get("content-type") || "text/plain; charset=utf-8"
  const buffer = Buffer.from(await pageRes.arrayBuffer())

  return {
    country: countryCode,
    proxy: base,
    status: pageRes.status,
    contentType,
    buffer,
    redirectUrl,
  }
}

export default {
  name: "CORS Proxy",
  description:
    "CORS Proxy — akses halaman web melalui proxy random (NL/DE). Mengembalikan konten asli dengan header CORS.",
  category: "Tools",
  methods: ["GET", "POST", "OPTIONS"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Target URL yang akan diakses melalui proxy",
      example: "https://example.com",
    },
  },

  async run(req, res) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
      return res.status(204).end()
    }

    try {
      const { url } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
          example: "/tools/proxy?url=https://example.com",
        })
      }

      // Validasi format URL
      try {
        new URL(url)
      } catch {
        return res.status(400).json({
          status: false,
          message: "Format URL tidak valid. Gunakan URL lengkap dengan protokol (http/https).",
          example: "https://example.com",
        })
      }

      const countryCode = randomCountry()

      logger.info(`[PROXY] Request | url=${url} | country=${countryCode} | ip=${req.ip}`)

      const result = await proxyRequest(url, countryCode)

      logger.info(`[PROXY] Success | ${countryCode} | ${result.status} | ${result.contentType}`)

      // Set CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

      // Proxy info headers (optional, for debugging)
      res.setHeader("X-Proxy-Country", result.country)
      res.setHeader("X-Proxy-Server", result.proxy)
      res.setHeader("X-Proxy-Status", String(result.status))

      // Kirim konten asli dengan Content-Type asli
      res.setHeader("Content-Type", result.contentType)
      return res.status(result.status).send(result.buffer)

    } catch (err) {
      logger.error(`[PROXY] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses proxy request",
      })
    }
  },
}

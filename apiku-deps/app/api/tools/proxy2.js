/**
 * CORS Proxy v2 — proxysite.com Multi Server
 *
 * GET /tools/proxy2?url=https://example.com
 *
 * CORS Proxy via proxysite.com dengan 16 server random (11 US + 5 Europe).
 * Mengembalikan konten asli (HTML/JSON/teks/gambar/dll) + header CORS.
 */

import logger from "../../src/utils/logger.js"

const SERVERS = [
  "us1", "us2", "us3", "us4", "us5", "us6", "us7", "us8", "us9", "us10", "us11",
  "eu1", "eu2", "eu3", "eu4", "eu5",
]

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36"

function randomServer() {
  return SERVERS[Math.floor(Math.random() * SERVERS.length)]
}

/**
 * Akses URL melalui proxy proxysite.com dengan server tertentu
 */
async function proxyRequest(targetUrl, serverCode) {
  const base = `https://${serverCode}.proxysite.com`

  // Step 1: POST ke process.php untuk mendapatkan session + redirect
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
    body: new URLSearchParams({
      d: targetUrl,
      "server-option": serverCode,
      allowCookies: "on",
      stripJS: "on",
      stripObjects: "on",
    }),
  })

  // Ambil cookies (PHPSESSID)
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
      `[PROXY2] Redirect not found | server=${serverCode} | body=${errorBody.substring(0, 500)}`
    )
    throw new Error(`Redirect tidak ditemukan untuk server ${serverCode}`)
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
    server: serverCode,
    proxy: base,
    status: pageRes.status,
    contentType,
    buffer,
    redirectUrl,
  }
}

export default {
  name: "CORS Proxy v2 — proxysite.com",
  description:
    "CORS Proxy dengan 16 server random (US/EU). Auto pilih server acak tiap request. Mengembalikan konten asli dengan header CORS.",
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
          example: "/tools/proxy2?url=https://example.com",
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

      // Pilih server random (11 US + 5 EU)
      const serverCode = randomServer()

      logger.info(`[PROXY2] Request | url=${url} | server=${serverCode} | ip=${req.ip}`)

      const result = await proxyRequest(url, serverCode)

      logger.info(`[PROXY2] Success | ${serverCode} | ${result.status} | ${result.contentType}`)

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

      // Proxy info headers
      res.setHeader("X-Proxy-Server", serverCode)
      res.setHeader("X-Proxy-Region", serverCode.startsWith("us") ? "US" : "EU")
      res.setHeader("X-Proxy-Status", String(result.status))

      // Kirim konten asli
      res.setHeader("Content-Type", result.contentType)
      return res.status(result.status).send(result.buffer)

    } catch (err) {
      logger.error(`[PROXY2] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses proxy request",
      })
    }
  },
}

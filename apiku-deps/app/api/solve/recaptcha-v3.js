/**
 * Recaptcha V3 / V3 Enterprise Bypass API
 *
 * GET/POST /api/solve/recaptcha-v3
 *
 * Parameter:
 * - sitekey (default: 6LfB5_IbAAAAAMCtsjEHEHKqcB9iQocwwxTiihJu)
 * - url (default: https://2captcha.com/demo/recaptcha-v3)
 *
 * result:
 * - Mengembalikan token recaptcha v3 (juga support v3 Enterprise)
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

const recaptchaClient = axios.create({
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  timeout: 15000,
})

function buildCo(url) {
  const { origin, protocol } = new URL(url)
  const port = protocol === "https:" ? "443" : "80"
  return Buffer.from(`${origin}:${port}`).toString("base64").replace(/=/g, "")
}

async function solveRecaptchaV3({ sitekey, url, co, action, v, hl, anchorUrl } = {}) {
  let versionPath = "api2"
  let paramsString

  if (anchorUrl) {
    const match = anchorUrl.match(/(api2|enterprise)\/anchor\?(.*)/)
    if (!match) throw new Error("Invalid anchor URL")
    ;[, versionPath, paramsString] = match
  } else {
    if (!sitekey) throw new Error("sitekey wajib diisi")
    const coParam = co ?? (url ? buildCo(url) : null)
    if (!coParam) throw new Error("'url' atau 'co' wajib diisi")

    paramsString = new URLSearchParams({
      ar: "1",
      k: sitekey,
      co: coParam,
      hl: hl ?? "en",
      v: v ?? "pCoGBhjs9s8EhFOHJFe8cqis",
      size: "invisible",
      cb: Math.random().toString(36).slice(2),
    }).toString()
  }

  const base = `https://www.google.com/recaptcha/${versionPath}/`
  const params = Object.fromEntries(new URLSearchParams(paramsString))

  const anchorRes = await recaptchaClient.get(`${base}anchor?${paramsString}`)
  const tokenMatch = anchorRes.data.match(/"recaptcha-token" value="(.*?)"/)
  if (!tokenMatch) throw new Error("recaptcha-token tidak ditemukan")

  const postData = new URLSearchParams({
    v: params.v,
    reason: "q",
    c: tokenMatch[1],
    k: params.k,
    co: params.co,
    ...(action ? { sa: action } : {}),
  }).toString()

  const reloadRes = await recaptchaClient.post(`${base}reload?k=${params.k}`, postData)
  const answerMatch = reloadRes.data.match(/"rresp","(.*?)"/)
  if (!answerMatch) throw new Error("rresp tidak ditemukan — sitekey/co salah atau di-block")

  return answerMatch[1]
}

export default {
  name: "Recaptcha V3 Bypass",
  description: "Bypass Google Recaptcha V3 / V3 Enterprise dan dapatkan token (support GET & POST)",
  category: "Solve",
  methods: ["GET", "POST"],
  params: ["url", "sitekey"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Target URL yang mengandung reCAPTCHA v3 / v3 Enterprise",
      default: "https://2captcha.com/demo/recaptcha-v3",
    },
    sitekey: {
      type: "string",
      required: true,
      description: "reCAPTCHA v3 sitekey",
      default: "6LfB5_IbAAAAAMCtsjEHEHKqcB9iQocwwxTiihJu",
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { url, sitekey } = { ...req.query, ...req.body }

      if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      if (!sitekey) return res.status(400).json({ status: false, message: "Parameter 'sitekey' wajib diisi" })

      const token = await solveRecaptchaV3({ sitekey, url })

      const endTime = Date.now() // Akhiri timer
      const responseTime = endTime - startTime // Hitung durasi (ms)

      logger.info(`[RECAPTCHA-V3] success | ip=${req.ip} | sitekey=${sitekey} | time=${responseTime}ms`)

      return res.json({
        status: true,
        result: {
          token,
          responseTime: `${responseTime}ms`,
        }
      })
    } catch (err) {
      const endTime = Date.now()
      const responseTime = endTime - startTime

      logger.error(`[RECAPTCHA-V3] Error | ip=${req.ip} | error=${err.message} | time=${responseTime}ms`)
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to solve recaptcha",
        result: {
          responseTime: `${responseTime}ms`,
        }
      })
    }
  },
}

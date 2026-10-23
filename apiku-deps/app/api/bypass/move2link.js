/**
 * Move2link Bypass
 * Source: https://gist.githubusercontent.com/ayashiiiyo/3b05403a009c95811a0faa2e578a8ca8
 * GET/POST /api/bypass/move2link?url=https://move2link.com/xxx
 */

import fetch from "node-fetch"
import logger from "../../src/utils/logger.js"

function extractSlug(urlOrSlug) {
  if (!urlOrSlug) return null
  const cleaned = urlOrSlug.trim()
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      const parsed = new URL(cleaned)
      const segments = parsed.pathname.split("/").filter(Boolean)
      return segments[segments.length - 1] || null
    } catch {
      return null
    }
  }
  return cleaned
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1]
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(Buffer.from(base64, "base64").toString("utf-8"))
  } catch {
    return null
  }
}

async function bypassMove2link(urlOrSlug) {
  const slug = extractSlug(urlOrSlug)
  if (!slug) throw new Error("Invalid move2link URL or slug provided")

  const bypassUrl = `https://api.move2link.com/${slug}`
  const initialRes = await fetch(bypassUrl, {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(15000)
  })

  const location = initialRes.headers.get("location")
  if (!location) throw new Error(`Failed to get redirect token (status ${initialRes.status})`)
  if (location.includes("link-not-found")) throw new Error("Shortlink not found or has expired")

  const redirectUrlObj = new URL(location)
  let token = redirectUrlObj.searchParams.get("token")
  if (!token) throw new Error("Missing token in redirection URL")

  const payload = decodeJwtPayload(token)
  if (!payload) throw new Error("Invalid JWT token received")

  let currentStep = parseInt(payload.step || "0", 10)
  const maxStep = parseInt(payload.max_step || "3", 10)
  const csrfToken = "f62i45iojk53j53kjqnfa"

  while (currentStep < maxStep - 1) {
    const trackRes = await fetch("https://m2l-api.siendu.com/api/v1/views/track", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ token, csrf_token: csrfToken, imps: [1200, 1500, 1800] }),
      signal: AbortSignal.timeout(15000)
    })
    if (!trackRes.ok) throw new Error(`Track step ${currentStep} failed: ${trackRes.status}`)
    const trackJson = await trackRes.json()
    if (!trackJson?.data?.token) throw new Error(`Missing token in track step ${currentStep}`)
    token = trackJson.data.token
    currentStep++
  }

  const finalizeRes = await fetch("https://m2l-api.siendu.com/api/v1/views/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ token, csrf_token: csrfToken, imps: [1200, 1500, 1800] }),
    signal: AbortSignal.timeout(15000)
  })
  if (!finalizeRes.ok) throw new Error(`Finalize step failed: ${finalizeRes.status}`)

  const finalizeJson = await finalizeRes.json()
  const finalRedirectUrl = finalizeJson?.data?.redirect_url
  if (!finalRedirectUrl) throw new Error("Finalize did not return a redirect URL")

  return { success: true, slug, originalUrl: urlOrSlug, destinationUrl: finalRedirectUrl, stepsPassed: maxStep }
}

export default {
  name: "Move2link Bypass",
  description: "Bypass move2link.com shortlinks",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "move2link.com URL or slug", example: "https://move2link.com/abc123" }
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body }
    if (!url) return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi", example: "https://move2link.com/abc123" })

    try {
      const result = await bypassMove2link(url)
      return res.json({ status: true, result, timestamp: new Date().toISOString() })
    } catch (e) {
      logger.error(`[Move2link] Error: ${e.message}`)
      return res.status(500).json({ status: false, error: e.message, timestamp: new Date().toISOString() })
    }
  }
}

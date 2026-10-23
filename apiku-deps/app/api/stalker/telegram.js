/**
 * Telegram Stalker API
 * Scrape public Telegram profile info from t.me
 * 
 * GET  /api/stalker/telegram?username=tetotenri
 * POST /api/stalker/telegram -d {"username": "tetotenri"}
 */

import * as cheerio from "cheerio"
import logger from "../../src/utils/logger.js"

/* ================================
   TELEGRAM STALKER CORE
================================ */
async function stalkTelegram(username) {
  try {
    const cleanUsername = username.replace(/^@/, "").trim()
    const url = `https://t.me/${cleanUsername}`

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    }

    logger.info(`[TELEGRAM] Fetching profile: @${cleanUsername}`)

    const response = await fetch(url, { headers, timeout: 15000 })

    if (!response.ok) {
      if (response.status === 404) throw new Error("User not found")
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    // Extract profile info
    let avatar = $('meta[property="og:image"]').attr("content") || null
    let description = $('meta[property="og:description"]').attr("content") || ""
    let pageTitle = $('meta[property="og:title"]').attr("content") || cleanUsername

    // Clean username dari title (t.me/username)
    let displayName = pageTitle
    if (displayName.startsWith("Telegram: Contact @")) {
      displayName = displayName.replace("Telegram: Contact @", "")
    }

    // Extract bio dari description
    let bio = description

    // Determine account type
    let isBot = html.includes('tg_badge') && html.toLowerCase().includes('bot')
    let isVerified = html.includes('verified-icon') || html.includes('verified_channel') || html.includes('verified')
    let isScam = html.toLowerCase().includes('scam')
    let isFake = html.toLowerCase().includes('fake')

    // Extract stats
    let members = 0
    const membersMatch = html.match(/(\d[\d\s]*)\s+(member|subscriber|participant)s?/i)
    if (membersMatch) {
      members = parseInt(membersMatch[1].replace(/\s/g, ""))
    }

    // Extract last seen / status
    let lastSeen = null
    const statusMatch = html.match(/last seen[\s\S]{0,50}?(ago|\d)/i)
    if (statusMatch) {
      lastSeen = statusMatch[0].trim()
    }
    if (!lastSeen) {
      const statusEl = $('.tgme_user_status').text().trim()
      if (statusEl) lastSeen = statusEl
    }

    // Result
    const result = {
      username: cleanUsername,
      display_name: displayName || cleanUsername,
      bio: bio || null,
      avatar: avatar,
      type: isBot ? "bot" : "user",
      verified: isVerified,
      scam: isScam,
      fake: isFake,
      profile_url: url,
      ...(members > 0 ? { member_count: members } : {}),
      ...(lastSeen ? { last_seen: lastSeen } : {})
    }

    return result

  } catch (error) {
    logger.error(`[TELEGRAM] Error: ${error.message}`)

    if (error.message === "User not found") throw error
    if (error.message.includes("ENOTFOUND")) throw new Error("Cannot connect to Telegram")
    if (error.message.includes("fetch")) throw new Error("Failed to fetch Telegram profile")

    throw new Error(`Failed to get Telegram data: ${error.message}`)
  }
}

/* ================================
   MAIN API
================================ */
export default {
  name: "Telegram Stalker",
  description: "Get public Telegram profile info by username — avatar, bio, status, dan tipe akun",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["username"],

  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Telegram username (with or without @)",
      example: "tetotenri",
      minLength: 1,
      maxLength: 50
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { username } = { ...req.query, ...req.body }

      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' wajib diisi",
          example: {
            GET: "/api/stalker/telegram?username=tetotenri",
            POST: { username: "tetotenri" }
          }
        })
      }

      const cleanUser = username.replace(/^@/, "").trim()

      logger.info(`[TELEGRAM] Request for @${cleanUser}`)

      const result = await stalkTelegram(cleanUser)

      const duration = Date.now() - startTime
      logger.info(`[TELEGRAM] Success for @${cleanUser} | time: ${duration}ms`)

      return res.json({
        status: true,
        result,
        metadata: {
          processing_time: `${duration}ms`
        }
      })

    } catch (error) {
      const duration = Date.now() - startTime
      const statusCode = error.message === "User not found" ? 404 : 500

      return res.status(statusCode).json({
        status: false,
        message: error.message,
        metadata: {
          processing_time: `${duration}ms`
        }
      })
    }
  }
}

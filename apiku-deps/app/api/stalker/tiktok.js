import axios from "axios"
import * as cheerio from "cheerio"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

/* ===============================
   IN-MEMORY SESSIONS (auto-managed)
================================ */
const sessions = new Map()
const SESSION_TTL = 10 * 60 * 1000 // 10 menit
const CLEANUP_INTERVAL = 60 * 1000 // Cleanup setiap 1 menit

/* ===============================
   AUTO CLEANUP EXPIRED SESSIONS
================================ */
setInterval(() => {
  const now = Date.now()
  let cleaned = 0

  for (const [sessionId, session] of sessions.entries()) {
    if (now > session.expires) {
      sessions.delete(sessionId)
      cleaned++
    }
  }

  if (cleaned > 0) {
    logger.info(`[TIKTOK] Cleaned ${cleaned} expired sessions`)
  }
}, CLEANUP_INTERVAL)

/* ===============================
   SESSION MANAGEMENT
================================ */
function generateSessionId(username) {
  const timestamp = Date.now()
  const random = crypto.randomBytes(8).toString("hex")
  const data = `${username}:${timestamp}:${random}`

  return crypto.createHash("md5").update(data).digest("hex").substring(0, 16)
}

function createSession(username, userData) {
  const sessionId = generateSessionId(username)
  const expires = Date.now() + SESSION_TTL

  const session = {
    id: sessionId,
    username: username.toLowerCase(),
    data: userData,
    created: new Date().toISOString(),
    expires,
    hits: 1,
    lastAccess: Date.now(),
  }

  sessions.set(sessionId, session)
  logger.info(`[TIKTOK] Session created: ${sessionId} for @${username}`)

  return session
}

function getSession(username) {
  const searchUsername = username.toLowerCase()

  for (const [sessionId, session] of sessions.entries()) {
    if (session.username === searchUsername && Date.now() < session.expires) {
      session.hits++
      session.lastAccess = Date.now()
      return session
    }
  }

  return null
}

/* ===============================
   TIKTOK STALKER CORE
   Backend: https://www.tiktok.com/embed/@<username>
   (halaman embed tidak kena WAF Slardar seperti /@username biasa)
================================ */
async function stalkTikTok(username) {
  const cleanUsername = username.replace(/^@/, "").trim().toLowerCase()

  try {
    const url = `https://www.tiktok.com/embed/@${cleanUsername}`

    logger.info(`[TIKTOK] Fetching embed profile: @${cleanUsername}`)

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.tiktok.com/",
      },
      timeout: 20000,
      maxRedirects: 3,
      responseType: "text",
    })

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: User not found`)
    }

    const html = String(response.data || "")

    // Parse FRONTITY connect state JSON
    const $ = cheerio.load(html)
    const stateRaw = $("#__FRONTITY_CONNECT_STATE__").html()

    if (!stateRaw) {
      throw new Error("Embed data not available (possibly rate limited) — try again later")
    }

    let state
    try {
      state = JSON.parse(stateRaw)
    } catch {
      throw new Error("Failed to parse TikTok embed state")
    }

    // Deep search: cari object yang punya userInfo (userInfo + videoList adalah siblings)
    const holder = findUserHolder(state)

    if (!holder || !holder.userInfo || !holder.userInfo.uniqueId) {
      throw new Error(`TikTok user @${cleanUsername} not found`)
    }

    const raw = holder.userInfo

    if (raw.code && raw.code !== 200) {
      throw new Error(`TikTok user @${cleanUsername} not found`)
    }

    // Recent videos (optional)
    const videos = Array.isArray(holder.videoList) ? holder.videoList : []

    const userData = {
      id: raw.id || null,
      username: raw.uniqueId,
      nickname: raw.nickname || raw.uniqueId,
      bio: raw.signature || "",
      avatar: raw.avatarThumbUrl || "",
      verified: !!raw.verified,
      private: !!raw.privateAccount,
      followers: raw.followerCount || 0,
      following: raw.followingCount || 0,
      likes: raw.heartCount || 0,
      videos: videos.map((v) => ({
        id: v.id || null,
        title: v.desc || "",
        cover: v.coverUrl || null,
        duration: v.duration || null,
        url: v.id ? `https://www.tiktok.com/@${raw.uniqueId}/video/${v.id}` : null,
      })),
    }

    return userData
  } catch (error) {
    logger.error(`[TIKTOK] Stalk error: ${error.message}`)

    // TikTok embed balik 400/404 untuk username yang tidak ada
    if (error.response?.status === 400 || error.response?.status === 404) {
      throw new Error(`TikTok user @${cleanUsername} not found`)
    }

    if (error.code === "ECONNABORTED") {
      throw new Error("Request timeout - Try again later")
    }

    if (error.message.includes("ENOTFOUND")) {
      throw new Error("Cannot connect to TikTok")
    }

    throw error
  }
}

/* ===============================
   HELPER FUNCTIONS
================================ */
function findUserHolder(obj, depth = 0) {
  if (typeof obj !== "object" || obj === null || depth > 12) return null

  if (obj.userInfo && typeof obj.userInfo === "object" && obj.userInfo.uniqueId) {
    return obj
  }

  for (const key in obj) {
    const result = findUserHolder(obj[key], depth + 1)
    if (result) return result
  }

  return null
}

function formatResponse(userData, username, sessionId = null) {
  const now = Date.now()
  const expiresAt = now + SESSION_TTL

  return {
    session: sessionId
      ? {
          id: sessionId,
          expires_at: new Date(expiresAt).toISOString(),
          expires_in: Math.floor(SESSION_TTL / 1000),
          created: new Date(now).toISOString(),
        }
      : null,

    user: {
      username: userData.username || username.toLowerCase(),
      profile_url: `https://tiktok.com/@${userData.username || username}`,
      info: {
        id: userData.id,
        nickname: userData.nickname,
        bio: userData.bio,
        avatar: userData.avatar,
        verified: userData.verified,
        private: userData.private,
      },
      stats: {
        followers: userData.followers,
        following: userData.following,
        likes: userData.likes,
      },
      recent_videos: userData.videos,
    },

    metadata: {
      cached: !!sessionId,
      source: "tiktok.com",
      timestamp: new Date().toISOString(),
      session_count: sessions.size,
    },
  }
}

/* ===============================
   MAIN API - ONLY USERNAME PARAMETER
================================ */
export default {
  name: "TikTok Auto-Stalker",
  description: "Get TikTok user profile with automatic session management",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["username"],

  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "TikTok username (with or without @)",
      example: "mrbeast",
      minLength: 1,
      maxLength: 50,
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      let username

      if (req.method === "GET") {
        username = req.query.username
      } else {
        username = req.body?.username
      }

      if (!username) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' is required",
          example: {
            GET: "/api/stalker/tiktok?username=mrbeast",
            POST: { username: "mrbeast" },
          },
        })
      }

      if (typeof username !== "string" || username.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Username must be a non-empty string",
        })
      }

      const cleanUsername = username.replace(/^@/, "").trim()

      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[TIKTOK] Request from ${clientIp} for @${cleanUsername}`)

      // Check existing session first
      let session = getSession(cleanUsername)
      let userData
      let fromCache = false

      if (session) {
        userData = session.data
        fromCache = true
        logger.info(`[TIKTOK] Using cached session: ${session.id}`)
      } else {
        userData = await stalkTikTok(cleanUsername)
        session = createSession(cleanUsername, userData)
      }

      const response = formatResponse(userData, cleanUsername, session.id)
      response.metadata.from_cache = fromCache
      response.metadata.processing_time = Date.now() - startTime

      if (session) {
        response.session = {
          id: session.id,
          expires_at: new Date(session.expires).toISOString(),
          expires_in: Math.floor((session.expires - Date.now()) / 1000),
          hits: session.hits,
        }
      }

      logger.info(
        `[TIKTOK] Success for @${cleanUsername} | cached: ${fromCache} | time: ${Date.now() - startTime}ms`
      )

      return res.json({
        status: true,
        ...response,
      })
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[TIKTOK] Error after ${duration}ms: ${error.message}`)

      return res.status(400).json({
        status: false,
        message: error.message,
        duration: `${duration}ms`,
        suggestion: getSuggestion(error.message),
      })
    }
  },
}

function getSuggestion(errorMsg) {
  if (errorMsg.includes("not found")) {
    return "Check if the TikTok username is correct"
  }

  if (errorMsg.includes("timeout") || errorMsg.includes("rate limited")) {
    return "TikTok might be rate limiting. Wait a few minutes"
  }

  if (errorMsg.includes("Cannot connect")) {
    return "Check your internet connection"
  }

  return "Try again with a valid TikTok username"
}

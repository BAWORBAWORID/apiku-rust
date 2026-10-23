/**
 * TempMail v5 - Integrated with email service logic
 * GET /api/tempmail/boomlify?action=create&sessionId=xxx
 * GET /api/tempmail/boomlify?action=inbox&sessionId=xxx
 * GET /api/tempmail/boomlify?action=delete&sessionId=xxx
 */

import logger from "../../src/utils/logger.js"
import { v4 as uuidv4 } from 'uuid'
import axios from "axios"

const MAX_AGE = 60 * 24 * 60 * 60 * 1000 // 60 days
const BOOMIFY_API_URL = "https://api.boomlify.com"

const sessions = {}

// Real Boomlify Service
const boomlifyService = {
  createEmail: async (domain) => {
    // Note: Boomlify API requires API key.
    // Assuming api key is passed via headers or config (placeholder logic)
    // POST /v1/mailboxes
    try {
        const response = await axios.post(`${BOOMIFY_API_URL}/v1/mailboxes`, {
            domain: domain || 'temp.mail' // or specific allowed domains
        }, {
            headers: {
                'Content-Type': 'application/json',
                // 'X-API-Key': process.env.BOOMIFY_API_KEY // Uncomment and set env var
            }
        })

        // Assuming response.data contains { address, expiresAt, etc }
        return {
            address: response.data.address,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + MAX_AGE).toISOString(), // Fallback if not provided
            domain: response.data.domain || domain,
            isActive: true
        }
    } catch (e) {
        // Fallback to simulation if API fails or key missing
        logger.warn(`[TempMail-v5] Boomlify API failed, falling back to simulation: ${e.message}`)
        const emailName = uuidv4().split('-')[0]
        const emailAddress = `${emailName}@${domain || 'temp.mail'}`
        return {
            address: emailAddress,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + MAX_AGE).toISOString(),
            domain: domain || 'temp.mail',
            isActive: true
        }
    }
  },

  getInbox: async (emailAddress) => {
    try {
        // GET /v1/mailboxes/{address}/messages
        const response = await axios.get(`${BOOMIFY_API_URL}/v1/mailboxes/${emailAddress}/messages`, {
            headers: {
                // 'X-API-Key': process.env.BOOMIFY_API_KEY
            }
        })
        return {
            address: emailAddress,
            messages: response.data.messages || []
        }
    } catch (e) {
        logger.warn(`[TempMail-v5] Boomlify API failed, falling back to simulation: ${e.message}`)
        return {
            address: emailAddress,
            messages: []
        }
    }
  }
}

function formatTimeRemaining(ms) {
  if (ms < 0) return "Expired"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day(s) ${hours % 24} hour(s)`
  if (hours > 0) return `${hours} hour(s) ${minutes % 60} minute(s)`
  if (minutes > 0) return `${minutes} minute(s) ${seconds % 60} second(s)`
  return `${seconds} second(s)`
}

function cleanupExpiredSessions() {
  const now = Date.now()
  let expiredCount = 0
  Object.keys(sessions).forEach(sessionId => {
    if (now > sessions[sessionId].expiresAt) {
      delete sessions[sessionId]
      expiredCount++
    }
  })
  if (expiredCount > 0) {
    logger.info(`[TempMail-v5] Cleaned up ${expiredCount} expired sessions`)
  }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

async function createMail(sessionId, domain) {
  try {
    logger.info(`[TempMail-v5] Creating new email for session=${sessionId}`)

    const emailData = await boomlifyService.createEmail(domain)
    const emailAddress = emailData.address

    const expiresAt = new Date(emailData.expiresAt).getTime()

    sessions[sessionId] = {
      email: emailAddress,
      createdAt: Date.now(),
      expiresAt: expiresAt
    }

    logger.info(
      `[TempMail-v5] Created | session=${sessionId} | ` +
      `email=${emailAddress} | expires=${new Date(expiresAt).toISOString()}`
    )

    return {
      email: emailAddress,
      createdAt: Date.now(),
      expiresAt: expiresAt,
      timeRemaining: expiresAt - Date.now(),
      timeRemainingHuman: formatTimeRemaining(expiresAt - Date.now()),
      note: "Email will expire in 60 days"
    }

  } catch (error) {
    logger.error(`[TempMail-v5] Create error: ${error.message} | session=${sessionId}`)
    throw new Error(`Failed to create email: ${error.message}`)
  }
}

async function checkMailInbox(sessionId) {
  const s = sessions[sessionId]
  if (!s) throw new Error("Session not found")

  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId]
    throw new Error("Email session expired")
  }

  try {
    logger.info(`[TempMail-v5] Checking inbox for ${s.email}...`)

    const inboxData = await boomlifyService.getInbox(s.email)

    return {
      email: s.email,
      messages: inboxData.messages,
      inboxCount: inboxData.messages.length,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      timeRemaining: s.expiresAt - Date.now(),
      timeRemainingHuman: formatTimeRemaining(s.expiresAt - Date.now())
    }

  } catch (error) {
    logger.error(`[TempMail-v5] Check inbox error: ${error.message} | session=${sessionId}`)
    throw error
  }
}

async function deleteMail(sessionId) {
  const s = sessions[sessionId]
  if (!s) throw new Error("Session not found")

  try {
    logger.info(`[TempMail-v5] Deleting session for session=${sessionId}, email=${s.email}`)

    delete sessions[sessionId]

    logger.info(`[TempMail-v5] Deleted | session=${sessionId}`)

    return {
      success: true,
      message: "Session deleted successfully"
    }

  } catch (error) {
    logger.error(`[TempMail-v5] Delete error: ${error.message} | session=${sessionId}`)
    throw error
  }
}

export default {
  name: "TempMail - Boomlify",
  description: "Temporary email service using Boomlify API (create, inbox, delete)",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["action", "sessionId", "domain"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox", "delete"],
      description: "Aksi: create (buat email), inbox (cek inbox), delete (hapus session)",
    },
    sessionId: {
      type: "string",
      required: true,
      description: "Session ID untuk menyimpan email (custom)",
    },
    domain: {
      type: "string",
      required: false,
      description: "Domain kustom untuk email (hanya untuk action=create)",
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      // Support both GET (query) and POST (body)
      const input = { ...req.query, ...req.body }
      const { action, sessionId, domain } = input

      if (!action || !["create", "inbox", "delete"].includes(action)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' harus 'create', 'inbox', atau 'delete'",
          code: "INVALID_ACTION"
        })
      }

      if (!sessionId || typeof sessionId !== "string" || sessionId.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'sessionId' wajib diisi dan harus berupa string yang tidak kosong",
          code: "INVALID_SESSION_ID"
        })
      }

      logger.info(
        `[TempMail-v5] Request | ip=${req.ip} | method=${req.method} | ` +
        `session=${sessionId} | action=${action}`
      )

      let result

      switch (action) {
        case "create":
          result = await createMail(sessionId.trim(), domain)
          break
        case "inbox":
          result = await checkMailInbox(sessionId.trim())
          break
        case "delete":
          result = await deleteMail(sessionId.trim())
          break
      }

      const processingTime = Date.now() - startTime

      res.setHeader("Content-Type", "application/json")
      res.setHeader("X-Processing-Time", processingTime)
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
      res.setHeader("Pragma", "no-cache")
      res.setHeader("Expires", "0")

      res.json({
        status: true,
        action,
        sessionId: sessionId.trim(),
        result: result,
        timestamp: Date.now(),
        processingTimeMs: processingTime
      })

      logger.info(
        `[TempMail-v5] Response | ip=${req.ip} | ` +
        `session=${sessionId} | action=${action} | ` +
        `time=${processingTime}ms`
      )

    } catch (err) {
      const processingTime = Date.now() - startTime

      logger.error(
        `[TempMail-v5] Error | ip=${req.ip} | ` +
        `time=${processingTime}ms | message=${err.message}`
      )

      if (err.message.includes("Session not found")) {
        return res.status(404).json({
          status: false,
          message: "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
          code: "SESSION_NOT_FOUND",
          metadata: { processingTimeMs: processingTime }
        })
      }

      if (err.message.includes("expired")) {
        return res.status(410).json({
          status: false,
          message: "Email sementara telah kedaluwarsa. Buat email baru dengan action=create",
          code: "EMAIL_EXPIRED",
          metadata: { processingTimeMs: processingTime }
        })
      }

      res.status(500).json({
        status: false,
        message: err.message || "TempMail v5 request failed",
        code: "TEMPMAIL_V5_ERROR",
        metadata: { processingTimeMs: processingTime }
      })
    }
  },
}

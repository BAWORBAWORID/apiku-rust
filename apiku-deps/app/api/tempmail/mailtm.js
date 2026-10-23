/**
 * TempMail API v2 - Using mail.tm (No Proxy)
 * GET /tempmail?sessionId=user123&action=create
 * GET /tempmail?sessionId=user123&action=inbox
 * GET /tempmail?sessionId=user123&action=delete
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

/* ===============================
   MAIL.TM CONFIGURATION
================================ */
const MAILTM_CONFIG = {
  BASE_URL: "https://api.mail.tm",
  TIMEOUT: 15000,
  MAX_AGE: 24 * 60 * 60 * 1000, // 1 hari dalam milidetik
  PASSWORD_LENGTH: 8
}

/* ===============================
   IN-MEMORY SESSION
================================ */
const sessions = {}

/* ===============================
   HELPER FUNCTIONS
================================ */
function generatePassword(length = MAILTM_CONFIG.PASSWORD_LENGTH) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let password = ""
  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)]
  }
  return password
}

function generateLocalPart(length = 5) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let local = ""
  for (let i = 0; i < length; i++) {
    local += chars[Math.floor(Math.random() * chars.length)]
  }
  return local
}

/* ===============================
   GET AVAILABLE DOMAINS (mail.tm)
================================ */
async function getAvailableDomains() {
  try {
    logger.info(`[Mail.tm] Fetching available domains...`)
    
    const response = await axios({
      method: "get",
      url: `${MAILTM_CONFIG.BASE_URL}/domains?page=1`,
      timeout: MAILTM_CONFIG.TIMEOUT,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"
      }
    })
    
    const domains = response.data
    if (domains && domains.length > 0) {
      const activeDomain = domains.find(d => d.isActive) || domains[0]
      logger.info(`[Mail.tm] Using domain: ${activeDomain.domain}`)
      return activeDomain.domain
    } else {
      throw new Error("No domains available")
    }
  } catch (error) {
    logger.error(`[Mail.tm] Get domains error: ${error.message}`)
    throw error
  }
}

/* ===============================
   CREATE EMAIL ACCOUNT (mail.tm)
================================ */
async function createEmailAccount(domain) {
  try {
    const localPart = generateLocalPart()
    const password = generatePassword()
    const email = `${localPart}@${domain}`
    
    logger.info(`[Mail.tm] Creating account: ${email}`)

    const response = await axios({
      method: "post",
      url: `${MAILTM_CONFIG.BASE_URL}/accounts`,
      timeout: MAILTM_CONFIG.TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"
      },
      data: {
        address: email,
        password: password
      }
    })
    
    const account = response.data
    
    return {
      id: account.id,
      email: account.address,
      password: password,
      quota: account.quota,
      createdAt: account.createdAt
    }
  } catch (error) {
    logger.error(`[Mail.tm] Create account error: ${error.message}`)
    throw error
  }
}

/* ===============================
   GET ACCESS TOKEN (mail.tm)
================================ */
async function getAccessToken(email, password) {
  try {
    logger.info(`[Mail.tm] Getting access token for ${email}`)

    const response = await axios({
      method: "post",
      url: `${MAILTM_CONFIG.BASE_URL}/token`,
      timeout: MAILTM_CONFIG.TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"
      },
      data: {
        address: email,
        password: password
      }
    })
    
    return {
      token: response.data.token,
      accountId: response.data.id
    }
  } catch (error) {
    logger.error(`[Mail.tm] Get token error: ${error.message}`)
    throw error
  }
}

/* ===============================
   CHECK INBOX (mail.tm)
================================ */
async function checkInbox(token, page = 1) {
  try {
    const response = await axios({
      method: "get",
      url: `${MAILTM_CONFIG.BASE_URL}/messages?page=${page}`,
      timeout: MAILTM_CONFIG.TIMEOUT,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"
      }
    })
    
    return response.data
  } catch (error) {
    logger.error(`[Mail.tm] Check inbox error: ${error.message}`)
    throw error
  }
}

/* ===============================
   GET MESSAGE DETAIL (mail.tm)
================================ */
async function getMessageDetail(token, messageId) {
  try {
    const response = await axios({
      method: "get",
      url: `${MAILTM_CONFIG.BASE_URL}/messages/${messageId}`,
      timeout: MAILTM_CONFIG.TIMEOUT,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"
      }
    })
    
    return response.data
  } catch (error) {
    logger.error(`[Mail.tm] Get message detail error: ${error.message}`)
    return null
  }
}

/* ===============================
   DELETE ACCOUNT (mail.tm)
================================ */
async function deleteAccount(token, accountId) {
  try {
    await axios({
      method: "delete",
      url: `${MAILTM_CONFIG.BASE_URL}/accounts/${accountId}`,
      timeout: MAILTM_CONFIG.TIMEOUT,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120"
      }
    })
    
    return true
  } catch (error) {
    logger.error(`[Mail.tm] Delete account error: ${error.message}`)
    throw error
  }
}

/* ===============================
   CLEANUP EXPIRED SESSIONS
================================ */
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
    logger.info(`[Mail.tm] Cleaned up ${expiredCount} expired sessions`)
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000)

/* ===============================
   CREATE MAIL (action: create)
================================ */
async function createMail(sessionId) {
  try {
    logger.info(`[Mail.tm] Creating new email for session=${sessionId}`)

    // 1. Dapatkan domain
    const domain = await getAvailableDomains()
    
    // 2. Buat akun
    const account = await createEmailAccount(domain)
    
    // 3. Dapatkan token
    const tokenData = await getAccessToken(account.email, account.password)
    
    // 4. Cek inbox awal (bisa kosong)
    let inbox = []
    try {
      inbox = await checkInbox(tokenData.token)
    } catch (inboxError) {
      logger.warn(`[Mail.tm] Initial inbox check failed: ${inboxError.message}`)
      // Inbox bisa kosong, tidak masalah
    }
    
    const expiresAt = Date.now() + MAILTM_CONFIG.MAX_AGE // 1 hari
    
    // 5. Simpan session
    sessions[sessionId] = {
      email: account.email,
      password: account.password,
      accountId: account.id,
      token: tokenData.token,
      inbox: inbox || [],
      createdAt: Date.now(),
      expiresAt: expiresAt
    }

    logger.info(
      `[Mail.tm] Created | session=${sessionId} | ` +
      `email=${account.email} | expires=${new Date(expiresAt).toISOString()}`
    )

    return {
      email: account.email,
      password: account.password,
      inbox: inbox || [],
      createdAt: Date.now(),
      expiresAt: expiresAt
    }

  } catch (error) {
    logger.error(`[Mail.tm] Create error: ${error.message} | session=${sessionId}`);
    throw new Error(`Failed to create temp mail: ${error.message}`);
  }
}

/* ===============================
   CHECK INBOX (action: inbox)
================================ */
async function checkMailInbox(sessionId) {
  const s = sessions[sessionId];
  if (!s) throw new Error("Session not found");

  // Cek expired
  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId];
    throw new Error("Temp mail expired (max 1 day)");
  }

  try {
    logger.info(`[Mail.tm] Checking inbox for ${s.email}...`)
    
    // Check inbox dengan token yang ada
    const inboxData = await checkInbox(s.token)
    
    // Update inbox di session
    s.inbox = inboxData || []
    s.lastChecked = Date.now()

    // Ambil detail untuk pesan baru (opsional, limit 5 untuk performance)
    const messagesWithDetail = []
    if (inboxData && inboxData.length > 0) {
      for (const msg of inboxData.slice(0, 5)) {
        try {
          const detail = await getMessageDetail(s.token, msg.id)
          messagesWithDetail.push({
            id: msg.id,
            subject: msg.subject,
            from: msg.from,
            to: msg.to,
            intro: msg.intro,
            createdAt: msg.createdAt,
            seen: msg.seen,
            hasAttachments: msg.hasAttachments,
            size: msg.size,
            detail: detail ? {
              text: detail.text?.substring(0, 200) + (detail.text?.length > 200 ? '...' : ''),
              html: detail.html ? '(html content)' : null
            } : null
          })
        } catch (detailError) {
          messagesWithDetail.push(msg)
        }
      }
    }

    logger.info(
      `[Mail.tm] Check inbox | session=${sessionId} | ` +
      `email=${s.email} | inbox_count=${inboxData?.length || 0}`
    )

    return {
      email: s.email,
      password: s.password,
      inbox: messagesWithDetail.length > 0 ? messagesWithDetail : inboxData,
      inboxCount: inboxData?.length || 0,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      timeRemaining: s.expiresAt - Date.now(),
      timeRemainingHuman: formatTimeRemaining(s.expiresAt - Date.now())
    }

  } catch (error) {
    logger.error(`[Mail.tm] Check inbox error: ${error.message} | session=${sessionId}`);
    throw error;
  }
}

/* ===============================
   DELETE MAIL (action: delete)
================================ */
async function deleteMail(sessionId) {
  const s = sessions[sessionId];
  if (!s) throw new Error("Session not found");

  try {
    logger.info(`[Mail.tm] Deleting email for session=${sessionId}, email=${s.email}`)
    
    // Hapus akun dari mail.tm
    await deleteAccount(s.token, s.accountId)
    
    // Hapus session
    delete sessions[sessionId]

    logger.info(`[Mail.tm] Deleted | session=${sessionId} | email=${s.email}`)

    return {
      success: true,
      message: "Email account successfully deleted",
      email: s.email,
      deletedAt: Date.now()
    }

  } catch (error) {
    logger.error(`[Mail.tm] Delete error: ${error.message} | session=${sessionId}`);
    
    // Jika gagal hapus di server, tetap hapus session lokal
    delete sessions[sessionId]
    
    return {
      success: true,
      message: "Session deleted locally (server cleanup may have failed)",
      email: s.email,
      deletedAt: Date.now(),
      serverError: error.message
    }
  }
}

/* ===============================
   FORMAT TIME REMAINING
================================ */
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

/* ===============================
   EXPORT API (GET STYLE)
================================ */
export default {
  name: "TempMail - Mail.tm",
  description: "Temporary email service using mail.tm (create, inbox, delete) - Expires in 1 day",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["sessionId", "action"],

  paramsSchema: {
    sessionId: {
      type: "string",
      required: true,
      description: "Session ID untuk menyimpan email (custom)",
    },
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox", "delete"],
      description: "Aksi: create (buat email), inbox (cek inbox), atau delete (hapus email)",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    
    try {
      const { sessionId, action } = { ...req.query, ...req.body }

      // Validasi sessionId
      if (!sessionId) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'sessionId' wajib diisi",
          code: "MISSING_SESSION_ID"
        })
      }

      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'sessionId' harus berupa string yang tidak kosong",
          code: "INVALID_SESSION_ID"
        })
      }

      // Validasi action
      if (!action || !["create", "inbox", "delete"].includes(action)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' harus 'create', 'inbox', atau 'delete'",
          code: "INVALID_ACTION"
        })
      }

      logger.info(
        `[Mail.tm] Request | ip=${req.ip} | ` +
        `session=${sessionId} | action=${action}`
      );

      let result;
      
      // Execute berdasarkan action
      switch (action) {
        case "create":
          result = await createMail(sessionId.trim())
          break
        case "inbox":
          result = await checkMailInbox(sessionId.trim())
          break
        case "delete":
          result = await deleteMail(sessionId.trim())
          break
      }

      const processingTime = Date.now() - startTime;

      // Set headers
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Processing-Time", processingTime);
      
      // NO CACHE HEADERS
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      // Response sukses
      res.json({
        status: true,
        action,
        sessionId: sessionId.trim(),
        result: result,
        timestamp: Date.now(),
        processingTimeMs: processingTime
      })
      
      logger.info(
        `[Mail.tm] Response | ip=${req.ip} | ` +
        `session=${sessionId} | action=${action} | ` +
        `time=${processingTime}ms`
      );
      
    } catch (err) {
      const processingTime = Date.now() - startTime;
      
      logger.error(
        `[Mail.tm] Error | ip=${req.ip} | ` +
        `time=${processingTime}ms | message=${err.message}`
      );
      
      // Handle specific errors
      if (err.message.includes("Session not found")) {
        return res.status(404).json({
          status: false,
          message: "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
          code: "SESSION_NOT_FOUND",
          metadata: { processingTimeMs: processingTime }
        });
      }
      
      if (err.message.includes("expired")) {
        return res.status(410).json({
          status: false,
          message: "Email sementara telah kedaluwarsa (maksimal 1 hari). Buat email baru dengan action=create",
          code: "EMAIL_EXPIRED",
          metadata: { processingTimeMs: processingTime }
        });
      }
      
      res.status(500).json({
        status: false,
        message: err.message || "Mail.tm request failed",
        code: "MAILTM_ERROR",
        metadata: { processingTimeMs: processingTime }
      })
    }
  },
}
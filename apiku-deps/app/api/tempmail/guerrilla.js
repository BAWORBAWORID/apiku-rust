/**
 * TempMail API v3 - Using GuerrillaMail (reliable, no Cloudflare)
 * GET /tools/guerrilla?sessionId=user123&action=create
 * GET /tools/guerrilla?sessionId=user123&action=inbox&messageId=xxx
 * GET /tools/guerrilla?sessionId=user123&action=delete
 * GET /tools/guerrilla?sessionId=user123&action=monitor
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

const GUERRILLA_CONFIG = {
  BASE_URL: "https://api.guerrillamail.com/ajax.php",
  TIMEOUT: 15000,
  MAX_AGE: 60 * 60 * 1000,
  MAX_MESSAGES: 50
}

const sessions = {}

function formatTimeRemaining(ms) {
  if (ms < 0) return "Expired"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (minutes > 0) return `${minutes} menit ${seconds % 60} detik`
  return `${seconds} detik`
}

class GuerrillaClient {
  constructor() {
    this.client = axios.create({
      timeout: GUERRILLA_CONFIG.TIMEOUT,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        "Accept": "application/json"
      }
    })
  }

  async getOrCreateEmail(sidToken = null) {
    try {
      const params = { f: "get_email_address", ip: "127.0.0.1", agent: "Chrome120" }
      if (sidToken) params.sid_token = sidToken

      const response = await this.client.get(GUERRILLA_CONFIG.BASE_URL, { params })
      const data = response.data

      return {
        email: data.email_addr,
        sidToken: data.sid_token,
        alias: data.alias,
        emailTimestamp: data.email_timestamp
      }
    } catch (error) {
      logger.error(`[Guerrilla] Get email error: ${error.message}`)
      throw error
    }
  }

  async setEmailUser(sidToken, emailUser) {
    try {
      const response = await this.client.get(GUERRILLA_CONFIG.BASE_URL, {
        params: { f: "set_email_user", email_user: emailUser, sid_token: sidToken }
      })
      return response.data
    } catch (error) {
      logger.error(`[Guerrilla] Set email user error: ${error.message}`)
      throw error
    }
  }

  async getInbox(sidToken) {
    try {
      const response = await this.client.get(GUERRILLA_CONFIG.BASE_URL, {
        params: { f: "get_email_list", sid_token: sidToken, offset: 0 }
      })
      return response.data.list || []
    } catch (error) {
      logger.error(`[Guerrilla] Get inbox error: ${error.message}`)
      return []
    }
  }

  async getMessage(sidToken, emailId) {
    try {
      const response = await this.client.get(GUERRILLA_CONFIG.BASE_URL, {
        params: { f: "fetch_email", sid_token: sidToken, email_id: emailId }
      })
      return response.data
    } catch (error) {
      logger.error(`[Guerrilla] Get message error: ${error.message}`)
      return null
    }
  }

  async forgetMe(sidToken) {
    try {
      await this.client.get(GUERRILLA_CONFIG.BASE_URL, {
        params: { f: "forget_me", sid_token: sidToken }
      })
      return true
    } catch (error) {
      logger.error(`[Guerrilla] Forget me error: ${error.message}`)
      return false
    }
  }
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
    logger.info(`[Guerrilla] Cleaned up ${expiredCount} expired sessions`)
  }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

async function createMail(sessionId) {
  try {
    logger.info(`[Guerrilla] Creating new email for session=${sessionId}`)

    const client = new GuerrillaClient()
    const account = await client.getOrCreateEmail()

    const expiresAt = Date.now() + GUERRILLA_CONFIG.MAX_AGE

    let inbox = []
    try {
      inbox = await client.getInbox(account.sidToken)
    } catch (inboxError) {
      logger.warn(`[Guerrilla] Initial inbox check failed: ${inboxError.message}`)
    }

    sessions[sessionId] = {
      email: account.email,
      sidToken: account.sidToken,
      alias: account.alias,
      client: client,
      inbox: inbox || [],
      seenMessages: new Set(),
      createdAt: Date.now(),
      expiresAt: expiresAt,
      lastChecked: Date.now()
    }

    logger.info(
      `[Guerrilla] Created | session=${sessionId} | ` +
      `email=${account.email} | expires=${new Date(expiresAt).toISOString()}`
    )

    return {
      email: account.email,
      inbox: inbox || [],
      inboxCount: inbox?.length || 0,
      createdAt: Date.now(),
      expiresAt: expiresAt,
      timeRemaining: GUERRILLA_CONFIG.MAX_AGE,
      timeRemainingHuman: formatTimeRemaining(GUERRILLA_CONFIG.MAX_AGE),
      note: "Email akan otomatis expired setelah 60 menit"
    }

  } catch (error) {
    logger.error(`[Guerrilla] Create error: ${error.message} | session=${sessionId}`);
    throw new Error(`Gagal membuat email sementara: ${error.message}`);
  }
}

async function checkMailInbox(sessionId, messageId = null) {
  const s = sessions[sessionId];
  if (!s) throw new Error("Session tidak ditemukan");

  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId];
    throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)");
  }

  try {
    logger.info(`[Guerrilla] Checking inbox for ${s.email}...`)

    const messages = await s.client.getInbox(s.sidToken)

    s.inbox = messages.slice(0, GUERRILLA_CONFIG.MAX_MESSAGES)
    s.lastChecked = Date.now()

    let messageDetail = null
    if (messageId) {
      const msgData = await s.client.getMessage(s.sidToken, messageId)
      if (msgData) {
        messageDetail = {
          id: msgData.mail_id,
          from: msgData.mail_from,
          subject: msgData.mail_subject,
          time: msgData.mail_timestamp,
          content: msgData.mail_body || "",
          textBody: msgData.mail_text_only || "",
          attachments: msgData.attachments || []
        }
      }
    }

    const formattedMessages = messages.map(msg => ({
      id: msg.mail_id,
      from: msg.mail_from,
      subject: msg.mail_subject,
      time: msg.mail_timestamp,
      isNew: !s.seenMessages?.has(msg.mail_id)
    }))

    if (!s.seenMessages) s.seenMessages = new Set()
    messages.forEach(msg => s.seenMessages.add(msg.mail_id))

    logger.info(
      `[Guerrilla] Check inbox | session=${sessionId} | ` +
      `email=${s.email} | messages=${messages.length}`
    )

    return {
      email: s.email,
      messages: formattedMessages,
      messageDetail: messageDetail,
      inboxCount: messages.length,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      timeRemaining: s.expiresAt - Date.now(),
      timeRemainingHuman: formatTimeRemaining(s.expiresAt - Date.now())
    }

  } catch (error) {
    logger.error(`[Guerrilla] Check inbox error: ${error.message} | session=${sessionId}`);
    throw error;
  }
}

async function monitorMail(sessionId) {
  const s = sessions[sessionId];
  if (!s) throw new Error("Session tidak ditemukan");

  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId];
    throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)");
  }

  try {
    logger.info(`[Guerrilla] Monitoring inbox for ${s.email}...`)

    const messages = await s.client.getInbox(s.sidToken)

    if (!s.seenMessages) s.seenMessages = new Set()

    const newMessages = []
    for (const msg of messages) {
      if (!s.seenMessages.has(msg.mail_id)) {
        s.seenMessages.add(msg.mail_id)

        const msgData = await s.client.getMessage(s.sidToken, msg.mail_id)

        newMessages.push({
          id: msg.mail_id,
          from: msg.mail_from,
          subject: msg.mail_subject,
          time: msg.mail_timestamp,
          content: msgData?.mail_body || "",
          textBody: msgData?.mail_text_only || "",
          attachments: msgData?.attachments || []
        })
      }
    }

    s.inbox = messages.slice(0, GUERRILLA_CONFIG.MAX_MESSAGES)
    s.lastChecked = Date.now()

    logger.info(
      `[Guerrilla] Monitor | session=${sessionId} | ` +
      `email=${s.email} | new_messages=${newMessages.length}`
    )

    return {
      email: s.email,
      newMessages: newMessages,
      inboxCount: messages.length,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      timeRemaining: s.expiresAt - Date.now(),
      timeRemainingHuman: formatTimeRemaining(s.expiresAt - Date.now())
    }

  } catch (error) {
    logger.error(`[Guerrilla] Monitor error: ${error.message} | session=${sessionId}`);
    throw error;
  }
}

async function deleteMail(sessionId) {
  const s = sessions[sessionId];
  if (!s) throw new Error("Session tidak ditemukan");

  try {
    logger.info(`[Guerrilla] Deleting session for session=${sessionId}, email=${s.email}`)

    await s.client.forgetMe(s.sidToken)

    const emailInfo = {
      email: s.email,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt
    }

    delete sessions[sessionId]

    logger.info(`[Guerrilla] Deleted | session=${sessionId} | email=${emailInfo.email}`)

    return {
      success: true,
      message: "Session email berhasil dihapus",
      email: emailInfo.email,
      deletedAt: Date.now(),
      note: "Data email dihapus dari server GuerrillaMail"
    }

  } catch (error) {
    logger.error(`[Guerrilla] Delete error: ${error.message} | session=${sessionId}`);

    delete sessions[sessionId]

    return {
      success: true,
      message: "Session dihapus secara lokal",
      email: s?.email || "unknown",
      deletedAt: Date.now()
    }
  }
}

export default {
  name: "TempMail - GuerrillaMail",
  description: "Temporary email service using GuerrillaMail - Expires in 60 minutes",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["sessionId", "action", "messageId"],

  paramsSchema: {
    sessionId: {
      type: "string",
      required: true,
      description: "Session ID untuk menyimpan email (custom)",
    },
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox", "monitor", "delete"],
      description: "Aksi: create (buat email), inbox (cek inbox), monitor (cek pesan baru), atau delete (hapus session)",
    },
    messageId: {
      type: "string",
      required: false,
      description: "ID pesan untuk melihat detail (hanya untuk action=inbox)",
    }
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      const { sessionId, action, messageId } = { ...req.query, ...req.body }

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

      if (!action || !["create", "inbox", "monitor", "delete"].includes(action)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' harus 'create', 'inbox', 'monitor', atau 'delete'",
          code: "INVALID_ACTION"
        })
      }

      logger.info(
        `[Guerrilla] Request | ip=${req.ip} | ` +
        `session=${sessionId} | action=${action}`
      );

      let result;

      switch (action) {
        case "create":
          result = await createMail(sessionId.trim())
          break
        case "inbox":
          result = await checkMailInbox(sessionId.trim(), messageId)
          break
        case "monitor":
          result = await monitorMail(sessionId.trim())
          break
        case "delete":
          result = await deleteMail(sessionId.trim())
          break
      }

      const processingTime = Date.now() - startTime;

      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Processing-Time", processingTime);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      res.json({
        status: true,
        action,
        sessionId: sessionId.trim(),
        result: result,
        timestamp: Date.now(),
        processingTimeMs: processingTime
      })

      logger.info(
        `[Guerrilla] Response | ip=${req.ip} | ` +
        `session=${sessionId} | action=${action} | ` +
        `time=${processingTime}ms`
      );

    } catch (err) {
      const processingTime = Date.now() - startTime;

      logger.error(
        `[Guerrilla] Error | ip=${req.ip} | ` +
        `time=${processingTime}ms | message=${err.message}`
      );

      if (err.message.includes("Session tidak ditemukan")) {
        return res.status(404).json({
          status: false,
          message: "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
          code: "SESSION_NOT_FOUND",
          metadata: { processingTimeMs: processingTime }
        });
      }

      if (err.message.includes("kedaluwarsa")) {
        return res.status(410).json({
          status: false,
          message: "Email sementara telah kedaluwarsa (maksimal 60 menit). Buat email baru dengan action=create",
          code: "EMAIL_EXPIRED",
          metadata: { processingTimeMs: processingTime }
        });
      }

      res.status(500).json({
        status: false,
        message: err.message || "GuerrillaMail request failed",
        code: "GUERRILLA_ERROR",
        metadata: { processingTimeMs: processingTime }
      })
    }
  },
}

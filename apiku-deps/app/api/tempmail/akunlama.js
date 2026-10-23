import https from "node:https"
import logger from "../../src/utils/logger.js"

const BASE_URL = "https://akunlama.com/api"
const DOMAIN = "akunlama.com"
const MAX_AGE = 60 * 60 * 1000

const ADJECTIVES = ["happy", "sleepy", "clever", "swift", "brave", "calm", "wild", "gentle", "lucky", "proud", "cozy", "fuzzy"]
const ANIMALS = ["kitten", "cat", "tiger", "lion", "panther", "cheetah", "lynx", "puma", "jaguar", "leopard"]

const sessions = {}

function request(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120" }
    }, (res) => {
      let data = ""
      res.on("data", (chunk) => data += chunk)
      res.on("end", () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data)
        }
      })
    }).on("error", reject)
  })
}

function cleanRecipient(emailOrUsername) {
  return (emailOrUsername || "").replace(`@${DOMAIN}`, "").trim()
}

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  const num = Math.floor(Math.random() * 900) + 100
  return `${adj}-${animal}-${num}`
}

function stripHtml(html) {
  if (typeof html !== "string") return ""
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractOtp(text) {
  if (!text) return null
  const labeled = text.match(/(?:otp|code|verification|kode|verifikasi)[\s:=#\-]+([0-9]{4,8})/i)
  if (labeled) return labeled[1]
  const standalone = text.match(/\b(?!(?:19\d\d|20\d\d)\b)([0-9]{4,8})\b/)
  return standalone ? standalone[1] : null
}

function extractLinks(html) {
  if (typeof html !== "string") return []
  const links = []
  const regex = /href=["'](https?:\/\/[^"']+)["']/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, "&")
    if (!links.includes(url)) links.push(url)
  }
  return links
}

function parseTimestamp(ts) {
  if (!ts) return null
  const millis = ts > 1e11 ? ts : ts * 1000
  return new Date(millis).toISOString()
}

function formatTimeRemaining(ms) {
  if (ms < 0) return "Expired"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (minutes > 0) return `${minutes} menit ${seconds % 60} detik`
  return `${seconds} detik`
}

async function listInbox(username) {
  const recipient = cleanRecipient(username)
  const res = await request(`${BASE_URL}/list?recipient=${encodeURIComponent(recipient)}`)
  return Array.isArray(res) ? res : []
}

async function getEmailDetail(region, key) {
  const [meta, html] = await Promise.all([
    request(`${BASE_URL}/getKey?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`),
    request(`${BASE_URL}/getHtml?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`)
  ])

  const rawHtml = typeof html === "string" ? html : JSON.stringify(html)
  const textContent = stripHtml(rawHtml)
  const links = extractLinks(rawHtml)
  const possibleOtp = extractOtp(textContent)

  return { meta, html: rawHtml, text: textContent, links, possibleOtp }
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
    logger.info(`[Akunlama] Cleaned up ${expiredCount} expired sessions`)
  }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

async function createMail(sessionId, customUser) {
  const username = customUser ? cleanRecipient(customUser) : generateRandomName()
  const expiresAt = Date.now() + MAX_AGE

  sessions[sessionId] = {
    email: `${username}@${DOMAIN}`,
    username,
    seenMessages: new Set(),
    createdAt: Date.now(),
    expiresAt
  }

  logger.info(`[Akunlama] Created | session=${sessionId} | email=${sessions[sessionId].email}`)

  return {
    email: sessions[sessionId].email,
    username,
    domain: DOMAIN,
    inboxCount: 0,
    createdAt: sessions[sessionId].createdAt,
    expiresAt,
    timeRemaining: MAX_AGE,
    timeRemainingHuman: formatTimeRemaining(MAX_AGE),
    note: "Email akan otomatis expired setelah 60 menit"
  }
}

async function checkInbox(sessionId) {
  const s = sessions[sessionId]
  if (!s) throw new Error("Session tidak ditemukan")
  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId]
    throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)")
  }

  const messages = await listInbox(s.username)
  const formatted = messages.map((m, idx) => {
    const headers = m.message?.headers || {}
    return {
      index: idx + 1,
      id: m.storage?.key || null,
      region: m.storage?.region || "us",
      from: headers.from || m.sender || null,
      subject: headers.subject || m.preview || "(No Subject)",
      date: parseTimestamp(m.timestamp)
    }
  })

  s.seenMessages = new Set(messages.map(m => m.storage?.key).filter(Boolean))

  return {
    email: s.email,
    total: formatted.length,
    messages: formatted,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    timeRemaining: s.expiresAt - Date.now(),
    timeRemainingHuman: formatTimeRemaining(s.expiresAt - Date.now())
  }
}

async function readMessage(sessionId, indexOrKey) {
  const s = sessions[sessionId]
  if (!s) throw new Error("Session tidak ditemukan")
  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId]
    throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)")
  }

  const messages = await listInbox(s.username)
  if (!messages.length) throw new Error(`Mailbox ${s.email} is empty`)

  let selected = null
  let targetIndex = null

  const parsedInt = parseInt(indexOrKey, 10)
  if (!isNaN(parsedInt) && parsedInt > 0 && parsedInt <= messages.length) {
    targetIndex = parsedInt
    selected = messages[parsedInt - 1]
  } else {
    const foundIdx = messages.findIndex(m => m.storage?.key === indexOrKey)
    if (foundIdx !== -1) {
      targetIndex = foundIdx + 1
      selected = messages[foundIdx]
    }
  }

  if (!selected) throw new Error(`Message '${indexOrKey}' not found. Available index: 1..${messages.length}`)

  const region = selected.storage?.region || "us"
  const key = selected.storage?.key
  const detail = await getEmailDetail(region, key)

  return {
    email: s.email,
    data: {
      index: targetIndex,
      id: key,
      region,
      from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : (detail.meta?.emailAddress || null),
      to: detail.meta?.recipients || s.email,
      subject: detail.meta?.subject || "(No Subject)",
      date: detail.meta?.Date || parseTimestamp(selected.timestamp),
      otp: detail.possibleOtp || null,
      links: detail.links || [],
      text: detail.text,
      html: detail.html
    }
  }
}

async function dumpMessages(sessionId) {
  const s = sessions[sessionId]
  if (!s) throw new Error("Session tidak ditemukan")
  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId]
    throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)")
  }

  const list = await listInbox(s.username)
  const fullData = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const region = item.storage?.region || "us"
    const key = item.storage?.key
    if (key) {
      const detail = await getEmailDetail(region, key)
      fullData.push({
        index: i + 1,
        id: key,
        region,
        from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : (detail.meta?.emailAddress || item.message?.headers?.from || null),
        to: detail.meta?.recipients || s.email,
        subject: detail.meta?.subject || item.message?.headers?.subject || item.preview || "(No Subject)",
        date: detail.meta?.Date || parseTimestamp(item.timestamp),
        otp: detail.possibleOtp || null,
        links: detail.links || [],
        text: detail.text,
        html: detail.html
      })
    }
  }

  return {
    email: s.email,
    total: fullData.length,
    messages: fullData
  }
}

async function monitorMail(sessionId) {
  const s = sessions[sessionId]
  if (!s) throw new Error("Session tidak ditemukan")
  if (Date.now() > s.expiresAt) {
    delete sessions[sessionId]
    throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)")
  }

  const messages = await listInbox(s.username)
  if (!s.seenMessages) s.seenMessages = new Set()

  const newMessages = []
  for (const msg of messages) {
    const key = msg.storage?.key
    if (key && !s.seenMessages.has(key)) {
      s.seenMessages.add(key)
      const region = msg.storage?.region || "us"
      const detail = await getEmailDetail(region, key)
      const headers = msg.message?.headers || {}
      newMessages.push({
        id: key,
        region,
        from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : (detail.meta?.emailAddress || headers.from || null),
        subject: detail.meta?.subject || headers.subject || msg.preview || "(No Subject)",
        links: detail.links || [],
        otp: detail.possibleOtp || null,
        text: detail.text,
        html: detail.html
      })
    }
  }

  return {
    email: s.email,
    newMessages,
    inboxCount: messages.length
  }
}

export default {
  name: "TempMail - Akunlama",
  description: "Temporary email service - generate, inbox, read, dump & monitor",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["sessionId", "action", "user", "messageId"],

  paramsSchema: {
    sessionId: {
      type: "string",
      required: true,
      description: "Session ID untuk menyimpan email (custom)"
    },
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox", "read", "dump", "monitor"],
      description: "Aksi: create (buat email), inbox (cek inbox), read (baca detail/pesan), dump (ambil semua pesan), atau monitor (cek pesan baru)"
    },
    user: {
      type: "string",
      required: false,
      description: "Username/email custom saat create (opsional, jika kosong random)"
    },
    messageId: {
      type: "string",
      required: false,
      description: "Nomor index atau key pesan untuk action=read"
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { sessionId, action, user, messageId } = { ...req.query, ...req.body }

      if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'sessionId' wajib diisi dan harus string",
          code: "MISSING_SESSION_ID"
        })
      }

      if (!action || !["create", "inbox", "read", "dump", "monitor"].includes(action)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' harus 'create', 'inbox', 'read', 'dump', atau 'monitor'",
          code: "INVALID_ACTION"
        })
      }

      logger.info(`[Akunlama] Request | ip=${req.ip} | session=${sessionId} | action=${action}`)

      let result
      const sid = sessionId.trim()

      switch (action) {
        case "create":
          result = await createMail(sid, user)
          break
        case "inbox":
          result = await checkInbox(sid)
          break
        case "read":
          if (!messageId) {
            return res.status(400).json({
              status: false,
              message: "Parameter 'messageId' wajib diisi untuk action=read (index 1..n atau key pesan)",
              code: "MISSING_MESSAGE_ID"
            })
          }
          result = await readMessage(sid, messageId)
          break
        case "dump":
          result = await dumpMessages(sid)
          break
        case "monitor":
          result = await monitorMail(sid)
          break
      }

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate")
      res.json({
        status: true,
        action,
        sessionId: sid,
        result,
        processingTimeMs: Date.now() - startTime
      })

    } catch (err) {
      logger.error(`[Akunlama] Error | ip=${req.ip} | session=${sessionId} | message=${err.message}`)

      if (err.message.includes("Session tidak ditemukan")) {
        return res.status(404).json({
          status: false,
          message: "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
          code: "SESSION_NOT_FOUND",
          metadata: { processingTimeMs: Date.now() - startTime }
        })
      }

      if (err.message.includes("kedaluwarsa")) {
        return res.status(410).json({
          status: false,
          message: "Email sementara telah kedaluwarsa (maksimal 60 menit). Buat email baru dengan action=create",
          code: "EMAIL_EXPIRED",
          metadata: { processingTimeMs: Date.now() - startTime }
        })
      }

      if (err.message.includes("not found")) {
        return res.status(404).json({
          status: false,
          message: err.message,
          code: "MESSAGE_NOT_FOUND",
          metadata: { processingTimeMs: Date.now() - startTime }
        })
      }

      res.status(500).json({
        status: false,
        message: err.message || "Akunlama request failed",
        code: "AKUNLAMA_ERROR",
        metadata: { processingTimeMs: Date.now() - startTime }
      })
    }
  }
}
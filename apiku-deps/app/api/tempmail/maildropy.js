/**
 * Maildropy Temporary Email API
 * Provider: Maildropy (maildropy.com)
 * API Base: http://maildropy.com
 * Category: Email
 * Fitur   : Generate email acak/custom, cek inbox, auto-extract OTP, baca pesan detail, hapus pesan/inbox, dan akses web langsung (direct_url)
 */

import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import logger from '../../src/utils/logger.js'

const BASE_URL = 'http://maildropy.com'
const WEB_BASE = 'https://maildropy.com'
const TIMEOUT = 20000
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

const jar = new CookieJar()
const client = wrapper(
  axios.create({
    jar,
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    validateStatus: () => true,
  })
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function getDirectUrl(email) {
  if (!email) return null
  return `${WEB_BASE}/${email}`
}

function extractOtp(subject = '', body = '') {
  const text = `${subject}\n${body}`
  const lower = text.toLowerCase()
  const codeRegex = /\b\d{4,8}\b/g
  const triggers = [
    'kode', 'code', 'otp', 'verifikasi', 'verification', 'verify',
    'pin', 'passcode', 'one-time', 'sekali pakai', 'token', 'authentication', 'autentikasi'
  ]
  const negativeTriggers = [
    'invoice', 'pesanan', 'order', 'total', 'tagihan', 'faktur', 'resi', 'nomor', 'no.', 'rp', 'harga', 'jumlah'
  ]

  let otp = null
  for (const match of text.matchAll(codeRegex)) {
    const idx = match.index || 0
    const end = idx + match[0].length
    const before = lower.slice(Math.max(0, idx - 80), idx)
    const after = lower.slice(end, Math.min(lower.length, end + 40))
    const near = `${before} ${after}`

    if (idx > 0 && text[idx - 1] === '#') continue
    if (negativeTriggers.some((neg) => near.includes(neg))) continue

    if (triggers.some((trig) => near.includes(trig))) {
      if (!otp || match[0].length === 6) {
        otp = match[0]
      }
    }
  }
  return otp
}

async function createEmail(customUsername = '', domain = 'maildropy.com') {
  const cleanDomain = (domain || 'maildropy.com').trim().toLowerCase()
  const cleanUser = (customUsername || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')

  if (cleanUser) {
    const customEmail = `${cleanUser}@${cleanDomain}`
    const res = await client.post('/wxapi/set-email', { email: customEmail })
    const data = res.data || {}
    const email = data.email || customEmail

    return {
      success: res.status >= 200 && res.status < 300,
      email,
      domain: cleanDomain,
      approved: Boolean(data.approved),
      direct_url: getDirectUrl(email),
    }
  }

  const res = await client.post('/wxapi/generate', { domain: cleanDomain })
  const data = res.data || {}
  const email = data.email || null

  return {
    success: res.status >= 200 && res.status < 300 && Boolean(data.success),
    email,
    domain: data.domain || cleanDomain,
    approved: Boolean(data.approved),
    direct_url: getDirectUrl(email),
  }
}

async function validateStatus(email) {
  const encoded = encodeURIComponent(email)
  const res = await client.get(`/wxapi/email-status/${encoded}`)
  const data = res.data || {}

  return {
    success: res.status >= 200 && res.status < 300,
    email: data.email || email,
    domain: data.domain || 'maildropy.com',
    approved: Boolean(data.approved),
    status: data.status || 'unknown',
    type: data.type || null,
    direct_url: getDirectUrl(data.email || email),
  }
}

async function fetchInbox(email) {
  const encoded = encodeURIComponent(email)
  const res = await client.get(`/wxapi/messages/${encoded}`)
  const data = res.data || {}
  const rawList = Array.isArray(data.messages) ? data.messages : []

  const messages = rawList.map((m) => {
    const subject = m.subject || m.header?.subject || ''
    const body = m.preview || m.text || m.body || ''
    return {
      id: m.id || m._id || m.messageId,
      from: m.from || m.header?.from || 'Unknown',
      subject,
      date: m.date || m.header?.date || null,
      otp: extractOtp(subject, body),
      preview: body.slice(0, 150),
      raw: m,
    }
  })

  return {
    email: data.email || email,
    exists: Boolean(data.exists),
    approved: Boolean(data.approved),
    count: data.count ?? messages.length,
    unread: data.unread ?? 0,
    direct_url: getDirectUrl(data.email || email),
    messages,
  }
}

async function waitForInbox(email, maxSeconds = 30) {
  const capSeconds = Math.min(Math.max(Number(maxSeconds) || 0, 0), 60)
  const startTime = Date.now()

  while ((Date.now() - startTime) / 1000 < capSeconds) {
    const inbox = await fetchInbox(email)
    if (inbox.messages && inbox.messages.length > 0) {
      return inbox
    }
    await sleep(3000)
  }

  return await fetchInbox(email)
}

async function fetchMessage(email, messageId) {
  const encodedEmail = encodeURIComponent(email)
  const encodedId = encodeURIComponent(messageId)
  const res = await client.get(`/wxapi/message/${encodedEmail}/${encodedId}`)
  const data = res.data || {}

  const subject = data.subject || data.header?.subject || ''
  const text = data.text || data.bodyText || ''
  const html = data.html || data.bodyHtml || ''

  return {
    id: messageId,
    email,
    from: data.from || data.header?.from || 'Unknown',
    subject,
    date: data.date || data.header?.date || null,
    otp: extractOtp(subject, `${text}\n${html}`),
    text,
    html,
    direct_url: getDirectUrl(email),
  }
}

async function deleteMail(email, messageId = null) {
  const encodedEmail = encodeURIComponent(email)

  if (messageId) {
    const encodedId = encodeURIComponent(messageId)
    const res = await client.delete(`/wxapi/message/${encodedEmail}/${encodedId}`)
    return {
      success: res.status >= 200 && res.status < 300,
      target: `message_${messageId}`,
      message: res.status >= 200 && res.status < 300 ? 'Pesan berhasil dihapus' : 'Gagal menghapus pesan',
    }
  }

  const res = await client.delete(`/wxapi/inbox/${encodedEmail}`)
  return {
    success: res.status >= 200 && res.status < 300,
    target: 'entire_inbox',
    message: res.status >= 200 && res.status < 300 ? 'Seluruh inbox berhasil dibersihkan' : 'Gagal membersihkan inbox',
  }
}

const ACTIONS = ['create', 'inbox', 'message', 'status', 'delete']

export default {
  name: 'Maildropy Temp Mail',
  description:
    'Layanan temporary disposable email — generate email acak atau custom, cek inbox, auto-extract OTP, baca isi pesan, dan link akses web langsung',
  category: 'Email',
  methods: ['GET', 'POST'],
  params: ['action', 'email', 'username', 'domain', 'id', 'wait'],
  paramsSchema: {
    action: {
      type: 'string',
      required: false,
      default: 'create',
      enum: ACTIONS,
      description: `Aksi yang dijalankan (${ACTIONS.join(', ')})`,
      example: 'create',
    },
    email: {
      type: 'string',
      required: false,
      description: 'Alamat email lengkap (wajib untuk action=inbox, message, status, delete)',
      example: 'user123@maildropy.com',
    },
    username: {
      type: 'string',
      required: false,
      description: 'Custom username pilihan (opsional untuk action=create)',
      example: 'myuser',
    },
    domain: {
      type: 'string',
      required: false,
      default: 'maildropy.com',
      description: 'Domain email (default: maildropy.com)',
      example: 'maildropy.com',
    },
    id: {
      type: 'string',
      required: false,
      description: 'ID pesan yang ingin dibaca atau dihapus (action=message, delete)',
      example: 'msg_123',
    },
    wait: {
      type: 'number',
      required: false,
      default: 0,
      description: 'Tunggu email masuk sampai maksimal N detik (maksimal 60 detik) untuk action=inbox',
      example: 15,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body }
      const action = String(params.action || 'create').trim().toLowerCase()

      logger.info(`[MAILDROPY] Request action=${action}`)

      // 1. Create (Generate email baru)
      if (action === 'create' || action === 'generate' || action === 'new') {
        const username = params.username ? String(params.username).trim() : ''
        const domain = params.domain ? String(params.domain).trim() : 'maildropy.com'
        const result = await createEmail(username, domain)

        return res.status(200).json({
          status: result.success,
          result,
        })
      }

      // 2. Inbox (Cek kotak masuk)
      if (action === 'inbox' || action === 'messages' || action === 'check') {
        const targetEmail = String(params.email || '').trim().toLowerCase()
        if (!targetEmail) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi untuk action=inbox (contoh: user@maildropy.com)",
          })
        }

        const waitSeconds = parseInt(params.wait, 10) || 0
        const result = waitSeconds > 0
          ? await waitForInbox(targetEmail, waitSeconds)
          : await fetchInbox(targetEmail)

        return res.status(200).json({
          status: true,
          result,
        })
      }

      // 3. Message Detail (Baca isi pesan)
      if (action === 'message' || action === 'detail' || action === 'read') {
        const targetEmail = String(params.email || '').trim().toLowerCase()
        const msgId = String(params.id || params.messageId || '').trim()

        if (!targetEmail || !msgId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' dan 'id' pesan wajib diisi untuk action=message",
          })
        }

        const result = await fetchMessage(targetEmail, msgId)
        return res.status(200).json({
          status: true,
          result,
        })
      }

      // 4. Status (Validasi status email)
      if (action === 'status' || action === 'validate') {
        const targetEmail = String(params.email || '').trim().toLowerCase()
        if (!targetEmail) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi untuk action=status",
          })
        }

        const result = await validateStatus(targetEmail)
        return res.status(200).json({
          status: result.success,
          result,
        })
      }

      // 5. Delete (Hapus pesan atau seluruh inbox)
      if (action === 'delete' || action === 'del') {
        const targetEmail = String(params.email || '').trim().toLowerCase()
        if (!targetEmail) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi untuk action=delete",
          })
        }

        const msgId = params.id ? String(params.id).trim() : null
        const result = await deleteMail(targetEmail, msgId)

        return res.status(200).json({
          status: result.success,
          result,
        })
      }

      return res.status(400).json({
        status: false,
        message: `Aksi tidak dikenal: '${action}'. Pilihan: ${ACTIONS.join(', ')}`,
      })
    } catch (err) {
      logger.error(`[MAILDROPY] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal memproses request Maildropy',
      })
    }
  },
}

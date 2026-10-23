import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import https from 'https'
import logger from "../../src/utils/logger.js"

puppeteer.use(StealthPlugin())

const tokens = {}
const EXPIRY = 20 * 60 * 60 * 1000

function cleanExpired() {
  const now = Date.now()
  for (const [k, v] of Object.entries(tokens)) {
    if (now - v.created > EXPIRY) delete tokens[k]
  }
}

function api(payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = https.request({
      hostname: 'tmailor.com', path: '/api', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://tmailor.com',
        'Referer': 'https://tmailor.com/id/',
        ...extraHeaders,
      },
    }, (res) => {
      let b = ''
      res.on('data', c => b += c)
      res.on('end', () => {
        try { resolve(JSON.parse(b)) }
        catch { reject(Error('API error')) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function createEmailViaBrowser() {
  const b = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    ignoreHTTPSErrors: true,
  })
  try {
    const p = await b.newPage()
    await p.setViewport({ width: 1280, height: 800 })
    await p.goto('https://tmailor.com/id/', { waitUntil: 'load', timeout: 60000 })
    await new Promise(r => setTimeout(r, 10000))

    const ls = await p.evaluate(() => {
      const o = {}
      for (const k of Object.keys(localStorage)) {
        try { o[k] = JSON.parse(localStorage[k]) } catch { o[k] = localStorage[k] }
      }
      return o
    })

    const cur = ls.currentEmail
    if (cur?.email && cur?.accesstoken) {
      return {
        email: cur.email,
        accesstoken: cur.accesstoken,
        fbToken: ls.fbToken || '',
        curentToken: ls.curentToken || '',
      }
    }
    throw new Error('Email auto-generate gagal')
  } finally {
    await b.close().catch(() => {})
  }
}

export default {
  name: "TempMail - TMailor.com",
  description: "Temporary email service — create, inbox, custom, domains, delete.",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "email", "nama"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "create",
      enum: ["create", "inbox", "custom", "domains", "delete"],
      description: "Aksi: create, inbox (cek pesan), custom (nama custom), domains (daftar domain), delete"
    },
    email: {
      type: "string",
      required: false,
      description: "Alamat email (wajib untuk inbox & delete). Email harus dibuat dulu via action=create dari endpoint ini agar token tersimpan."
    },
    nama: {
      type: "string",
      required: false,
      description: "Nama custom untuk email (wajib untuk action=custom). Contoh: testuser"
    }
  },

  async run(req, res) {
    const { action, email } = { ...req.query, ...req.body }

    if (!action) {
      return res.status(400).json({ status: false, message: "Parameter 'action' wajib diisi (create / inbox / custom / domains / delete)" })
    }

    cleanExpired()

    if (action === "create") {
      try {
        const result = await createEmailViaBrowser()
        tokens[result.email] = {
          accesstoken: result.accesstoken,
          fbToken: result.fbToken,
          curentToken: result.curentToken,
          created: Date.now(),
        }
        logger.info(`[TMv10] Email created: ${result.email}`)
        return res.json({
          status: true,
          action: "create",
          result: { email: result.email, token: result.accesstoken }
        })
      } catch (err) {
        logger.error(`[TMv10] Create failed: ${err.message}`)
        return res.status(500).json({ status: false, message: err.message || 'Gagal membuat email' })
      }
    }

    if (action === "inbox") {
      if (!email) {
        return res.status(400).json({ status: false, message: "Parameter 'email' wajib untuk inbox" })
      }
      const s = tokens[email.trim()]
      if (!s) {
        return res.status(400).json({ status: false, message: "Email tidak ditemukan. Buat email dulu via action=create dari endpoint ini." })
      }
      const fbToken = s?.fbToken || ''
      const curentToken = s?.curentToken || ''
      try {
        const r = await api({
          action: 'listinbox',
          listToken: { [email.trim()]: s.accesstoken },
          listID: { [email.trim()]: '' },
          fbToken, curentToken,
        })
        if (r.msg === 'ok' && r.data?.[email.trim()]) {
          const d = r.data[email.trim()]
          const pesan = Object.values(d.data || {}).map(m => ({
            id: m.id,
            dari: m.sender_name || m.sender_email || '',
            subjek: m.subject || '(kosong)',
            waktu: m.receive_time ? new Date(m.receive_time * 1000).toISOString() : '',
            body: m.body_html || m.body_text || '',
          }))
          return res.json({
            status: true,
            action: "inbox",
            result: { email: email.trim(), total: pesan.length, messages: pesan, expired: !!d.dead }
          })
        }
        return res.json({
          status: true,
          action: "inbox",
          result: { email: email.trim(), total: 0, messages: [] }
        })
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || 'Gagal mengambil pesan' })
      }
    }

    if (action === "domains") {
      try {
        const r = await api({ action: 'newemail', list_domain: 1 })
        if (Array.isArray(r.data)) {
          return res.json({
            status: true,
            action: "domains",
            result: r.data.map(d => ({ name: d.domain_name, token: d.domain_token }))
          })
        }
        return res.status(500).json({ status: false, message: 'Gagal mengambil daftar domain' })
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || 'Gagal mengambil domain' })
      }
    }

    if (action === "custom") {
      const { nama: customName, domain } = { ...req.query, ...req.body }
      if (!customName) {
        return res.status(400).json({ status: false, message: "Parameter 'nama' wajib untuk custom" })
      }
      try {
        const r = await api({ action: 'newemail', newemail_mode: 'custom', choose_domain: domain || '1', custom_name: customName })
        if (r.email) {
          tokens[r.email] = {
            accesstoken: r.accesstoken,
            fbToken: '',
            curentToken: '',
            created: Date.now(),
          }
          return res.json({
            status: true,
            action: "custom",
            result: { email: r.email, token: r.accesstoken }
          })
        }
        if (r.msg === 'erroremail') {
          const desc = r.desc === 'name_taken' ? 'Nama sudah dipakai' : r.desc
          return res.status(400).json({ status: false, message: desc })
        }
        return res.status(500).json({ status: false, message: 'Gagal membuat email custom' })
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || 'Gagal membuat email custom' })
      }
    }

    if (action === "delete") {
      if (!email) {
        return res.status(400).json({ status: false, message: "Parameter 'email' wajib untuk delete" })
      }
      delete tokens[email.trim()]
      return res.json({
        status: true,
        action: "delete",
        result: { email: email.trim(), message: 'Email dihapus dari sesi' }
      })
    }

    return res.status(400).json({ status: false, message: "action tidak valid. Gunakan: create / inbox / custom / domains / delete" })
  }
}

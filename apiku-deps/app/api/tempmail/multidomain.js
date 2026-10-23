/**
 * TempMail v1 - Generator.email backend
 * GET /tools/tempmail?action=create&domain=xxx
 * GET /tools/tempmail?action=inbox&email=xxx
 */

import axios from "axios"
import * as cheerio from "cheerio"

const BASE_URL = "https://generator.email/"
const VALIDATE_PATH = "check_adres_validation3.php"
const REQUEST_TIMEOUT = 15000

const DOMAINS = [
  "pdood.com", "agallagher.id", "emailmultimedia.com", "giangholang.xyz",
  "24hhost.cc", "ghk55.us", "moreglass.vn", "himkinet.ru",
  "wwefd.top", "yang-gtens.pro", "appcloudmurah.email", "j3r8qd.site",
  "biosu.dev", "raveqxon.space", "rayrayactive.com", "thxm3.pro",
  "czub.xyz"
]

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Upgrade-Insecure-Requests": "1"
}

function splitEmail(email = "") {
  const value = String(email).trim()
  if (!value.includes("@")) return null
  const [username, domain] = value.split("@")
  if (!username || !domain) return null
  return { username, domain }
}

function normalizeLink(href = "") {
  if (!href) return null
  try { return href.startsWith("http") ? href : new URL(href, BASE_URL).href }
  catch { return null }
}

class GeneratorEmail {
  constructor() {
    this.cookie = ""
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: REQUEST_TIMEOUT,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: HEADERS
    })
  }

  updateCookie(setCookie = []) {
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : setCookie
    const match = String(raw).match(/surl=([^;]+)/)
    if (match) this.cookie = `surl=${match[1]}`
  }

  async request(path = "", options = {}) {
    let url = path
    for (let i = 0; i < 5; i++) {
      const res = await this.client.request({
        url,
        method: options.method || "GET",
        data: options.data,
        headers: { ...HEADERS, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(options.headers || {}) }
      })
      this.updateCookie(res.headers["set-cookie"])
      if ([301, 302].includes(res.status) && res.headers.location) { url = res.headers.location; continue }
      return res.data
    }
    throw new Error("Redirect terlalu banyak")
  }

  async validate(email) {
    const parsed = splitEmail(email)
    if (!parsed) return { status: null, uptime: null }
    const body = new URLSearchParams({ usr: parsed.username, dmn: parsed.domain }).toString()
    try {
      return await this.request(VALIDATE_PATH, { method: "POST", data: body, headers: { "Content-Type": "application/x-www-form-urlencoded" } })
    } catch { return { status: null, uptime: null } }
  }

  async generate(domain = "") {
    try {
      await this.request(domain || "")
      const html = await this.request("")
      const $ = cheerio.load(html)
      const email = $("#email_ch_text").text().trim()
      if (!email) return { status: false, error: "Gagal generate email" }
      const validation = await this.validate(email)
      return { status: true, result: { email, emailStatus: validation.status || null, uptime: validation.uptime || null } }
    } catch (err) {
      return { status: false, error: err.message }
    }
  }

  extractMessage($) {
    const spans = $(".e7m.col-md-9 span")
    const body = $(".e7m.mess_bodiyy")
    const links = []
    body.find("a").each((_, el) => { const href = normalizeLink($(el).attr("href")); if (href) links.push(href) })
    return {
      from: spans.eq(3).text().replace(/\(.*?\)/g, "").trim(),
      to: spans.eq(1).text().trim(),
      created: $(".e7m.tooltip").text().replace("Created: ", "").trim(),
      subject: $("h1").text().trim(),
      message: body.text().trim(),
      links
    }
  }

  async inbox(email) {
    const parsed = splitEmail(email)
    if (!parsed) return { status: false, error: "Email tidak valid" }
    const validation = await this.validate(email)
    const mailboxCookie = `surl=${parsed.domain}/${parsed.username}`
    try {
      const html = await this.request("", { headers: { Cookie: mailboxCookie } })
      if (html.includes("Email generator is ready")) {
        return { status: true, result: { email, emailStatus: validation.status || null, uptime: validation.uptime || null, inbox: [] } }
      }
      const $ = cheerio.load(html)
      const total = Number($("#mess_number").text()) || 0
      const inbox = []
      if (total === 1) inbox.push(this.extractMessage($))
      if (total > 1) {
        const paths = $("#email-table a").map((_, el) => $(el).attr("href")).get().filter(Boolean)
        for (const path of paths) {
          const messageHtml = await this.request(path, { headers: { Cookie: `surl=${path.replace("/", "")}` } })
          const messagePage = cheerio.load(messageHtml)
          inbox.push(this.extractMessage(messagePage))
        }
      }
      return { status: true, result: { email, emailStatus: validation.status || null, uptime: validation.uptime || null, inbox } }
    } catch (err) {
      return { status: true, result: { email, emailStatus: validation.status || null, uptime: validation.uptime || null, inbox: [], error: err.message } }
    }
  }
}

export default {
  name: "TempMail - Generator.email (Multi-Domain)",
  description: "Temporary email generator with 17+ domain options — create & inbox",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["action", "domain", "email"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox"],
      description: "Aksi: create (buat email), inbox (cek inbox), atau delete (hapus email)",
    },
    domain: {
      type: "string",
      required: false,
      enum: DOMAINS,
      description: "Domain email (opsional, random jika kosong)"
    },
    email: {
      type: "string",
      required: false,
      description: "Alamat email (wajib untuk action=inbox)"
    }
  },

  async run(req, res) {
    try {
      const { action, domain, email } = { ...req.query, ...req.body }
      const app = new GeneratorEmail()

      if (action === "create") {
        const selectedDomain = domain || DOMAINS[Math.floor(Math.random() * DOMAINS.length)]
        const result = await app.generate(selectedDomain)
        if (!result.status) {
          return res.status(500).json({ status: false, message: result.error })
        }
        return res.json({ status: true, action: "create", result: result.result })
      }

      if (action === "inbox") {
        if (!email) {
          return res.status(400).json({ status: false, message: "Parameter 'email' wajib diisi untuk action=inbox" })
        }
        const result = await app.inbox(email)
        return res.json({ status: result.status, action: "inbox", email, result: result.result })
      }

      return res.status(400).json({ status: false, message: "Parameter 'action' harus 'create' atau 'inbox'" })

    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "TempMail request failed" })
    }
  }
}

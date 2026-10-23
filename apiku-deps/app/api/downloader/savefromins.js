/**
 * SaveFromIns Downloader
 * Provider: savefromins.com
 * Parameter: url (wajib)
 */

import axios from "axios"
import * as cheerio from "cheerio"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"

async function getSessionConfig() {
  const { data: html } = await axios.get("https://savefromins.com/", {
    headers: { "User-Agent": UA }
  })
  const $ = cheerio.load(html)
  const chunks = $("script[src*='/_next/static/chunks/']").map((_, el) => {
    const src = $(el).attr("src")
    return src.startsWith("http") ? src : "https://savefromins.com" + src
  }).get()

  let auth, domain, reqUrl
  for (const url of chunks) {
    if (auth && domain && reqUrl) break
    let js
    try {
      js = (await axios.get(url, { headers: { "User-Agent": UA } })).data
    } catch {
      continue
    }
    if (typeof js !== "string") continue
    if (!auth) {
      const m = js.match(/auth:"([^"]+)"/)
      if (m && js.includes("media/parse")) auth = m[1]
    }
    if (!domain) {
      const m = js.match(/VIDEODOWNLOAD:"([^"]+)"/)
      if (m) domain = m[1]
    }
    if (!reqUrl) {
      const m = js.match(/REQ_URL:"([^"]+)"/)
      if (m) reqUrl = m[1]
    }
  }
  if (!auth || !domain || !reqUrl) throw new Error("Config auth/domain/reqUrl tidak ditemukan")
  return { auth, domain, reqUrl }
}

async function run(link) {
  if (!/^https?:\/\//i.test(link || "")) {
    return { status: false, code: 400, input: link ?? null, result: null }
  }
  try {
    const cfg = await getSessionConfig()
    const body = new URLSearchParams({
      auth: cfg.auth,
      domain: cfg.domain,
      origin: "source",
      link
    }).toString()

    const { data: payload } = await axios.post(cfg.reqUrl + "/media/parse", body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        Origin: "https://savefromins.com",
        Referer: "https://savefromins.com/",
        Accept: "*/*"
      }
    })

    if (payload?.status !== 1 || !payload?.data) {
      return { status: false, code: 200, input: link, result: null }
    }

    const resources = payload.data.resources || []
    if (!resources.length) return { status: false, code: 200, input: link, result: null }

    const d = payload.data
    return {
      status: true,
      code: 200,
      input: link,
      result: {
        title: d.title ?? "",
        thumbnail: d.thumbnail ?? "",
        duration: d.duration ?? 0,
        links: resources.map((r) => ({
          type: r.type ?? "",
          quality: r.quality ?? "",
          format: r.format ?? "",
          url: r.download_url || r.preview_url || ""
        })),
        comments: d.comment_items?.items ?? []
      }
    }
  } catch (err) {
    console.error("DEBUG:", err.message, err.response?.status ?? "")
    return { status: false, code: err.response?.status || 500, input: link, result: null }
  }
}

export default {
  name: "SaveFromIns Downloader",
  description: "Downloader multi-platform (YouTube, TikTok, Facebook, dll)",
  category: "Downloader",
  methods: ["POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video dari savefromins.com"
    }
  },
  async run(req, res) {
    try {
      const { url } = req.body || {}
      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi"
        })
      }

      const result = await run(url.trim())

      if (result.status) {
        res.json({
          status: true,
          result,
          timestamp: Date.now()
        })
      } else {
        res.status(result.code).json({
          status: false,
          message: result.message || "Gagal memproses URL",
          timestamp: Date.now()
        })
      }
    } catch (err) {
      console.error("[SaveFromIns Error]", err.message)
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mendownload dari SaveFromIns",
        timestamp: Date.now()
      })
    }
  }
}
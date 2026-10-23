/**
 * SigStick Sticker Search Endpoint
 * Cari sticker pack Telegram lewat sigstick.com (API publik, tanpa auth)
 *
 * Alur upstream (Next.js):
 *   1. GET /stickers                                -> ambil "buildId" dari HTML
 *   2. GET /_next/data/{buildId}/stickers.json?keyword=...   (header x-nextjs-data: 1)
 *
 * Catatan: upstream tidak pernah mengembalikan daftar kosong — query yang tidak
 * ada hasilnya tetap dapat pack (fallback ke trending/popular).
 */

import axios from "axios"

const BASE = "https://www.sigstick.com"
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
const TIMEOUT = 15000
const MAX_LIMIT = 50

const client = axios.create({ timeout: TIMEOUT, headers: { "User-Agent": UA } })

// Build ID relatif statis, aman di-cache per proses
let buildIdCache = null

export async function extractBuildId() {
  if (buildIdCache) return buildIdCache
  const { data: html } = await client.get(`${BASE}/stickers`)
  const id = html.match(/"buildId":"([a-zA-Z0-9_-]+)"/)?.[1] || html.match(/data-build-id="([a-zA-Z0-9_-]+)"/)?.[1]
  if (!id) throw new Error("Build ID tidak ditemukan di halaman /stickers")
  buildIdCache = id
  return id
}

export async function searchStickers(keyword, limit = 10) {
  const kw = String(keyword || "").trim()
  if (!kw) throw new Error("Query tidak boleh kosong")

  const buildId = await extractBuildId()
  const response = await client.get(`${BASE}/_next/data/${buildId}/stickers.json`, {
    params: { keyword: kw },
    headers: {
      "sec-ch-ua": '"Chromium";v="139", "Not;A=Brand";v="99"',
      "x-nextjs-data": "1",
      Referer: `${BASE}/stickers?keyword=${encodeURIComponent(kw)}`,
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
    },
  })

  const all = response.data?.pageProps?.packs || []
  return {
    buildId,
    total: all.length,
    packs: limit > 0 ? all.slice(0, limit) : all,
  }
}

export function summarize(pack) {
  return {
    id: pack.id,
    title: pack.title || "Tanpa Judul",
    author: pack.author ?? null,
    status: pack.status ?? null,
    stickers: Array.isArray(pack.stickers) ? pack.stickers.length : 0,
    cover: pack.cover?.url ?? null,
    telegramUrl: pack.telegramUrl ?? null,
    signalUrl: pack.signalUrl ?? null,
    views: pack.views ?? null,
    download: pack.download ?? null,
  }
}

export default {
  name: "SigStick Sticker Search",
  description: "Cari sticker pack Telegram, dapat link Telegram dan Signal",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "limit"],
  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian sticker pack",
      example: "kucing",
    },
    limit: {
      type: "string",
      required: false,
      description: "Batasi jumlah hasil (maks 50, 0 = maksimum)",
      default: "10",
      example: "5",
    },
  },
  async run(req, res) {
    const startTime = Date.now()
    const { query, limit } = { ...req.query, ...req.body }

    if (!query || typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({
        status: false,
        message: "Parameter 'query' wajib diisi",
        code: "MISSING_QUERY",
      })
    }

    const raw = limit === undefined || limit === "" ? 10 : Number(limit)
    if (!Number.isFinite(raw) || raw < 0) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'limit' harus angka non-negatif",
        code: "INVALID_LIMIT",
      })
    }
    // 0 = ambil sebanyak mungkin, tapi tetap dibatasi MAX_LIMIT
    const lim = raw === 0 ? MAX_LIMIT : Math.min(raw, MAX_LIMIT)

    try {
      const result = await searchStickers(query, lim)
      return res.json({
        status: true,
        query: String(query).trim(),
        total: result.total,
        limit: lim,
        returned: result.packs.length,
        result: result.packs.map(summarize),
        responseTime: `${Date.now() - startTime}ms`,
      })
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: err.message,
        code: "UPSTREAM_ERROR",
        responseTime: `${Date.now() - startTime}ms`,
      })
    }
  },
}
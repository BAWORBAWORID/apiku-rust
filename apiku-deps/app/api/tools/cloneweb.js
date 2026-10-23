/**
 * @license
 * Copyright (C) 2026 BAWORBAWORID
 * GPL-3.0
 *
 * Clone Website Builder
 * GET /tools/cloneweb?url=https://example.com&depth=1&limit=15&exp=1&unit=menit
 * Hasil: ZIP (HTML/CSS/JS/fonts/gambar + sourcemap recovery) tersimpan di files/
 *
 * Note: engine ada di ./assets/cloneweb.js (jangan pindah ke src/)
 */

import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"
import { validateSSRFUrl } from "../../src/utils/safeFetch.js"
import { cloneWebsite } from "./assets/cloneweb.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const EXPIRY_DB = path.join(process.cwd(), "data", "exp.json")
if (!fs.existsSync(path.dirname(EXPIRY_DB))) fs.mkdirSync(path.dirname(EXPIRY_DB), { recursive: true })
if (!fs.existsSync(EXPIRY_DB)) fs.writeFileSync(EXPIRY_DB, "[]")

const activeTimers = new Map()

function randomName() {
  return crypto.randomBytes(16).toString("hex") + ".zip"
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

function calculateExpiry(exp, unit = "menit") {
  const expNum = parseInt(exp) || 5
  const multipliers = {
    menit: 60 * 1000,
    jam: 60 * 60 * 1000,
    hari: 24 * 60 * 60 * 1000,
    minggu: 7 * 24 * 60 * 60 * 1000,
    bulan: 30 * 24 * 60 * 60 * 1000,
    tahun: 365 * 24 * 60 * 60 * 1000,
  }
  const calculated = expNum * (multipliers[String(unit).toLowerCase()] || multipliers.menit)
  return Math.min(calculated, multipliers.tahun)
}

function formatExpiry(ms) {
  if (ms <= 0) return "expired"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return days + " hari" + (hours % 24 ? " " + (hours % 24) + " jam" : "")
  if (hours > 0) return hours + " jam" + (minutes % 60 ? " " + (minutes % 60) + " menit" : "")
  if (minutes > 0) return minutes + " menit" + (seconds % 60 ? " " + (seconds % 60) + " detik" : "")
  return seconds + " detik"
}

function addExpiryEntry(entry) {
  try {
    const list = JSON.parse(fs.readFileSync(EXPIRY_DB, "utf8"))
    list.push(entry)
    fs.writeFileSync(EXPIRY_DB, JSON.stringify(list, null, 2))
  } catch {
    /* ignore */
  }
}

function removeExpiryEntry(filename) {
  try {
    const list = JSON.parse(fs.readFileSync(EXPIRY_DB, "utf8"))
    fs.writeFileSync(EXPIRY_DB, JSON.stringify(list.filter((e) => e.filename !== filename), null, 2))
  } catch {
    /* ignore */
  }
}

export default {
  name: "Clone Website Builder",
  description: "Clone website target jadi ZIP — HTML/CSS/JS/fonts/gambar + sourcemap recovery, download via URL web",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["url", "depth", "limit", "exp", "unit"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL website target (harus publik, bukan IP lokal/private)",
      example: "https://example.com",
    },
    depth: {
      type: "number",
      required: false,
      default: 1,
      description: "Kedalaman crawl halaman (0-2)",
    },
    limit: {
      type: "number",
      required: false,
      default: 15,
      description: "Maksimal halaman yang di-crawl (maks 50)",
    },
    exp: {
      type: "number",
      required: false,
      default: 1,
      description: "Expiry file",
    },
    unit: {
      type: "string",
      required: false,
      enum: ["menit", "jam", "hari", "minggu", "bulan", "tahun"],
      default: "menit",
      description: "Satuan expiry",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body }
    const rawUrl = String(params.url || "").trim()
    if (!rawUrl) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
    }

    let target = rawUrl
    if (!/^https?:\/\//i.test(target)) target = "https://" + target

    // SSRF guard: tolak IP private/localhost/metadata endpoint
    try {
      validateSSRFUrl(target)
    } catch (e) {
      return res.status(400).json({ status: false, message: "URL ditolak: " + e.message })
    }

    const depth = Math.min(2, Math.max(0, parseInt(params.depth) || 1))
    const maxPages = Math.min(50, Math.max(1, parseInt(params.limit) || 15))
    const TTL = calculateExpiry(params.exp, params.unit)
    const formattedExpiry = formatExpiry(TTL)

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloneweb-"))
    const started = Date.now()

    try {
      const summary = await cloneWebsite({
        url: target,
        out: outDir,
        depth,
        maxPages,
        maxAssets: 300,
        concurrency: 6,
        timeout: 15000,
        retries: 1,
        external: false,
        inline: false,
        zip: true,
        quiet: true,
      })

      if (!summary.totalFiles) {
        return res.status(502).json({
          status: false,
          message: "Tidak ada file yang berhasil di-scrape dari target",
          result: { errors: summary.errors },
        })
      }

      const filename = randomName()
      const filePath = path.join(uploadDir, filename)
      const zipSourcePath = summary.zip || path.join(summary.outputDir, "_site.zip")
      if (!fs.existsSync(zipSourcePath)) {
        return res.status(502).json({
          status: false,
          message: "ZIP gagal dibuat",
          result: { errors: summary.errors },
        })
      }
      const zipBuffer = fs.readFileSync(zipSourcePath)
      fs.writeFileSync(filePath, zipBuffer)

      const host = req.get("x-forwarded-host") || req.get("host") || ""
      const isLocal = !host || host.includes("localhost") || host.includes("127.0.0.1")
      const baseUrl = isLocal ? "https://api.zyvor.my.id" : `${req.get("x-forwarded-proto") || "https"}://${host}`
      const expires_at = new Date(Date.now() + TTL).toISOString()

      addExpiryEntry({ filename, expiresAt: expires_at, filePath, originalName: `${summary.host}.zip`, size: zipBuffer.length, mimetype: "application/zip" })

      const timerId = setTimeout(() => {
        activeTimers.delete(filename)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          removeExpiryEntry(filename)
          logger.info(`[CLONEWEB] File expired & deleted | file=${filename}`)
        }
      }, TTL)
      activeTimers.set(filename, timerId)

      logger.info(
        `[CLONEWEB] success | ip=${req.ip} | target=${target} | files=${summary.totalFiles} | zip=${formatFileSize(zipBuffer.length)} | ${formattedExpiry}`
      )

      return res.json({
        status: true,
        tool: "cloneweb",
        result: {
          url: `${baseUrl}/files/${filename}`,
          download_url: `${baseUrl}/files/${filename}?download=true`,
          filename,
          original_name: `${summary.host}.zip`,
          size: zipBuffer.length,
          size_formatted: formatFileSize(zipBuffer.length),
          mimetype: "application/zip",
          expires_in: TTL,
          expires_in_formatted: formattedExpiry,
          expires_at,
          sourceMaps: summary.sourceMaps,
          stats: { totalFiles: summary.totalFiles, totalBytes: summary.totalBytes, byType: summary.byType },
          errors: summary.errors.length,
          skipped: summary.skipped.length,
        },
        timestamp: Date.now(),
      })
    } catch (e) {
      logger.error(`[CLONEWEB] Internal error | ip=${req.ip} | error=${e.message}`)
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal clone website",
        durationMs: Date.now() - started,
      })
    } finally {
      // bersihkan folder kerja crawl (temp)
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  },
}

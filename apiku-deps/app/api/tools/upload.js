/**
 * @license
 * Copyright (C) 2026 BAWORBAWORID
 * GPL-3.0
 */

import multer from "multer"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const EXPIRY_DB = path.join(process.cwd(), "data", "exp.json")
if (!fs.existsSync(path.dirname(EXPIRY_DB))) fs.mkdirSync(path.dirname(EXPIRY_DB), { recursive: true })
if (!fs.existsSync(EXPIRY_DB)) fs.writeFileSync(EXPIRY_DB, "[]")

// In-memory map of active timers: filename -> setTimeout id
const activeTimers = new Map()

// 🔒 Multer config aman — disk storage (tidak load ke RAM)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, randomName(file.originalname))
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
})

function randomName(original) {
  return crypto.randomBytes(16).toString("hex") + path.extname(original || "")
}

/**
 * Calculate expiry time in milliseconds
 * @param {string|number} exp - Expiry value
 * @param {string} unit - Expiry unit (menit, jam, hari, minggu, bulan, tahun)
 * @returns {number} Milliseconds until expiry
 */
function calculateExpiry(exp, unit = "menit") {
  const expNum = parseInt(exp) || 5
  const unitLower = unit.toLowerCase()
  
  const multipliers = {
    menit: 60 * 1000,
    jam: 60 * 60 * 1000,
    hari: 24 * 60 * 60 * 1000,
    minggu: 7 * 24 * 60 * 60 * 1000,
    bulan: 30 * 24 * 60 * 60 * 1000, // approx 30 days
    tahun: 365 * 24 * 60 * 60 * 1000, // approx 365 days
  }
  
  const multiplier = multipliers[unitLower] || multipliers.menit
  
  // Max expiry: 1 tahun (365 days)
  const maxExpiry = multipliers.tahun
  const calculated = expNum * multiplier
  
  return Math.min(calculated, maxExpiry)
}

/**
 * Format expiry time for display
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string
 */
function formatExpiry(ms) {
  if (ms <= 0) return "expired"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  
  if (years > 0) return `${years} tahun${years > 1 ? '' : ''}`
  if (months > 0) return `${months} bulan${months > 1 ? '' : ''}`
  if (weeks > 0) return `${weeks} minggu${weeks > 1 ? '' : ''}`
  if (days > 0) return `${days} hari${days > 1 ? '' : ''}`
  if (hours > 0) return `${hours} jam${hours > 1 ? '' : ''}`
  if (minutes > 0) return `${minutes} menit${minutes > 1 ? '' : ''}`
  return `${seconds} detik`
}

export default {
  name: "Tourl",
  description: "Temporary file upload → get URL (auto delete with custom expiry)",
  category: "Tools",
  methods: ["POST"],
  params: ["file", "exp", "unit"],
  paramsSchema: {
    file: { 
      type: "file", 
      required: true,
      description: "File to upload"
    },
    exp: { 
      type: "number", 
      required: false,
      default: 5,
      description: "Expiry duration value",
      example: "10"
    },
    unit: { 
      type: "string", 
      required: false,
      enum: ["menit", "jam", "hari", "minggu", "bulan", "tahun"],
      default: "menit",
      description: "Expiry duration unit"
    },
  },

  async run(req, res) {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          logger.warn(`[TOURL] Upload failed (FILE TOO LARGE) | ip=${req.ip}`)
          return res.status(413).json({
            status: false,
            message: "File too large (max 20MB)",
          })
        }

        logger.error(`[TOURL] Multer error | ip=${req.ip} | error=${err.message}`)
        return res.status(400).json({
          status: false,
          message: err.message || "Upload error",
        })
      }

      if (!req.file) {
        logger.warn(`[TOURL] No file uploaded | ip=${req.ip}`)
        return res.status(400).json({
          status: false,
          message: "No file uploaded (field name must be 'file')",
        })
      }

      try {
        // Parse expiry parameters
        const exp = req.body?.exp || req.query?.exp || "5"
        const unit = req.body?.unit || req.query?.unit || "menit"
        
        // Calculate TTL
        const TTL = calculateExpiry(exp, unit)
        const formattedExpiry = formatExpiry(TTL)
        
        // Generate filename
        const filename = req.file.filename
        const filePath = path.join(uploadDir, filename)

        // Generate URL — force production domain (not localhost)
        const host = req.get('x-forwarded-host') || req.get('host') || ''
        const isLocal = !host || host.includes('localhost') || host.includes('127.0.0.1')
        const baseUrl = isLocal ? 'https://api.zyvor.my.id' : `${req.get('x-forwarded-proto') || 'https'}://${host}`
        const url = `${baseUrl}/files/${filename}`

        // 💾 Save expiry data to data/exp.json for persistence
        const expires_at = new Date(Date.now() + TTL).toISOString()
        addExpiryEntry({ filename, expiresAt: expires_at, filePath, originalName: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype })

        // ⏱️ auto delete based on custom expiry
        const timerId = setTimeout(() => {
          activeTimers.delete(filename)
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
            removeExpiryEntry(filename)
            logger.info(`[TOURL] File expired & deleted | file=${filename} | expiry=${formattedExpiry}`)
          }
        }, TTL)
        activeTimers.set(filename, timerId)

        /* ===============================
           ✅ SUCCESS LOG
        ================================ */
        logger.info(
          `[TOURL] Upload success | ip=${req.ip} | file=${req.file.originalname} | size=${req.file.size} | savedAs=${filename} | expiry=${formattedExpiry}`
        )

        return res.json({
          status: true,
          tool: "tourl",
          result: {
            url,
            download_url: `${baseUrl}/files/${filename}?download=true`,
            filename: filename,
            original_name: req.file.originalname,
            size: req.file.size,
            size_formatted: formatFileSize(req.file.size),
            mimetype: req.file.mimetype,
            expires_in: TTL,
            expires_in_formatted: formattedExpiry,
            expires_at,
            expiry_config: {
              value: exp,
              unit: unit,
              note: "File akan otomatis dihapus setelah waktu expire"
            }
          },
          timestamp: Date.now(),
        })
      } catch (e) {
        /* ===============================
           ❌ INTERNAL ERROR (500)
        ================================ */
        logger.error(`[TOURL] Internal error | ip=${req.ip} | error=${e.message}`)
        return res.status(500).json({
          status: false,
          message: "Failed to save file",
        })
      }
    })
  },
}

/**
 * Format file size
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// ============================================================
// 📦 Expiry Database (data/exp.json)
// ============================================================

/**
 * Read all pending expiry entries from data/exp.json
 */
function readExpiryDb() {
  try {
    const raw = fs.readFileSync(EXPIRY_DB, "utf-8").trim()
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    logger.error(`[TOURL-Exp] Failed to read exp.json: ${e.message}`)
    return []
  }
}

/**
 * Write expiry entries to data/exp.json
 */
function writeExpiryDb(entries) {
  try {
    fs.writeFileSync(EXPIRY_DB, JSON.stringify(entries, null, 2))
  } catch (e) {
    logger.error(`[TOURL-Exp] Failed to write exp.json: ${e.message}`)
  }
}

/**
 * Add a new expiry entry to data/exp.json
 */
function addExpiryEntry(entry) {
  const entries = readExpiryDb()
  entries.push(entry)
  writeExpiryDb(entries)
}

/**
 * Remove an expiry entry from data/exp.json by filename
 */
function removeExpiryEntry(filename) {
  const entries = readExpiryDb().filter(e => e.filename !== filename)
  writeExpiryDb(entries)
}

/**
 * Load pending deletions from data/exp.json and re-schedule them.
 * Called automatically at startup so expiry survives server restarts.
 */
function loadPendingDeletions() {
  try {
    const entries = readExpiryDb()
    const now = Date.now()
    let restored = 0
    let expired = 0

    for (const entry of entries) {
      const { filename, expiresAt, filePath } = entry
      const remaining = new Date(expiresAt).getTime() - now

      if (remaining <= 0) {
        // Already expired — delete now + remove from DB
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
        expired++
      } else {
        // Still pending — re-schedule
        if (!fs.existsSync(filePath)) {
          // File already gone, skip
          expired++
          continue
        }
        const timerId = setTimeout(() => {
          activeTimers.delete(filename)
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
            removeExpiryEntry(filename)
            logger.info(`[TOURL-Exp] File expired & deleted (recovered) | file=${filename}`)
          }
        }, remaining)
        activeTimers.set(filename, timerId)
        restored++
      }
    }

    // Clean up DB — remove expired entries
    const valid = readExpiryDb().filter(e => {
      const remaining = new Date(e.expiresAt).getTime() - Date.now()
      return remaining > 0 && fs.existsSync(e.filePath)
    })
    writeExpiryDb(valid)

    if (restored > 0 || expired > 0) {
      logger.info(`[TOURL-Exp] Startup recovery | restored=${restored} pending | cleaned=${expired} expired`)
    }
  } catch (e) {
    logger.error(`[TOURL-Exp] Startup recovery failed: ${e.message}`)
  }
}

// 🔄 Load pending deletions at startup (also exported for explicit startup call from index.js)
export { loadPendingDeletions }
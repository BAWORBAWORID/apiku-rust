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

export default {
  name: "Tourl2",
  description: "Permanent file upload → get URL (no auto delete)",
  category: "Tools",
  methods: ["POST"],
  params: ["file"],
  paramsSchema: {
    file: {
      type: "file",
      required: true,
      description: "File to upload"
    },
  },

  async run(req, res) {
    upload.single("file")(req, res, async (err) => {

      /* ===============================
         ❌ MULTER ERROR (LOGGED)
      ================================ */
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          logger.warn(
            `[TOURL2] Upload failed (FILE TOO LARGE) | ip=${req.ip}`
          )
          return res.status(413).json({
            status: false,
            message: "File too large (max 20MB)",
          })
        }

        logger.error(
          `[TOURL2] Multer error | ip=${req.ip} | error=${err.message}`
        )

        return res.status(400).json({
          status: false,
          message: err.message || "Upload error",
        })
      }

      if (!req.file) {
        logger.warn(
          `[TOURL2] No file uploaded | ip=${req.ip}`
        )
        return res.status(400).json({
          status: false,
          message: "No file uploaded (field name must be 'file')",
        })
      }

      try {
        const filename = req.file.filename
        const filePath = path.join(uploadDir, filename)

        // Generate URL — force production domain (not localhost)
        const host = req.get('x-forwarded-host') || req.get('host') || ''
        const isLocal = !host || host.includes('localhost') || host.includes('127.0.0.1')
        const baseUrl = isLocal ? 'https://api.zyvor.my.id' : `${req.get('x-forwarded-proto') || 'https'}://${host}`
        const url = `${baseUrl}/files/${filename}`

        /* ===============================
           ✅ SUCCESS LOG
        ================================ */
        logger.info(
          `[TOURL2] Upload success | ip=${req.ip} | file=${req.file.originalname} | size=${req.file.size} | savedAs=${filename}`
        )

        return res.json({
          status: true,
          tool: "tourl2",
          result: {
            url,
            download_url: `${baseUrl}/files/${filename}?download=true`,
            filename: filename,
            original_name: req.file.originalname,
            size: req.file.size,
            size_formatted: formatFileSize(req.file.size),
            mimetype: req.file.mimetype,
          },
          timestamp: Date.now(),
        })
      } catch (e) {
        /* ===============================
           ❌ INTERNAL ERROR (500)
        ================================ */
        logger.error(
          `[TOURL2] Internal error | ip=${req.ip} | error=${e.message}`
        )

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

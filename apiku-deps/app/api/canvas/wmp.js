/**
 * Windows Media Player Canvas API
 * Overlay text onto Windows Media Player template
 *
 * @route {GET|POST} /api/canvas/wmp
 * @param {string} text - Text to render (split by newline for POST, | for GET)
 *
 * @example
 * GET /api/canvas/wmp?text=kenapa%20ya|yang%20tulus|sering%20kalah
 * POST /api/canvas/wmp -d { "text": "kenapa ya\nyang tulus\nsering kalah" }
 */

import { createCanvas, loadImage, registerFont } from "canvas"
import https from "https"
import http from "http"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import logger from "../../src/utils/logger.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// WMP assets live in a per-endpoint subfolder for consistency with all other canvas endpoints
const ASSETS_DIR = path.join(__dirname, "assets", "wmp")
const FONT_PATH = path.join(ASSETS_DIR, "ArialBold.ttf")
const BG_PATH = path.join(ASSETS_DIR, "bg.jpg")

const FONT_URL = "https://raw.githubusercontent.com/skayhayato-cmyk/canvas/main/Arial%20Bold.ttf"
const BG_URL = "https://api.nexadev.my.id/uploder/uploads/TyIyEi.jpg"

// ========== DOWNLOAD HELPER ==========

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      return resolve()
    }
    const file = fs.createWriteStream(dest)
    const client = url.startsWith("https") ? https : http
    client
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          fs.unlink(dest, () => {})
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        res.pipe(file)
        file.on("finish", () => file.close(() => resolve()))
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {})
        reject(err)
      })
  })
}

// ========== BOOTSTRAP ASSETS ==========

let bootstrapped = false

async function bootstrap() {
  if (bootstrapped && fs.existsSync(FONT_PATH) && fs.existsSync(BG_PATH)) return
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
  await downloadFile(FONT_URL, FONT_PATH)
  await downloadFile(BG_URL, BG_PATH)
  registerFont(FONT_PATH, { family: "ArialBold" })
  bootstrapped = true
  logger.info("[WMP] Assets ready (font & background)")
}

// ========== CANVAS GENERATOR ==========

async function generateImage(lines) {
  const bg = await loadImage(BG_PATH)
  const W = bg.width
  const H = bg.height

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext("2d")

  ctx.drawImage(bg, 0, 0, W, H)

  const BOX_Y = H * 0.301
  const BOX_W = W * 0.735
  const BOX_H = H * 0.469

  const DROP_PAD_TOP = BOX_H * 0.025
  const DROP_PAD_BOTTOM = BOX_H * 0.15

  const DROP_Y = BOX_Y + DROP_PAD_TOP
  const DROP_H = BOX_H - DROP_PAD_TOP - DROP_PAD_BOTTOM

  const TEXT_X = W * 0.118
  const TEXT_MAX_W = BOX_W * 0.5

  const MAX_FONT = Math.floor(H * 0.11)
  const MIN_FONT = 10

  let fontSize = MAX_FONT
  ctx.textBaseline = "top"

  while (fontSize > MIN_FONT) {
    ctx.font = `${fontSize}px "ArialBold"`
    const lineH = fontSize * 1.3
    const totalH = lines.length * lineH
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width))

    if (totalH <= DROP_H && maxW <= TEXT_MAX_W) break
    fontSize -= 2
  }

  const lineHeight = fontSize * 1.3
  const totalH = lines.length * lineHeight
  const startY = DROP_Y + (DROP_H - totalH) / 2

  ctx.font = `${fontSize}px "ArialBold"`
  ctx.fillStyle = "#111111"

  lines.forEach((line, i) => {
    ctx.fillText(line, TEXT_X, startY + i * lineHeight)
  })

  return canvas
}

// ========== ENDPOINT HANDLER ==========

export default {
  name: "Windows Media Player Canvas",
  description:
    "Overlay teks ke template Windows Media Player. Untuk GET, pisahkan baris dengan | (pipe). Untuk POST, gunakan newline.",
  category: "Canvas",

  methods: ["GET", "POST"],

  params: ["text"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks yang akan ditampilkan. GET: pisah baris dgn |. POST: newline.",
      example: "kenapa ya|yang tulus|sering kalah",
      minLength: 1,
      maxLength: 1000,
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      // Bootstrap assets on first run
      await bootstrap()

      // Extract text
      let raw = ""
      if (req.method === "GET") {
        raw = (req.query.text || "").trim()
      } else {
        raw = (req.body?.text || "").trim()
      }

      if (!raw) {
        return res.status(400).json({
          status: false,
          message: 'Parameter "text" wajib diisi',
          example: {
            GET: "/api/canvas/wmp?text=kenapa%20ya|yang%20tulus|sering%20kalah",
            POST: { text: "kenapa ya\nyang tulus\nsering kalah" },
          },
        })
      }

      // Split into lines
      const lines =
        req.method === "GET"
          ? raw.split("|").map((l) => l.trim()).filter(Boolean)
          : raw.split("\n").map((l) => l.trim()).filter(Boolean)

      if (lines.length === 0) {
        return res.status(400).json({
          status: false,
          message: "Teks tidak boleh kosong setelah dipisah baris",
        })
      }

      // Generate canvas
      const canvas = await generateImage(lines)

      // Send JPEG response
      const buffer = canvas.toBuffer("image/jpeg", { quality: 0.95 })
      const duration = Date.now() - startTime

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("Content-Disposition", 'inline; filename="wmp-result.jpg"')
      res.setHeader("X-Generated-In", `${duration}ms`)

      logger.info(`[WMP] Generated ${lines.length} lines in ${duration}ms`)
      return res.send(buffer)
    } catch (err) {
      const duration = Date.now() - startTime
      logger.error(`[WMP] Error after ${duration}ms: ${err.message}`)

      if (res.headersSent) return res.end()

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal generate gambar WMP",
      })
    }
  },
}

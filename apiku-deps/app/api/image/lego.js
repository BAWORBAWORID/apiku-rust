/**
 * Image to Lego Converter
 * Transform images into Lego brick pixel art
 *
 * @route {GET|POST} /api/image/lego
 * @param {string} url - Image URL to convert (required)
 * @param {number} cols - Number of Lego bricks horizontally (default: 40, max: 150)
 * @param {number} brick - Brick size in pixels (default: 20, min: 8, max: 80)
 *
 * @example
 * GET /api/image/lego?url=https://example.com/image.jpg&cols=40&brick=20
 * POST /api/image/lego -d { "url": "https://example.com/image.jpg", "cols": 30 }
 */

import { createCanvas, loadImage } from "canvas"
import https from "https"
import http from "http"
import logger from "../../src/utils/logger.js"

// ========== LEGO COLOR PALETTE (24 colors) ==========
const LEGO_COLORS = [
  [255, 255, 255], [242, 243, 242], [163, 162, 165], [99, 95, 97],
  [27, 42, 52],    [0, 0, 0],       [196, 40, 27],   [218, 134, 122],
  [255, 148, 10],  [254, 205, 10],  [237, 125, 28],  [240, 188, 60],
  [160, 188, 60],  [75, 151, 74],   [17, 87, 64],    [0, 138, 128],
  [0, 85, 191],    [104, 195, 226], [101, 103, 141], [154, 0, 100],
  [220, 138, 201], [149, 85, 51],   [88, 57, 39],    [255, 240, 210],
]

// ========== HELPERS ==========

function fetchImageBuffer(imageUrl) {
  return new Promise((resolve, reject) => {
    const protocol = imageUrl.startsWith("https") ? https : http
    protocol.get(imageUrl, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => resolve(Buffer.concat(chunks)))
      res.on("error", reject)
    }).on("error", reject)
  })
}

function nearestLegoColor(r, g, b) {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < LEGO_COLORS.length; i++) {
    const [lr, lg, lb] = LEGO_COLORS[i]
    const dist = (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return LEGO_COLORS[best]
}

function rgbToHex(r, g, b) {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

// ========== MAIN PROCESSOR ==========

async function generateLegoImage(imageUrl, cols = 40, brickSize = 20) {
  // Clamp params
  const cCols = Math.max(5, Math.min(150, parseInt(cols) || 40))
  const cBrick = Math.max(8, Math.min(80, parseInt(brickSize) || 20))

  // Download & load image
  const imgBuffer = await fetchImageBuffer(imageUrl)
  const img = await loadImage(imgBuffer)

  // Calculate rows to maintain aspect ratio
  const rows = Math.round(cCols * (img.height / img.width))

  // Create temp canvas to resize & get pixels
  const tempCanvas = createCanvas(cCols, rows)
  const tempCtx = tempCanvas.getContext("2d")
  tempCtx.drawImage(img, 0, 0, cCols, rows)
  const imageData = tempCtx.getImageData(0, 0, cCols, rows)
  const pixels = imageData.data

  // Build grid of Lego colors
  const grid = []
  for (let y = 0; y < rows; y++) {
    const row = []
    for (let x = 0; x < cCols; x++) {
      const idx = (y * cCols + x) * 4
      const r = pixels[idx]
      const g = pixels[idx + 1]
      const b = pixels[idx + 2]
      row.push(nearestLegoColor(r, g, b))
    }
    grid.push(row)
  }

  // Render Lego canvas
  const canvasW = cCols * cBrick
  const canvasH = rows * cBrick
  const canvas = createCanvas(canvasW, canvasH)
  const ctx = canvas.getContext("2d")

  const studR = Math.round(cBrick * 0.35)
  const studOffset = Math.round(cBrick / 2)
  const strokeW = Math.max(1, cBrick * 0.07)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cCols; x++) {
      const [r, g, b] = grid[y][x]
      const hex = rgbToHex(r, g, b)
      const darker = rgbToHex(
        Math.round(r * 0.75),
        Math.round(g * 0.75),
        Math.round(b * 0.75)
      )

      const bx = x * cBrick
      const by = y * cBrick
      const cx = bx + studOffset
      const cy = by + studOffset

      // Brick base
      ctx.fillStyle = hex
      ctx.strokeStyle = "#00000022"
      ctx.lineWidth = 0.5
      ctx.fillRect(bx, by, cBrick, cBrick)
      ctx.strokeRect(bx, by, cBrick, cBrick)

      // Stud (circle on top)
      ctx.beginPath()
      ctx.arc(cx, cy, studR, 0, Math.PI * 2)
      ctx.fillStyle = hex
      ctx.fill()
      ctx.strokeStyle = darker
      ctx.lineWidth = strokeW
      ctx.stroke()
    }
  }

  return canvas.toBuffer("image/png")
}

// ========== ENDPOINT ==========

export default {
  name: "Image to Lego Converter",
  description:
    "Transform images into Lego brick pixel art. Parameter: url (wajib), cols (default 40, max 150), brick (default 20, min 8, max 80). Output PNG.",
  category: "Image",

  methods: ["GET", "POST"],

  params: ["url", "cols", "brick"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan diubah menjadi Lego pixel art",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      minLength: 5,
      maxLength: 2000,
    },
    cols: {
      type: "number",
      required: false,
      default: 40,
      description: "Jumlah brick horizontal (5-150, default 40)",
      example: 40,
      min: 5,
      max: 150,
    },
    brick: {
      type: "number",
      required: false,
      default: 20,
      description: "Ukuran setiap brick dalam pixel (8-80, default 20)",
      example: 20,
      min: 8,
      max: 80,
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const params = { ...req.query, ...req.body }
      const { url, cols, brick } = params

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi (URL gambar)",
          example: {
            GET: "/api/image/lego?url=https://example.com/image.jpg&cols=40&brick=20",
            POST: { url: "https://example.com/image.jpg", cols: 40, brick: 20 },
          },
        })
      }

      // Validate URL
      try {
        new URL(url)
      } catch {
        return res.status(400).json({
          status: false,
          message: "URL tidak valid",
        })
      }

      // Process
      const pngBuffer = await generateLegoImage(url, cols, brick)
      const duration = Date.now() - startTime

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", pngBuffer.length)
      res.setHeader("X-Generated-In", `${duration}ms`)

      logger.info(`[Lego] Generated ${pngBuffer.length} bytes in ${duration}ms`)
      return res.send(pngBuffer)
    } catch (err) {
      const duration = Date.now() - startTime
      logger.error(`[Lego] Error after ${duration}ms: ${err.message}`)

      if (res.headersSent) return res.end()

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mengkonversi gambar ke Lego",
      })
    }
  },
}

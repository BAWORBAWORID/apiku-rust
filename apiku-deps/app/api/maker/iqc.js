import axios from "axios"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import logger from "../../src/utils/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ASSETS_DIR = join(__dirname, "assets", "iqc")

const RIN_BG_URL = "https://raw.githubusercontent.com/ryyntwx/allimagerin/refs/heads/main/IMG-20260703-WA0651.jpg"
const RIN_BG_LOCAL = join(ASSETS_DIR, "quotes-bg.jpg")

async function ensureBg() {
  await mkdir(ASSETS_DIR, { recursive: true })
  if (!existsSync(RIN_BG_LOCAL)) {
    const res = await axios.get(RIN_BG_URL, { responseType: "arraybuffer", maxRedirects: 5 })
    await writeFile(RIN_BG_LOCAL, Buffer.from(res.data))
  }
  return RIN_BG_LOCAL
}

export default {
  name: "IQC Quotes",
  description: "Generator quotes card dengan background custom untuk IQC",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["text", "author"],
  
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks quotes",
      example: "ketika kamu kesepian, carilah dirimu sendiri",
    },
    author: {
      type: "string",
      required: false,
      description: "Nama penulis quotes",
      example: "Zyvor",
    },
  },

  async run(req, res) {
    try {
      const text = req.query?.text || req.body?.text
      const author = req.query?.author || req.body?.author || "Zyvor"

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi",
          example: { text: "quotes kamu", author: "nama kamu" },
        })
      }

      const bgPath = await ensureBg()

      const canvas = createCanvas(1280, 946)
      const ctx = canvas.getContext("2d")

      const bgImg = await loadImage(bgPath)
      ctx.drawImage(bgImg, 0, 0, 1280, 946)

      const textX = 105
      const maxWidth = 500
      const fontSize = 54
      const gapY = 45
      const colorText = "#004d26"
      const colorAuthor = "#2e7d32"

      ctx.font = `bold ${fontSize}px sans-serif`
      const lineHeight = fontSize * 1.3

      function wrapText(text, maxW) {
        const words = text.split(" ")
        const lines = []
        let current = ""
        for (const word of words) {
          const test = current + (current ? " " : "") + word
          if (ctx.measureText(test).width > maxW && current) {
            lines.push(current)
            current = word
          } else {
            current = test
          }
        }
        if (current) lines.push(current)
        return lines
      }

      const lines = wrapText(text, maxWidth)
      const availableHeight = 750
      const totalTextHeight = lines.length * lineHeight
      const totalCombinedHeight = totalTextHeight + (author ? gapY + 34 : 0)

      let textY = 100 + (availableHeight - totalCombinedHeight) / 2
      if (textY < 100) textY = 100

      ctx.fillStyle = colorText
      ctx.textAlign = "left"
      ctx.textBaseline = "top"

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), textX, textY + i * lineHeight)
      }

      if (author) {
        const authorY = textY + totalTextHeight + gapY
        const authorX = textX + maxWidth / 3 - maxWidth * 0.03

        ctx.fillStyle = colorAuthor
        ctx.font = "bold 34px sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "top"

        ctx.fillText(`— ${author}`, authorX, authorY)
      }

      const buf = await canvas.encode("png")

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buf.length)
      return res.send(buf)
    } catch (err) {
      logger.error(`[MAKER-IQC] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message })
    }
  },
}
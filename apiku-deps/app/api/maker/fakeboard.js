import fs from "fs"
import path from "path"
import https from "https"
import { fileURLToPath } from "url"
import { createCanvas, loadImage, registerFont } from "canvas"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ASSETS_DIR = path.join(__dirname, "assets", "fakeboard")
const FONT_DIR = path.join(ASSETS_DIR, "fonts")
const FONT_PATH = path.join(FONT_DIR, "Poppins-Bold.ttf")
const BG_PATH = path.join(ASSETS_DIR, "bg.jpg")

let fontReady = false
async function ensureFont() {
  if (fontReady) return
  if (!fs.existsSync(FONT_DIR)) fs.mkdirSync(FONT_DIR, { recursive: true })

  if (!fs.existsSync(FONT_PATH)) {
    const FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf"
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(FONT_PATH)
      https.get(FONT_URL, (res) => {
        if (res.statusCode !== 200) {
          file.close(); fs.unlink(FONT_PATH, () => {})
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        res.pipe(file)
        file.on("finish", () => file.close(resolve))
      }).on("error", (err) => { fs.unlink(FONT_PATH, () => {}); reject(err) })
    })
  }

  try {
    registerFont(FONT_PATH, { family: "SignFont" })
    fontReady = true
  } catch (e) {
    console.error("Font reg error:", e.message)
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.trim().split(/\s+/)
  let lines = [], line = ""
  for (const word of words) {
    const testLine = line ? line + " " + word : word
    if (ctx.measureText(testLine).width > maxWidth) {
      if (line) lines.push(line)
      line = word
    } else {
      line = testLine
    }
  }
  if (line) lines.push(line)
  return lines
}

export default {
  name: "Fake Board",
  description: "Membuat gambar papan quote/kutipan dengan background custom",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["teks", "author"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Teks quote untuk ditampilkan di papan",
      default: "Kata2"
    },
    author: {
      type: "string",
      required: true,
      description: "Nama author",
      default: "Zyvor",
      example: "Zyvor"
    }
  },

  async run(req, res) {
    try {
      let { teks, author } = { ...req.query, ...req.body }
      const quote = teks && teks.trim() ? teks.trim().toUpperCase() : ""
      author = author ? author.trim() : ""

      await ensureFont()

      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`Background template tidak ditemukan: ${BG_PATH}`)
      }

      const bg = await loadImage(BG_PATH)
      const W = bg.width, H = bg.height
      const canvas = createCanvas(W, H)
      const ctx = canvas.getContext("2d")
      ctx.drawImage(bg, 0, 0, W, H)

      const boxX = W * 0.255
      const boxY = H * 0.275
      const boxW = W * 0.49
      const boxH = H * 0.555
      const paddingX = boxW * 0.1
      const MAX_WIDTH = boxW - paddingX * 2
      const MAX_HEIGHT = boxH * 0.78

      let fontSize = Math.floor(boxW * 0.135)
      let lines = []
      while (fontSize >= 20) {
        ctx.font = `bold ${fontSize}px SignFont`
        lines = wrapText(ctx, quote, MAX_WIDTH)
        if (lines.length * fontSize * 1.22 <= MAX_HEIGHT) break
        fontSize -= 2
      }

      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = "#3a3a3a"
      ctx.font = `bold ${fontSize}px SignFont`

      const lineHeight = fontSize * 1.22
      const totalHeight = lines.length * lineHeight
      const CENTER_X = boxX + boxW / 2
      const textBlockCenterY = boxY + boxH * 0.46
      const startY = textBlockCenterY - totalHeight / 2 + lineHeight / 2

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], CENTER_X, startY + i * lineHeight)
      }

      const creditSize = Math.floor(boxW * 0.058)
      ctx.font = `bold ${creditSize}px SignFont`
      ctx.textAlign = "left"
      ctx.textBaseline = "alphabetic"
      ctx.fillText(author, boxX + paddingX * 0.6, boxY + boxH - boxH * 0.05)

      const buffer = canvas.toBuffer("image/png")
      res.set("Content-Type", "image/png")
      res.send(buffer)

    } catch (err) {
      res.status(500).json({ status: false, message: err.message })
    }
  }
}

import fs from "fs"
import path from "path"
import https from "https"
import { fileURLToPath } from "url"
import { createCanvas, loadImage, registerFont } from "canvas"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ASSETS_DIR = path.join(__dirname, "assets", "fakebook")
const FONT_DIR = path.join(ASSETS_DIR, "fonts")
const FONT_PATH = path.join(FONT_DIR, "Quicksand-Bold.ttf")
const BG_PATH = path.join(ASSETS_DIR, "bg.jpg")

let fontReady = false
async function ensureFont() {
  if (fontReady) return
  if (!fs.existsSync(FONT_DIR)) fs.mkdirSync(FONT_DIR, { recursive: true })

  if (!fs.existsSync(FONT_PATH)) {
    const FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf"
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
    registerFont(FONT_PATH, { family: "BookFont" })
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
  name: "Fake Book",
  description: "Membuat gambar quote gaya buku/halaman dengan Quicksand font",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Teks quote yang akan ditampilkan di halaman buku"
    }
  },

  async run(req, res) {
    try {
      let { teks } = { ...req.query, ...req.body }

      if (!teks || !teks.trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" })
      }

      let quote = teks.trim().toUpperCase()

      await ensureFont()

      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`Background template tidak ditemukan: ${BG_PATH}`)
      }

      const bg = await loadImage(BG_PATH)
      const W = bg.width, H = bg.height
      const canvas = createCanvas(W, H)
      const ctx = canvas.getContext("2d")
      ctx.drawImage(bg, 0, 0, W, H)

      const boxX = W * 0.265
      const boxY = H * 0.41
      const boxW = W * 0.66
      const boxH = H * 0.37

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"

      const MAX_WIDTH = boxW
      const MAX_HEIGHT = boxH

      let fontSize = Math.floor(boxW * 0.092)
      let lines = []
      while (fontSize >= 18) {
        ctx.font = `bold ${fontSize}px BookFont`
        lines = wrapText(ctx, quote, MAX_WIDTH)
        const lineHeight = fontSize * 1.55
        if (lines.length * lineHeight <= MAX_HEIGHT) break
        fontSize -= 2
      }

      ctx.textAlign = "left"
      ctx.textBaseline = "alphabetic"
      ctx.fillStyle = "#0d0d0d"
      ctx.shadowColor = "rgba(0,0,0,0.15)"
      ctx.shadowBlur = 1.2
      ctx.shadowOffsetY = 0.5
      ctx.font = `bold ${fontSize}px BookFont`

      const lineHeight = fontSize * 1.55
      const totalHeight = lines.length * lineHeight
      const startY = boxY + (boxH - totalHeight) / 2 + fontSize

      for (let i = 0; i < lines.length; i++) {
        let cx = boxX
        const y = startY + i * lineHeight
        const chars = lines[i].split("")
        for (const ch of chars) {
          ctx.fillText(ch, cx, y)
          cx += ctx.measureText(ch).width + fontSize * 0.045
        }
      }

      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      const buffer = canvas.toBuffer("image/png")
      res.set("Content-Type", "image/png")
      res.send(buffer)

    } catch (err) {
      res.status(500).json({ status: false, message: err.message })
    }
  }
}

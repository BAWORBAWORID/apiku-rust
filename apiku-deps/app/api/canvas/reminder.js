import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// ESM __dirname — points to api/canvas/ folder
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FONT_URL = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Font/CrimsonText-Regular.ttf"
const BG_URL = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/_20260425155846190.jpeg"
// Local fallback paths (auto-resolved relative to this file)
const LOCAL_FONT_PATH = path.join(__dirname, "assets", "CrimsonText-Regular.ttf")
const LOCAL_BG_PATH = path.join(__dirname, "assets", "_20260425155846190.jpeg")

const PADDING_RATIO = 0.15
const FOOTER_RATIO = 0.12
const QUOTE_COLOR = "#1a1a1a"
const FONT_SIZE_MAX = 60
const FONT_SIZE_MIN = 20

function calcFontSize(ctx, text, maxWidth, maxHeight, fontName) {
  const words = text.split(" ")
  for (let size = FONT_SIZE_MAX; size >= FONT_SIZE_MIN; size -= 1) {
    ctx.font = `${size}px ${fontName}`
    const lineHeight = size * 1.35
    let lines = 0, currentLine = []
    words.forEach(word => {
      const testLine = [...currentLine, word].join(" ").replace(/[\[\]]/g, "")
      if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
        lines++
        currentLine = [word]
      } else { currentLine.push(word) }
    })
    lines++
    if (lines * lineHeight <= maxHeight) return size
  }
  return FONT_SIZE_MIN
}

function drawTextJustified(ctx, text, centerX, centerY, maxWidth, fontSize) {
  const lineHeight = fontSize * 1.35
  const words = text.split(" ")
  let lines = [], currentLine = []

  words.forEach(word => {
    const testLine = [...currentLine, word].join(" ").replace(/[\[\]]/g, "")
    if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = [word]
    } else { currentLine.push(word) }
  })
  lines.push(currentLine)

  let startY = centerY - ((lines.length - 1) * lineHeight) / 2

  lines.forEach((line, index) => {
    const isLastLine = index === lines.length - 1
    const lineParts = line.map(word => {
      const match = word.match(/^\[(.+?)\]([^\w]*)$/)
      if (match) {
        const highlighted = match[1], trailing = match[2]
        const hlWidth = ctx.measureText(highlighted).width
        const trailWidth = ctx.measureText(trailing).width
        return { content: highlighted, trailing, isHighlight: true, width: hlWidth + trailWidth, hlWidth }
      }
      return { content: word, trailing: "", isHighlight: false, width: ctx.measureText(word).width, hlWidth: 0 }
    })

    const totalWordsWidth = lineParts.reduce((sum, p) => sum + p.width, 0)
    let currentX, spaceWidth

    if (!isLastLine && line.length > 1) {
      spaceWidth = (maxWidth - totalWordsWidth) / (line.length - 1)
      currentX = centerX - maxWidth / 2
    } else {
      const standardSpace = ctx.measureText(" ").width
      spaceWidth = standardSpace
      currentX = centerX - (totalWordsWidth + standardSpace * (line.length - 1)) / 2
    }

    lineParts.forEach(part => {
      if (part.isHighlight) {
        ctx.fillStyle = "rgba(212, 225, 87, 0.85)"
        ctx.fillRect(currentX, startY - fontSize * 0.45, part.hlWidth, fontSize * 0.95)
      }
      ctx.fillStyle = QUOTE_COLOR
      ctx.textBaseline = "middle"
      ctx.textAlign = "left"
      ctx.fillText(part.content, currentX, startY)
      if (part.trailing) ctx.fillText(part.trailing, currentX + part.hlWidth, startY)
      currentX += part.width + spaceWidth
    })
    startY += lineHeight
  })
}

export default {
  name: "Canvas Reminder",
  description: "Generate quote image dengan highlight box style (Japanese-style justified text)",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["text", "footer"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks quote yang akan ditampilkan",
    },
    footer: {
      type: "string",
      required: false,
      description: "Teks footer (default: Someone)",
    },
  },

  async run(req, res) {
    try {
      const { text, footer } = { ...req.query, ...req.body }

      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" })
      }

      // Network-primary, local-asset fallback (so endpoint stays alive when github raw is unreachable)
      const loadFromNetworkOrLocal = async (url, localPath) => {
        try {
          const r = await axios.get(url, { responseType: "arraybuffer" })
          return Buffer.from(r.data)
        } catch (err) {
          if (fs.existsSync(localPath)) {
            console.warn(`[Reminder] Remote failed (${err.message}); using local fallback ${localPath}`)
            return fs.readFileSync(localPath)
          }
          throw new Error(`fetch failed (remote err: ${err.message}; local fallback missing at ${localPath})`)
        }
      }
      const [fontBuffer, bgBuffer] = await Promise.all([
        loadFromNetworkOrLocal(FONT_URL, LOCAL_FONT_PATH),
        loadFromNetworkOrLocal(BG_URL, LOCAL_BG_PATH)
      ])

      GlobalFonts.register(fontBuffer, "CrimsonText")
      const bg = await loadImage(bgBuffer)

      const canvas = createCanvas(bg.width, bg.height)
      const ctx = canvas.getContext("2d")
      ctx.drawImage(bg, 0, 0)

      const padding = canvas.width * PADDING_RATIO
      const footerHeight = canvas.height * FOOTER_RATIO
      const centerX = canvas.width / 2
      const maxWidth = canvas.width - padding * 2
      const quoteAreaTop = padding
      const quoteAreaHeight = canvas.height - footerHeight - quoteAreaTop
      const quoteAreaCenterY = quoteAreaTop + quoteAreaHeight / 2

      const myQuote = text
      const footerText = footer || "Someone"

      const fontSize = calcFontSize(ctx, myQuote, maxWidth, quoteAreaHeight, "CrimsonText")
      ctx.font = `${fontSize}px CrimsonText`
      drawTextJustified(ctx, myQuote, centerX, quoteAreaCenterY, maxWidth, fontSize)

      ctx.font = "26px CrimsonText"
      ctx.fillStyle = QUOTE_COLOR
      ctx.textAlign = "center"
      ctx.fillText(footerText, centerX, canvas.height - footerHeight / 2)

      res.setHeader("Content-Type", "image/jpeg")
      res.send(canvas.toBuffer("image/jpeg"))

    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Canvas Reminder failed" })
    }
  }
}

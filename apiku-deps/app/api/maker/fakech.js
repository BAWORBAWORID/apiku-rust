import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import logger from "../../src/utils/logger.js"

const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'fakech')
const FONTS_DIR = path.join(ASSET_DIR, 'fonts')
const BG_PATH = path.join(ASSET_DIR, 'bg_fakech.png')

const FONT_FILES = {
  'Inter': {
    900: 'Inter-Black-900.woff2',
    500: 'Inter-Medium-500.woff2',
    700: 'Inter-Bold-700.woff2'
  }
}

let fontsRegistered = false

function initLocalAssets() {
  if (fontsRegistered) return
  
  for (const [family, weights] of Object.entries(FONT_FILES)) {
    for (const [weight, filename] of Object.entries(weights)) {
      const fontPath = path.join(FONTS_DIR, filename)
      if (fs.existsSync(fontPath)) {
        try {
          GlobalFonts.registerFromPath(fontPath, family)
        } catch (err) {
          logger.warn(`[FAKECH] Gagal register font ${filename}: ${err.message}`)
        }
      }
    }
  }
  
  fontsRegistered = true
}

function drawCircleImage(ctx, img, x, y, radius) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2)
  ctx.restore()
}

function wrapText(ctx, text, maxWidth, fontSize, family, weight) {
  ctx.font = `${weight} ${fontSize}px ${family}`
  const words = text.split(" ")
  let lines = []
  let current = ""
  
  for (const word of words) {
    const test = current + (current ? " " : "") + word
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

export default {
  name: "Fake Channel iOS",
  description: "Generate Fake WhatsApp Channel iOS style (canvas)",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["nama", "pengikut", "jam", "ppurl"],
  paramsSchema: {
    nama: {
      type: "string",
      required: true,
      description: "Nama channel",
      example: "RINA IMUP"
    },
    pengikut: {
      type: "string",
      required: true,
      description: "Jumlah pengikut (format bebas, misal 3.621)",
      example: "3.621"
    },
    jam: {
      type: "string",
      required: true,
      description: "Waktu/jam (misal 13.10)",
      example: "13.10"
    },
    ppurl: {
      type: "string",
      required: false,
      description: "URL foto profil (opsional)",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    }
  },

  async run(req, res) {
    try {
      initLocalAssets()

      const p = { ...req.query, ...req.body }
      const nama = String(p.nama || "").trim()
      const pengikut = String(p.pengikut || "").trim()
      const jam = String(p.jam || "").trim()
      const ppurl = p.ppurl || p.pp || p.avatar || ""

      if (!nama || !pengikut || !jam) {
        return res.status(400).json({
          status: false,
          message: "Parameter wajib: nama, pengikut, jam"
        })
      }

      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`File background tidak ditemukan: ${BG_PATH}`)
      }

      let ppImg
      if (ppurl && typeof ppurl === 'string' && ppurl.startsWith('http')) {
        try {
          const ppRes = await axios.get(ppurl, { responseType: 'arraybuffer', timeout: 10000 })
          ppImg = await loadImage(Buffer.from(ppRes.data))
        } catch (err) {
          logger.warn(`[FAKECH] Gagal load ppurl, pakai fallback: ${err.message}`)
        }
      }

      if (!ppImg && fs.existsSync(BG_PATH)) {
        ppImg = await loadImage(BG_PATH)
      } else if (!ppImg) {
        throw new Error("Tidak ada foto profil yang valid")
      }

      const bg = await loadImage(BG_PATH)
      const canvas = createCanvas(bg.width, bg.height)
      const ctx = canvas.getContext('2d')

      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)

      const config = {
        pp: { x: 585, y: 622, r: 213 },
        nama: { y: 908, maxSize: 68, maxWidth: 1000 },
        pengikut: { y: 995, size: 45 },
        jam: { x: 116, y: 63, size: 43 }
      }

      drawCircleImage(ctx, ppImg, config.pp.x, config.pp.y, config.pp.r)

      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      let fontSize = config.nama.maxSize
      ctx.font = `900 ${fontSize}px Inter, sans-serif`
      while (ctx.measureText(nama).width > config.nama.maxWidth && fontSize > 14) {
        fontSize -= 2
        ctx.font = `900 ${fontSize}px Inter, sans-serif`
      }
      ctx.fillText(nama, canvas.width / 2, config.nama.y)

      const pengikutText = `${pengikut} pengikut`
      ctx.fillStyle = '#8E8E93'
      ctx.font = `500 ${config.pengikut.size}px Inter, sans-serif`
      ctx.fillText(pengikutText, canvas.width / 2, config.pengikut.y)

      ctx.fillStyle = '#FFFFFF'
      ctx.font = `700 ${config.jam.size}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(jam, config.jam.x, config.jam.y)

      const buffer = await canvas.encode('png')
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fakech")
      return res.send(buffer)

    } catch (err) {
      logger.error(`[FAKECH] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal generate Fake Channel iOS"
      })
    }
  }
}
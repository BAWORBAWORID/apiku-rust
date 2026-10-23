import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import logger from "../../src/utils/logger.js"

const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'fakegc')
const FONTS_DIR = path.join(ASSET_DIR, 'fonts')
const BG_PATH = path.join(ASSET_DIR, 'bg_fakegc.jpg')

const FONT_FILES = {
  'Inter': {
    900: 'Inter-Black-900.woff2',
    500: 'Inter-Medium-500.woff2'
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
          logger.warn(`[FAKEGC] Gagal register font ${filename}: ${err.message}`)
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

export default {
  name: "Fake Grup iOS",
  description: "Generate Fake WhatsApp Grup Chat iOS style (canvas)",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["nama", "anggota", "ppurl"],
  paramsSchema: {
    nama: {
      type: "string",
      required: true,
      description: "Nama grup",
      example: "RIN MD OFFICIAL"
    },
    anggota: {
      type: "string",
      required: true,
      description: "Jumlah anggota",
      example: "2 anggota"
    },
    ppurl: {
      type: "string",
      required: false,
      description: "URL foto profil grup (opsional)",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    }
  },

  async run(req, res) {
    try {
      initLocalAssets()

      const p = { ...req.query, ...req.body }
      const nama = String(p.nama || "").trim()
      const anggota = String(p.anggota || "").trim()
      const ppurl = p.ppurl || p.pp || p.avatar || ""

      if (!nama || !anggota) {
        return res.status(400).json({
          status: false,
          message: "Parameter wajib: nama, anggota"
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
          logger.warn(`[FAKEGC] Gagal load ppurl, pakai fallback BG: ${err.message}`)
        }
      }

      if (!ppImg) {
        ppImg = await loadImage(BG_PATH)
      }

      const bg = await loadImage(BG_PATH)
      const canvas = createCanvas(bg.width, bg.height)
      const ctx = canvas.getContext('2d')

      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)

      // Foto profil bulat
      drawCircleImage(ctx, ppImg, 538, 362, 162)

      // Nama grup (auto shrink)
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      let fontSize = 64
      ctx.font = `900 ${fontSize}px Inter, sans-serif`
      while (ctx.measureText(nama).width > 900 && fontSize > 14) {
        fontSize -= 2
        ctx.font = `900 ${fontSize}px Inter, sans-serif`
      }
      ctx.fillText(nama, 540, 602)

      // Anggota: prefix abu-abu + jumlah hijau
      const prefixText = "Grup • "
      ctx.font = `500 37px Inter, sans-serif`
      const prefixWidth = ctx.measureText(prefixText).width
      const totalWidth = prefixWidth + ctx.measureText(anggota).width
      const startX = 548 - (totalWidth / 2)

      ctx.textAlign = 'left'
      ctx.fillStyle = '#8E8E93'
      ctx.fillText(prefixText, startX, 684)

      ctx.fillStyle = '#34C759'
      ctx.fillText(anggota, startX + prefixWidth, 684)

      const buffer = await canvas.encode('png')
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fakegc")
      return res.send(buffer)

    } catch (err) {
      logger.error(`[FAKEGC] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal generate Fake Grup iOS"
      })
    }
  }
}

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import logger from "../../src/utils/logger.js"

// Direktori aset lokal (100% Murni Offline Tanpa URL Eksternal / Tanpa GitHub / Tanpa GStatic)
const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'fakebca')
const FONTS_DIR = path.join(ASSET_DIR, 'fonts')
const BG_PATH = path.join(ASSET_DIR, 'template_f1.png')

const FONT_POPPINS_PATH = path.join(FONTS_DIR, 'Poppins-SemiBold.woff2')
const FONT_INTER_MED_PATH = path.join(FONTS_DIR, 'Inter-Medium.woff2')
const FONT_INTER_BOLD_PATH = path.join(FONTS_DIR, 'Inter-Bold.woff2')

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// Inisialisasi dan pendaftaran font murni dari disk lokal
function initLocalAssets() {
  ensureDirSync(FONTS_DIR)

  if (fs.existsSync(FONT_POPPINS_PATH)) {
    GlobalFonts.registerFromPath(FONT_POPPINS_PATH, 'PoppinsBca')
  } else {
    logger.warn(`[FAKEBCA] Font lokal tidak ditemukan: ${FONT_POPPINS_PATH}`)
  }

  if (fs.existsSync(FONT_INTER_MED_PATH)) {
    GlobalFonts.registerFromPath(FONT_INTER_MED_PATH, 'InterMediumBca')
  } else {
    const fallbackFont = path.join(process.cwd(), 'api', 'maker', 'assets', 'post-ig', 'Inter-Medium.woff2')
    if (fs.existsSync(fallbackFont)) {
      GlobalFonts.registerFromPath(fallbackFont, 'InterMediumBca')
    }
  }

  if (fs.existsSync(FONT_INTER_BOLD_PATH)) {
    GlobalFonts.registerFromPath(FONT_INTER_BOLD_PATH, 'InterBoldBca')
  } else {
    const fallbackBold = path.join(process.cwd(), 'api', 'maker', 'assets', 'fakeig', 'Inter-Bold.otf')
    if (fs.existsSync(fallbackBold)) {
      GlobalFonts.registerFromPath(fallbackBold, 'InterBoldBca')
    }
  }
}

export default {
  name: "Fake BCA Canvas",
  description: "Generate Fake BCA Mobile Banking Dashboard Screenshot with custom name, account number, and balance (Creator: Rin imup lucu). 100% strictly local offline assets in api/maker/assets/fakebca/.",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["nama", "norek", "saldo"],
  paramsSchema: {
    nama: {
      type: "string",
      required: false,
      default: "RIN IMUP",
      description: "Nama pemilik rekening BCA (huruf kapital otomatis)"
    },
    norek: {
      type: "string",
      required: false,
      default: "111 - 222 - 3333",
      description: "Nomor rekening BCA"
    },
    saldo: {
      type: "string",
      required: false,
      default: "1,000,000",
      description: "Jumlah saldo BCA yang ditampilkan"
    }
  },

  async run(req, res) {
    try {
      // Panggil inisialisasi lokal murni
      initLocalAssets()

      const p = { ...req.query, ...req.body }
      const txtNama = String(p.nama || p.name || "RIN IMUP").trim().toUpperCase()
      const txtRek = String(p.norek || p.rekening || p.rek || "111 - 222 - 3333").trim()
      const txtSaldo = String(p.saldo || p.balance || "1,000,000").trim()

      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`File template lokal background (${BG_PATH}) tidak ditemukan. Pastikan file template_f1.png tersedia di folder aset.`)
      }

      const bgImg = await loadImage(BG_PATH)
      const canvas = createCanvas(bgImg.width, bgImg.height)
      const ctx = canvas.getContext('2d')

      // 1. Gambar Template Background F1 langsung dari disk lokal
      ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height)
      
      // 2. Watermark / Pattern halus latar belakang (menghargai kredit asli dari sumber)
      ctx.save()
      ctx.globalAlpha = 0.003
      ctx.fillStyle = "#FFFFFF"
      ctx.font = "700 24px InterBoldBca"
      ctx.rotate(-25 * Math.PI / 180)
      for (let y = -200; y < 1200; y += 280) {
        for (let x = -300; x < 1200; x += 400) {
          ctx.fillText(
            Buffer.from(["Unlubk1k"].join(""), "base64").toString(),
            x,
            y
          )
        }
      }
      ctx.restore()
      
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'

      // 3. Nama user di pojok kiri atas
      ctx.fillStyle = '#FFFFFF'
      ctx.font = `600 27px PoppinsBca`
      ctx.fillText(txtNama, 127, 56)

      // 4. Nomor Rekening di kartu
      ctx.fillStyle = '#FFFFFF'
      ctx.font = `500 28px InterMediumBca`
      ctx.fillText(txtRek, 211, 219)

      // 5. Ukuran Saldo
      ctx.fillStyle = '#4F4F4F'
      ctx.font = `700 43px InterBoldBca`
      ctx.fillText(txtSaldo, 156, 361)

      const buffer = await canvas.encode('png')
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fakebca-rin-local")
      return res.send(buffer)

    } catch (err) {
      logger.error(`[FAKEBCA] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal menghasilkan gambar fake BCA"
      })
    }
  }
}

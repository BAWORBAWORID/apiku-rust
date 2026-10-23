import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import logger from "../../src/utils/logger.js"

// Menyimpan aset di direktori lokal assets api/maker/assets/saldo-ovo
const ASSETS_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'saldo-ovo')

const CONFIG = {
  width: 841,
  height: 1870,
  rp: {
    text: "Rp",
    x: 61,
    y: 368,
    size: 20,
    weight: 800,
  },
  amount: {
    x: 94,
    y: 371,
    size: 28,
    weight: 800,
    color: "#FFFFFF",
  },
  fontUrls: []
}

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function formatAmount(input) {
  const digits = String(input).replace(/[^\d]/g, "") || "0";
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function generate(amountInput) {
  await ensureDir(ASSETS_DIR)

  const bgPath = path.join(ASSETS_DIR, 'ovo-bg.jpeg')
  const fontLatinPath = path.join(ASSETS_DIR, 'plus-jakarta-sans-latin-600-normal.woff2')
  const fontExtPath = path.join(ASSETS_DIR, 'plus-jakarta-sans-latin-ext-600-normal.woff2')

  GlobalFonts.registerFromPath(fontLatinPath, "Plus Jakarta Sans")
  GlobalFonts.registerFromPath(fontExtPath, "Plus Jakarta Sans")

  const bg = await loadImage(bgPath)

  const canvas = createCanvas(CONFIG.width, CONFIG.height)
  const ctx = canvas.getContext('2d')

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bg, 0, 0, CONFIG.width, CONFIG.height)

  ctx.fillStyle = CONFIG.amount.color
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"

  ctx.font = `${CONFIG.rp.weight} ${CONFIG.rp.size}px "Plus Jakarta Sans"`
  ctx.fillText(CONFIG.rp.text, CONFIG.rp.x, CONFIG.rp.y)

  const amountText = formatAmount(amountInput)

  ctx.font = `${CONFIG.amount.weight} ${CONFIG.amount.size}px "Plus Jakarta Sans"`
  ctx.fillText(amountText, CONFIG.amount.x, CONFIG.amount.y)

  return await canvas.encode('png')
}

export default {
  name: "Fake Saldo OVO",
  description: "Generate fake OVO wallet balance image",
  category: "Maker",
  methods: ["GET"],
  params: ["saldo"],

  paramsSchema: {
    saldo: {
      type: "string",
      required: false,
      default: "5000002828",
      description: "Nominal saldo",
    },
  },

  async run(req, res) {
    try {
      const { saldo = "5000002828" } = req.query || {}

      logger.info(`[OVO] Generating saldo: ${saldo}`)
      const buffer = await generate(saldo)

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fake-ovo")
      return res.send(buffer)
    } catch (error) {
      logger.error(`[OVO] Error: ${error.message}`)
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}

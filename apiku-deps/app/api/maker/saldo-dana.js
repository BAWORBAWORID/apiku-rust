import { Canvas, loadImage, FontLibrary } from 'skia-canvas'
import { writeFileSync, existsSync } from 'fs'
import path from 'path'

// Per-endpoint assets dir (offline-first, pre-populated in api/maker/assets/saldo-dana/)
const ASSETS_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'saldo-dana')

const CONFIG = {
  rp: { x: 70, y: 62, fontSize: 19, color: '#a9e6ff' },
  saldo: { x: 101, y: 53, fontSize: 29, color: '#FFFFFF' },
  icon: { gap: 8, y: 64, size: 20 },
}

async function ensureFile(remoteUrl, localPath) {
  if (!existsSync(localPath)) {
    const buf = Buffer.from(await (await fetch(remoteUrl)).arrayBuffer())
    writeFileSync(localPath, buf)
  }
}

async function loadFont(remoteUrl, name, localPath) {
  await ensureFile(remoteUrl, localPath)
  FontLibrary.use(name, localPath)
  return localPath
}

async function generate(angka) {
  const fontRpPath = path.join(ASSETS_DIR, 'iconfont.ttf')
  const fontSaldoPath = path.join(ASSETS_DIR, 'saldo-saldofont.ttf')
  const bgPath = path.join(ASSETS_DIR, 'saldo-bg.jpg')
  const eyeIconPath = path.join(ASSETS_DIR, 'eye-icon.svg')

  await loadFont('https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Font/iconfont.ttf', 'FontRp', fontRpPath)
  await loadFont('https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Font/f5803c-1772975107907.ttf', 'FontSaldo', fontSaldoPath)

  const bg = await loadImage(bgPath)
  const eyeIcon = await loadImage(eyeIconPath)

  const canvas = new Canvas(bg.width, bg.height)
  const ctx = canvas.getContext('2d')

  ctx.drawImage(bg, 0, 0)

  ctx.font = `${CONFIG.rp.fontSize}px FontRp`
  ctx.fillStyle = CONFIG.rp.color
  ctx.textBaseline = 'top'
  ctx.fillText('Rp', CONFIG.rp.x, CONFIG.rp.y)

  ctx.font = `${CONFIG.saldo.fontSize}px FontSaldo`
  ctx.fillStyle = CONFIG.saldo.color
  ctx.textBaseline = 'top'
  ctx.fillText(angka, CONFIG.saldo.x, CONFIG.saldo.y)

  const textWidth = ctx.measureText(angka).width
  const iconX = CONFIG.saldo.x + textWidth + CONFIG.icon.gap

  ctx.save()
  ctx.filter = 'brightness(0) invert(1)'
  ctx.drawImage(eyeIcon, iconX, CONFIG.icon.y, CONFIG.icon.size, CONFIG.icon.size)
  ctx.restore()

  return await canvas.png
}

export default {
  name: "Fake Saldo Dana",
  description: "Generate fake Dana wallet saldo image",
  category: "Maker",
  methods: ["GET"],
  params: ["saldo"],

  paramsSchema: {
    saldo: {
      type: "string",
      required: true,
      description: "Nominal saldo (contoh: 150000)",
    },
  },

  async run(req, res) {
    try {
      const raw = Number(String(req.query.saldo || '').replace(/\./g, ''))
      if (isNaN(raw)) {
        return res.status(400).json({ status: false, message: 'Parameter "saldo" harus berupa angka' })
      }

      const angka = raw.toLocaleString('id-ID')
      const buffer = await generate(angka)

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Saldo-Nominal", angka)
      return res.send(buffer)
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}

// Migrated from skia-canvas → @napi-rs/canvas on June 21, 2026: skia-canvas
// was deadlocking the JPEG encoder / thread pool on PM2 cold-boot restart
// (endpoint hung indefinitely on first request). @napi-rs/canvas is Rust-based,
// already a project dep (used by api/maker/wafat.js), and cold-boots cleanly.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import logger from "../../src/utils/logger.js"

// Per-endpoint assets (offline-first, pre-populated in api/maker/assets/saldo-gopay/)
const ASSETS_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'saldo-gopay')
const FONT_DIR = ASSETS_DIR
const ASSET_DIR = ASSETS_DIR

const CONFIG = {
  pos: {
    saldo: { x: 62, y: 325 },
    koin: { x: 115, y: 400 },
    pill: { x: 50, y: 510 },
  },
  fontSize: {
    rp: 34,
    saldo: 95,
    koin: 34,
    pill: 34,
  },
  icon: {
    eye: { w: 60, h: 60 },
    report: { w: 30, h: 30 },
    next: { w: 30, h: 30 },
  },
  pill: {
    height: 48,
    paddingLeft: 14,
    paddingRight: 14,
    gapIconText: 10,
    gapTextArrow: 16,
  },
  gap: {
    rpToAngka: 8,
    angkaToEye: 20,
    eyeOffsetY: 12,
  },
  color: {
    report: 'rgba(196, 227, 245)',
    eye: 'rgba(204, 226, 240)',
  },
  baseUrl: 'https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main',
}

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function ensureFile(url, filePath) {
  if (!fs.existsSync(filePath)) {
    const res = await fetch(url)
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.writeFile(filePath, buf)
  }
}

function tintIcon(ctx, img, x, y, w, h, color) {
  const off = createCanvas(w, h)
  const octx = off.getContext('2d')
  octx.drawImage(img, 0, 0, w, h)
  octx.globalCompositeOperation = 'source-in'
  octx.fillStyle = color
  octx.fillRect(0, 0, w, h)
  ctx.drawImage(off, x, y, w, h)
}

async function generate(saldo, koin, terpakai, bulan) {
  await ensureDir(FONT_DIR)
  await ensureDir(ASSET_DIR)

  const B = CONFIG.baseUrl

  const fontReg = path.join(FONT_DIR, 'gopay-reg.ttf')
  const fontSb = path.join(FONT_DIR, 'gopay-sb.ttf')
  const fontSerif = path.join(FONT_DIR, 'gopay-serif.ttf')
  const bgPath = path.join(ASSET_DIR, 'gopay-bg.jpg')
  const iconReportPath = path.join(ASSET_DIR, 'gopay-report.svg')
  const iconEyePath = path.join(ASSET_DIR, 'gopay-eye.svg')
  const iconNextPath = path.join(ASSET_DIR, 'gopay-next.svg')

  await ensureFile(`${B}/Font/rupa_sans_regular.ttf`, fontReg)
  await ensureFile(`${B}/Font/rupa_sans_semi_bold.ttf`, fontSb)
  await ensureFile(`${B}/Font/rupa_serif_semi_bold.ttf`, fontSerif)
  await ensureFile(`${B}/Image/quality_restoration_20260501080321276.jpg`, bgPath)
  await ensureFile(`${B}/Image/bar-chart_6687624.svg`, iconReportPath)
  await ensureFile(`${B}/Image/icChat16ReadMessage.svg`, iconEyePath)
  await ensureFile(`${B}/Image/icNavigation16NextIos.svg`, iconNextPath)

  // @napi-rs/canvas uses a flat (family → path) map keyed by family name.
  // Registering BOTH TTFs under the same family name would SILENTLY OVERWRITE
  // the first with the second, leaving only one weight available. To preserve
  // both faces (regular + semi-bold), register each under a DISTINCT family
  // name and pick the right one in each ctx.font literal below:
  //   'RupaSansReg' — TrueType weight ≤ 500 (rupa_sans_regular.ttf)
  //   'RupaSansSB'  — TrueType weight ≥ 600 (rupa_sans_semi_bold.ttf)
  GlobalFonts.registerFromPath(fontReg, 'RupaSansReg')
  GlobalFonts.registerFromPath(fontSb, 'RupaSansSB')
  GlobalFonts.registerFromPath(fontSerif, 'RupaSerif')

  const bg = await loadImage(bgPath)
  const iconReport = await loadImage(iconReportPath)
  const iconEye = await loadImage(iconEyePath)
  const iconNext = await loadImage(iconNextPath)

  const canvas = createCanvas(bg.width, bg.height)
  const ctx = canvas.getContext('2d')

  const { pos, fontSize, icon, pill, gap, color } = CONFIG

  ctx.drawImage(bg, 0, 0)

  ctx.fillStyle = '#fff'

  ctx.font = `800 ${fontSize.rp}px RupaSansSB`
  ctx.fillText('Rp', pos.saldo.x, pos.saldo.y - 38)
  const rpW = ctx.measureText('Rp').width

  ctx.font = `800 ${fontSize.saldo}px RupaSerif`
  const angkaX = pos.saldo.x + rpW + gap.rpToAngka
  ctx.fillText(saldo, angkaX, pos.saldo.y)
  const angkaW = ctx.measureText(saldo).width

  const eyeX = angkaX + angkaW + gap.angkaToEye
  const eyeMidY = pos.saldo.y - (fontSize.saldo / 2) + gap.eyeOffsetY
  tintIcon(ctx, iconEye, eyeX, eyeMidY - (icon.eye.h / 2), icon.eye.w, icon.eye.h, color.eye)

  ctx.fillStyle = '#fff'

  ctx.font = `800 ${fontSize.koin}px RupaSansSB`
  ctx.fillText(koin, pos.koin.x, pos.koin.y)
  const koinAngkaW = ctx.measureText(koin).width

  ctx.font = `400 ${fontSize.koin}px RupaSansReg`
  ctx.fillText(' Coins', pos.koin.x + koinAngkaW, pos.koin.y)

  ctx.font = `800 ${fontSize.pill}px RupaSansSB`
  const rpTerpakaiText = `Rp${terpakai}`
  const rpTerpakaiW = ctx.measureText(rpTerpakaiText).width

  ctx.font = `400 ${fontSize.pill}px RupaSansReg`
  const sisaText = ` udah terpakai di ${bulan}`
  const sisaW = ctx.measureText(sisaText).width

  const textW = rpTerpakaiW + sisaW
  const pillW = pill.paddingLeft + icon.report.w + pill.gapIconText + textW + pill.gapTextArrow + icon.next.w + pill.paddingRight

  const pillCenterY = pos.pill.y + (pill.height / 2)
  const textBaseY = pillCenterY + (fontSize.pill / 3)
  const textStartX = pos.pill.x + pill.paddingLeft + icon.report.w + pill.gapIconText

  tintIcon(ctx, iconReport, pos.pill.x + pill.paddingLeft, pillCenterY - (icon.report.h / 2), icon.report.w, icon.report.h, color.report)
  tintIcon(ctx, iconNext, pos.pill.x + pillW - pill.paddingRight - icon.next.w, pillCenterY - (icon.next.h / 2), icon.next.w, icon.next.h, '#fff')

  ctx.fillStyle = '#fff'
  ctx.font = `600 ${fontSize.pill}px RupaSansSB`
  ctx.fillText(rpTerpakaiText, textStartX, textBaseY)

  ctx.font = `400 ${fontSize.pill}px RupaSansReg`
  ctx.fillText(sisaText, textStartX + rpTerpakaiW, textBaseY)

  // @napi-rs/canvas JPEG encoder uses 0-100 scale (vs. skia-canvas's 0-1).
  return await canvas.encode('jpeg', 100)
}

export default {
  name: "Fake Saldo Gopay",
  description: "Generate fake Gopay wallet balance image",
  category: "Maker",
  methods: ["GET"],
  params: ["saldo", "koin", "terpakai", "bulan"],

  paramsSchema: {
    saldo: {
      type: "string",
      required: false,
      default: "890",
      description: "Nominal saldo",
    },
    koin: {
      type: "string",
      required: false,
      default: "159",
      description: "Jumlah koin",
    },
    terpakai: {
      type: "string",
      required: false,
      default: "0",
      description: "Nominal terpakai",
    },
    bulan: {
      type: "string",
      required: false,
      default: "Mei",
      description: "Bulan pemakaian",
    },
  },

  async run(req, res) {
    try {
      const {
        saldo = "890",
        koin = "159",
        terpakai = "0",
        bulan = "Mei"
      } = req.query || {}

      logger.info(`[GOPAY] Generating saldo: ${saldo}, koin: ${koin}`)
      const buffer = await generate(saldo, koin, terpakai, bulan)

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fake-gopay")
      return res.send(buffer)
    } catch (error) {
      logger.error(`[GOPAY] Error: ${error.message}`)
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}

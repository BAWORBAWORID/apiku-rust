import { Canvas, loadImage, FontLibrary } from 'skia-canvas'
import fs from 'fs'
import path from 'path'
import logger from "../../src/utils/logger.js"

const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'igstory')
const FONT_DIR = ASSET_DIR

const BG_W = 898
const BG_H = 1600

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

function isUrl(src) {
  return /^https?:\/\//i.test(src)
}

async function loadImageSource(src) {
  if (isUrl(src)) {
    const res = await fetch(src)
    const buf = Buffer.from(await res.arrayBuffer())
    return await loadImage(buf)
  }
  return await loadImage(src)
}

function roundedBottomClipPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y)
  ctx.closePath()
}

function roundedBottomOuterPath(ctx, x, y, w, h, r, bw) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.rect(x - bw, y, bw, h - radius)
  ctx.rect(x + w, y, bw, h - radius)
  ctx.moveTo(x - bw, y + h - radius)
  ctx.lineTo(x, y + h - radius)
  ctx.quadraticCurveTo(x, y + h, x + radius, y + h)
  ctx.lineTo(x + radius, y + h + bw)
  ctx.quadraticCurveTo(x - bw, y + h + bw, x - bw, y + h - radius)
  ctx.closePath()
  ctx.moveTo(x + w + bw, y + h - radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + w - radius, y + h + bw)
  ctx.quadraticCurveTo(x + w + bw, y + h + bw, x + w + bw, y + h - radius)
  ctx.closePath()
  ctx.rect(x + radius, y + h, w - radius * 2, bw)
}

function getContainSize(img, w, h) {
  const imgRatio = img.width / img.height
  const boxRatio = w / h
  if (imgRatio > boxRatio) {
    const fw = w
    return { fw, fh: fw / imgRatio }
  }
  const fh = h
  return { fw: fh * imgRatio, fh }
}

function getCoverSize(img, w, h) {
  const imgRatio = img.width / img.height
  const boxRatio = w / h
  if (imgRatio > boxRatio) {
    const fh = h
    return { fw: fh * imgRatio, fh }
  }
  const fw = w
  return { fw, fh: fw / imgRatio }
}

async function generate(photoUrl, ppUrl, name, username) {
  await ensureDir(FONT_DIR)
  await ensureDir(ASSET_DIR)

  const fontSB = path.join(FONT_DIR, 'Inter-SemiBold.woff2')
  const fontRegular = path.join(FONT_DIR, 'Inter-Regular.woff2')
  const bgPath = path.join(ASSET_DIR, 'igimg.png')

  await ensureFile('https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/igimg.png', bgPath)
  await ensureFile('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYAZ9hiJ-Ek-_EeA.woff2', fontSB)
  await ensureFile('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2', fontRegular)

  FontLibrary.use('InterSemiBold', [fontSB])
  FontLibrary.use('InterRegular', [fontRegular])

  const canvas = new Canvas(BG_W, BG_H)
  const ctx = canvas.getContext('2d')

  const bgImg = await loadImage(bgPath)
  ctx.drawImage(bgImg, 0, 0, BG_W, BG_H)

  const fotoZone = { a: 136, b: 912, c: 38, d: 860, radius: 20 }
  const edgeBlur = { width: 3, blur: 10 }

  const photoImg = await loadImageSource(photoUrl)
  const ppImg = await loadImageSource(ppUrl)

  // Draw foto with blur bg
  const { a, b, c, d, radius } = fotoZone
  const fx = c, fy = a, fw = d - c, fh = b - a

  ctx.save()
  roundedBottomClipPath(ctx, fx, fy, fw, fh, radius)
  ctx.clip()

  ctx.filter = 'blur(28px)'
  ctx.drawImage(photoImg, fx - 40, fy - 40, fw + 80, fh + 80)
  ctx.filter = 'none'

  const containSize = getContainSize(photoImg, fw, fh)
  ctx.drawImage(photoImg, fx + (fw - containSize.fw) / 2, fy + (fh - containSize.fh) / 2, containSize.fw, containSize.fh)
  ctx.restore()

  // Edge blur
  ctx.save()
  const coverSize = getCoverSize(photoImg, fw, fh)

  roundedBottomOuterPath(ctx, fx, fy, fw, fh, radius, edgeBlur.width)
  ctx.clip()
  ctx.filter = `blur(${edgeBlur.blur}px)`
  ctx.drawImage(photoImg, fx + (fw - coverSize.fw) / 2, fy + (fh - coverSize.fh) / 2, coverSize.fw, coverSize.fh)
  ctx.filter = 'none'
  ctx.restore()

  // PP
  const ppX = 110, ppY = 82, ppSize = 80
  const ppDim = Math.min(ppImg.width, ppImg.height)
  const ppSx = (ppImg.width - ppDim) / 2
  const ppSy = (ppImg.height - ppDim) / 2
  const ppR = ppSize / 2

  ctx.save()
  ctx.beginPath()
  ctx.arc(ppX, ppY, ppR, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(ppImg, ppSx, ppSy, ppDim, ppDim, ppX - ppR, ppY - ppR, ppSize, ppSize)
  ctx.restore()

  // Nama
  function resolveFontSize(text, maxWidth, fontSize, minFontSize = 10) {
    if (!text) return fontSize
    let size = fontSize
    while (size > minFontSize) {
      ctx.font = `${size}px InterSemiBold`
      if (ctx.measureText(text).width <= maxWidth) break
      size -= 1
    }
    return Math.max(size, minFontSize)
  }

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  const nameSize = resolveFontSize(name || '', 500, 25, 16)
  ctx.font = `${nameSize}px InterSemiBold`
  ctx.fillStyle = '#feffff'
  if (name) ctx.fillText(name, 170, 58)

  ctx.font = '17px InterRegular'
  ctx.fillStyle = '#8c8d91'
  if (username) ctx.fillText(username, 170, 90)

  return await canvas.toBuffer('png')
}

export default {
  name: "IG Story Image",
  description: "Generate Instagram Story image with photo, profile picture, name, and username",
  category: "Maker",
  methods: ["GET"],
  params: ["photo", "pp", "name", "username"],

  paramsSchema: {
    photo: {
      type: "string",
      required: false,
      default: "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/file_00000000ca64722f9c42e5b2c4efad06.png",
      description: "URL foto utama untuk story",
    },
    pp: {
      type: "string",
      required: false,
      default: "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/file_000000004f647243abd07c0a25041c97.png",
      description: "URL foto profil",
    },
    name: {
      type: "string",
      required: false,
      default: "Zyvor",
      description: "Nama pengguna",
    },
    username: {
      type: "string",
      required: false,
      default: "@Zyvor",
      description: "Username pengguna",
    },
  },

  async run(req, res) {
    try {
      const { photo = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/file_00000000ca64722f9c42e5b2c4efad06.png", pp = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/file_000000004f647243abd07c0a25041c97.png", name = "", username = "" } = req.query || {}
      logger.info(`[IGSTORY] Generating for: ${name}`)
      const buffer = await generate(photo, pp, name, username)
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "igstory")
      return res.send(buffer)
    } catch (error) {
      logger.error(`[IGSTORY] Error: ${error.message}`)
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}

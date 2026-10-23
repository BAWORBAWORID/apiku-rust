import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import logger from "../../src/utils/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ASSET_DIR = path.join(__dirname, 'assets', 'fakeigprofile')
const FONT_PATH = path.join(ASSET_DIR, 'InstagramFont.woff2')
const FONT_INTER = path.join(__dirname, 'assets', 'post-ig', 'Inter-Medium.woff2')
const FONT_INTER_ALT = path.join(__dirname, 'assets', 'iqc-dark', 'fonts', 'Inter-Regular.ttf')
const BG_PATH = path.join(ASSET_DIR, 'bg.png')
const PLUS_PATH = path.join(ASSET_DIR, 'plus.png')
const DEFAULT_AVATAR_PATH = path.join(ASSET_DIR, 'default_avatar.jpg')
const EMOJI_JSON_PATH = path.join(process.cwd(), 'src', 'assets', 'emoji-apple.json')

let appleEmojiMap = null
const emojiImageCache = new Map()
const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu

let fontLoaded = false
function initLocalAssets() {
  if (fontLoaded) return
  try {
    if (fs.existsSync(FONT_PATH)) {
      GlobalFonts.registerFromPath(FONT_PATH, 'InstagramBold')
    } else if (fs.existsSync(FONT_INTER)) {
      GlobalFonts.registerFromPath(FONT_INTER, 'InstagramBold')
    } else if (fs.existsSync(FONT_INTER_ALT)) {
      GlobalFonts.registerFromPath(FONT_INTER_ALT, 'InstagramBold')
    }
    fontLoaded = true
  } catch (err) {
    logger.error(`[FAKEIGPROFILE-V2] Failed to register font: ${err.message}`)
  }
}

function drawcircleimg(ctx, img, x, y, size) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, x, y, size, size)
  ctx.restore()
}

function drawVerifiedBadge(ctx, x, y, size) {
  ctx.save()
  ctx.translate(x, y)

  const spikes = 8
  const outerR = size / 2
  const innerR = outerR * 0.82
  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI / spikes) * i - Math.PI / 2
    const px = Math.cos(angle) * r
    const py = Math.sin(angle) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = '#3897f0'
  ctx.fill()

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = size * 0.11
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-size * 0.20, 0)
  ctx.lineTo(-size * 0.05, size * 0.18)
  ctx.lineTo(size * 0.22, -size * 0.18)
  ctx.stroke()

  ctx.restore()
}

function emojiToUnicode(emoji) {
  return [...emoji].map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join('-')
}

function loadAppleEmojiMap() {
  if (appleEmojiMap) return appleEmojiMap
  if (!fs.existsSync(EMOJI_JSON_PATH)) return {}
  try {
    const raw = fs.readFileSync(EMOJI_JSON_PATH, 'utf-8')
    appleEmojiMap = JSON.parse(raw)
  } catch {
    appleEmojiMap = {}
  }
  return appleEmojiMap
}

async function getEmojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji)
  const map = loadAppleEmojiMap()
  const base = emojiToUnicode(emoji)
  const variants = [
    base,
    base.replace(/-fe0f/gi, ''),
    `${base.replace(/-fe0f/gi, '')}-fe0f`,
    base.toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase() + '-FE0F',
  ]
  let b64 = null
  for (const v of variants) {
    if (map[v]) { b64 = map[v]; break }
  }
  if (!b64) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    const img = await loadImage(buf)
    emojiImageCache.set(emoji, img)
    return img
  } catch {
    return null
  }
}

async function drawAppleEmoji(ctx, emoji, x, y, size) {
  const img = await getEmojiImage(emoji)
  if (!img) {
    ctx.fillText(emoji, x, y)
    return
  }
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size)
}

function measureTextCustom(ctx, text, fontSize) {
  const parts = text.split(EMOJI_REGEX)
  let totalWidth = 0
  for (const part of parts) {
    if (!part) continue
    EMOJI_REGEX.lastIndex = 0
    if (EMOJI_REGEX.test(part)) {
      totalWidth += fontSize * 1.05
    } else {
      totalWidth += ctx.measureText(part).width
    }
    EMOJI_REGEX.lastIndex = 0
  }
  return totalWidth
}

async function drawTextWithEmojis(ctx, text, x, y, fontSize) {
  const parts = text.split(EMOJI_REGEX)
  let currentX = x
  for (const part of parts) {
    if (!part) continue
    EMOJI_REGEX.lastIndex = 0
    if (EMOJI_REGEX.test(part)) {
      const emojiSize = fontSize * 1.05
      const emojiCX = currentX + emojiSize / 2
      const emojiCY = y
      await drawAppleEmoji(ctx, part, emojiCX, emojiCY, emojiSize)
      currentX += emojiSize
    } else {
      ctx.fillText(part, currentX, y)
      currentX += ctx.measureText(part).width
    }
    EMOJI_REGEX.lastIndex = 0
  }
}

function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px InstagramBold`
  const words = text.split(" ")
  const lines = []
  let cur = ""
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word.includes('\n')) {
      const parts = word.split('\n')
      for (let j = 0; j < parts.length; j++) {
        const test = cur + (cur ? " " : "") + parts[j]
        if (measureTextCustom(ctx, test, fontSize) > maxWidth && cur) {
          lines.push(cur); cur = parts[j]
        } else { cur = test }
        if (j < parts.length - 1) { lines.push(cur); cur = "" }
      }
      continue
    }
    const test = cur + (cur ? " " : "") + word
    if (measureTextCustom(ctx, test, fontSize) > maxWidth && i > 0) {
      lines.push(cur); cur = word
    } else { cur = test }
  }
  if (cur) lines.push(cur)
  return lines
}

export default {
  name: "Fake IG Profile V2",
  description: "Generate Fake Instagram Profile Screenshot with verified badge, Apple Emojis, and offline assets",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["username", "ppurl", "bio", "postingan", "pengikut", "mengikuti"],
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Nama / Username Instagram",
      example: "Zyvor"
    },
    ppurl: {
      type: "string",
      required: true,
      description: "URL foto profil",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    },
    bio: {
      type: "string",
      required: false,
      description: "Teks Bio Instagram (mendukung \\n dan Apple Emoji)",
      example: "Welcome to my profile ✨"
    },
    postingan: {
      type: "string",
      required: false,
      description: "Jumlah postingan",
      example: "12"
    },
    pengikut: {
      type: "string",
      required: false,
      description: "Jumlah followers",
      example: "1.123"
    },
    mengikuti: {
      type: "string",
      required: false,
      description: "Jumlah following",
      example: "86"
    }
  },

  async run(req, res) {
    const startTime = Date.now()
    try {
      initLocalAssets()

      const p = { ...req.query, ...req.body }
      const username = p.username || p.name || ""
      const ppurl = p.ppurl || p.profilePhoto || p.pp || ""
      const bio = p.bio || ""
      const postingan = String(p.postingan || p.posts || "0")
      const pengikut = String(p.pengikut || p.followers || "0")
      const mengikuti = String(p.mengikuti || p.following || "0")

      if (!username || !ppurl) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' dan 'ppurl' wajib diisi"
        })
      }

      if (!fs.existsSync(BG_PATH)) {
        throw new Error("File bg.png tidak ditemukan di assets/fakeigprofile")
      }
      const bg = await loadImage(BG_PATH)

      let ppImg
      if (ppurl.startsWith('http')) {
        try {
          const ppRes = await axios.get(ppurl, { responseType: 'arraybuffer', timeout: 10000 })
          ppImg = await loadImage(Buffer.from(ppRes.data))
        } catch {
          if (fs.existsSync(DEFAULT_AVATAR_PATH)) {
            ppImg = await loadImage(DEFAULT_AVATAR_PATH)
          } else {
            throw new Error("Gagal memuat foto profil dan fallback tidak tersedia")
          }
        }
      } else {
        if (fs.existsSync(DEFAULT_AVATAR_PATH)) {
          ppImg = await loadImage(DEFAULT_AVATAR_PATH)
        } else {
          ppImg = bg
        }
      }

      let plusImg = null
      if (fs.existsSync(PLUS_PATH)) {
        plusImg = await loadImage(PLUS_PATH)
      }

      const canvas = createCanvas(bg.width, bg.height)
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bg, 0, 0, bg.width, bg.height)

      const ppSize = 145
      const ppX = 35
      const ppY = 145
      drawcircleimg(ctx, ppImg, ppX, ppY, ppSize)

      if (plusImg) {
        const plusSize = 70
        const plusX = ppX + ppSize - plusSize + 5
        const plusY = ppY + ppSize - plusSize + 5
        ctx.drawImage(plusImg, plusX, plusY, plusSize, plusSize)
      }

      ctx.fillStyle = '#f9fdfe'
      const usernameFontSize = 25
      ctx.font = `${usernameFontSize}px InstagramBold`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const usernameX = 190
      const usernameY = 150

      await drawTextWithEmojis(ctx, username, usernameX, usernameY, usernameFontSize)

      const usernameWidth = measureTextCustom(ctx, username, usernameFontSize)
      const badgeGap = 14
      const badgeSize = usernameFontSize * 0.9
      const badgeX = usernameX + usernameWidth + badgeGap
      const badgeY = usernameY
      drawVerifiedBadge(ctx, badgeX, badgeY, badgeSize)

      ctx.font = '30px InstagramBold'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'

      const statY = 210
      const postinganX = 260
      const pengikutX = 550
      const mengikutiX = 850

      ctx.fillText(postingan, postinganX, statY)
      ctx.fillText(pengikut, pengikutX, statY)
      ctx.fillText(mengikuti, mengikutiX, statY)

      const bioX = 35
      const bioY = 320
      const bioFontSize = 22
      const maxBioWidth = bg.width - 70

      ctx.font = `${bioFontSize}px InstagramBold`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'

      if (bio) {
        const bioLines = wrapText(ctx, bio, maxBioWidth, bioFontSize)
        for (let i = 0; i < bioLines.length; i++) {
          await drawTextWithEmojis(ctx, bioLines[i].trim(), bioX, bioY + (i * 30), bioFontSize)
        }
      }

      const buffer = await canvas.encode('png')
      const duration = Date.now() - startTime

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generated-In", `${duration}ms`)
      return res.send(buffer)
    } catch (err) {
      const duration = Date.now() - startTime
      logger.error(`[FAKEIGPROFILE-V2] Error after ${duration}ms: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal menghasilkan gambar profil Instagram"
      })
    }
  }
}

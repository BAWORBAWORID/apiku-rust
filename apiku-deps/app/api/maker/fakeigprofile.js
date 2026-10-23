import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import logger from "../../src/utils/logger.js"

// Direktori aset lokal (100% Offline-First tanpa ketergantungan URL eksternal)
const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'fakeigprofile')
const BG_PATH = path.join(ASSET_DIR, 'bg.png')
const PLUS_PATH = path.join(ASSET_DIR, 'plus.png')
const FONT_PATH = path.join(ASSET_DIR, 'InstagramFont.woff2')
const EMOJI_JSON_PATH = path.join(process.cwd(), 'src', 'assets', 'emoji-apple.json')
const DEFAULT_AVATAR_PATH = path.join(ASSET_DIR, 'default_avatar.jpg')

let appleEmojiMap = null
const emojiImageCache = new Map()
const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// Inisialisasi dan pendaftaran font dari disk lokal
function initLocalAssets() {
  ensureDirSync(ASSET_DIR)
  if (fs.existsSync(FONT_PATH)) {
    GlobalFonts.registerFromPath(FONT_PATH, 'InstagramBold')
  } else {
    // Fallback jika file InstagramFont tidak ada, gunakan font Inter dari post-ig
    const fallbackFont = path.join(process.cwd(), 'api', 'maker', 'assets', 'post-ig', 'Inter-Medium.woff2')
    if (fs.existsSync(fallbackFont)) {
      GlobalFonts.registerFromPath(fallbackFont, 'InstagramBold')
    }
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

function emojiToUnicode(emoji) {
  return [...emoji].map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join('-')
}

// Membaca Apple Emoji Map langsung dari file lokal (tanpa unduh eksternal)
function loadAppleEmojiMap() {
  if (appleEmojiMap) return appleEmojiMap
  ensureDirSync(ASSET_DIR)
  if (!fs.existsSync(EMOJI_JSON_PATH)) {
    logger.warn(`[FAKEIGPROFILE] File lokal emoji-apple.json tidak ditemukan di ${EMOJI_JSON_PATH}`)
    return {}
  }
  try {
    const raw = fs.readFileSync(EMOJI_JSON_PATH, 'utf-8')
    appleEmojiMap = JSON.parse(raw)
  } catch (err) {
    logger.error(`[FAKEIGPROFILE] Gagal parse lokal emoji-apple.json: ${err.message}`)
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
    if (map[v]) { b64 = map[v]; break; }
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
  name: "Fake IG Profile Canvas",
  description: "Generate Fake Instagram Profile Screenshot with Apple Emoji support",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["username", "postingan", "pengikut", "mengikuti", "bio", "ppurl"],
  paramsSchema: {
    username: {
      type: "string",
      required: false,
      default: "King Jenn 👑",
      description: "Nama / Username tampilan (mendukung Apple Emoji)"
    },
    postingan: {
      type: "string",
      required: false,
      default: "12",
      description: "Angka jumlah postingan"
    },
    pengikut: {
      type: "string",
      required: false,
      default: "1.123",
      description: "Angka jumlah pengikut (followers)"
    },
    mengikuti: {
      type: "string",
      required: false,
      default: "12",
      description: "Angka jumlah mengikuti (following)"
    },
    bio: {
      type: "string",
      required: false,
      default: "Haii. 👑\nWelcome to my official profile ✨\nlinktr.ee/zyvorapi",
      description: "Teks Bio Instagram (ruang lebar, mendukung baris baru \\n dan Apple Emoji)"
    },
    ppurl: {
      type: "string",
      required: false,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL foto profil (opsional)"
    }
  },

  async run(req, res) {
    try {
      initLocalAssets()

      const p = { ...req.query, ...req.body }
      const username = p.username || p.name || "King Jenn 👑"
      const postingan = String(p.postingan || p.posts || "12")
      const pengikut = String(p.pengikut || p.followers || "1.123")
      const mengikuti = String(p.mengikuti || p.following || "12")
      const bio = p.bio || "Haii. 👑\nWelcome to my official profile ✨\nlinktr.ee/zyvorapi"
      const ppurl = p.ppurl || p.profilePhoto || p.pp || ""

      // 1. Load Background langsung dari disk lokal
      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`File lokal background (${BG_PATH}) tidak ditemukan. Pastikan file bg.png tersedia di folder aset.`)
      }
      const bg = await loadImage(BG_PATH)

      // 2. Load Foto Profil (dari URL jika diberikan, atau langsung dari default_avatar lokal)
      let ppImg
      if (ppurl && typeof ppurl === 'string' && ppurl.startsWith('http')) {
        try {
          const ppRes = await axios.get(ppurl, { responseType: 'arraybuffer', timeout: 10000 })
          ppImg = await loadImage(Buffer.from(ppRes.data))
        } catch {
          if (fs.existsSync(DEFAULT_AVATAR_PATH)) {
            ppImg = await loadImage(DEFAULT_AVATAR_PATH)
          } else {
            throw new Error("Gagal memuat foto profil eksternal dan fallback lokal tidak ditemukan.")
          }
        }
      } else {
        if (fs.existsSync(DEFAULT_AVATAR_PATH)) {
          ppImg = await loadImage(DEFAULT_AVATAR_PATH)
        } else {
          // Fallback ke foto profil dari bg jika avatar default belum ada
          ppImg = bg
        }
      }

      // 3. Load Plus Icon langsung dari disk lokal
      let plusImg = null
      if (fs.existsSync(PLUS_PATH)) {
        plusImg = await loadImage(PLUS_PATH)
      }

      const canvasHeight = bg.height
      const canvas = createCanvas(bg.width, canvasHeight)
      const ctx = canvas.getContext('2d')

      // Draw background
      ctx.drawImage(bg, 0, 0, bg.width, bg.height)

      // Draw circular profile photo
      const ppSize = 145
      const ppX = 35
      const ppY = 145
      drawcircleimg(ctx, ppImg, ppX, ppY, ppSize)

      // Draw plus icon
      if (plusImg) {
        const plusSize = 70
        const plusX = ppX + ppSize - plusSize + 5
        const plusY = ppY + ppSize - plusSize + 5
        ctx.drawImage(plusImg, plusX, plusY, plusSize, plusSize)
      }

      ctx.fillStyle = '#f9fdfe'

      // Draw Username with Apple Emojis
      const usernameFontSize = 26
      ctx.font = `${usernameFontSize}px InstagramBold`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const usernameX = 190
      const usernameY = 150
      await drawTextWithEmojis(ctx, username, usernameX, usernameY, usernameFontSize)

      // Draw Stats (postingan, pengikut, mengikuti)
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

      // Draw Bio dengan ruang yang LEBAR dan rapi
      const bioX = 35
      const bioY = 320
      const bioFontSize = 23
      const maxBioWidth = bg.width - 70

      ctx.font = `${bioFontSize}px InstagramBold`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'

      const bioLines = wrapText(ctx, bio, maxBioWidth, bioFontSize)
      for (let i = 0; i < bioLines.length; i++) {
        await drawTextWithEmojis(ctx, bioLines[i].trim(), bioX, bioY + (i * 33), bioFontSize)
      }

      const buffer = await canvas.encode('png')
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fakeigprofile")
      return res.send(buffer)

    } catch (err) {
      logger.error(`[FAKEIGPROFILE] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal menghasilkan gambar profil Instagram"
      })
    }
  }
}

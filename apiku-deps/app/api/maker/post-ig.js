import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from "../../src/utils/logger.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Asset paths (local)
const ASSETS_DIR = join(__dirname, 'assets', 'post-ig')
const FONT_DIR = ASSETS_DIR
const ICONS_DIR = ASSETS_DIR
const BG_PATH = join(ASSETS_DIR, 'background.png')
const FONT_PATH = join(FONT_DIR, 'Inter-Medium.woff2')

const CANVAS_W = 1080
const CANVAS_H = 1564         
const CANVAS_BG_COLOR = '#0c0f14'

const ICON_SIZE = 80         
const BOTTOM_BAR_Y_OFFSET = 17 
const ICON_Y    = 1264 + BOTTOM_BAR_Y_OFFSET
const GAP_ICON_TO_TEXT  = 24 
const GAP_TEXT_TO_ICON  = 43 
const DEFAULT_X = { like: 22, comment: 256, repost: 459, share: 688, save: 978 }

const COUNT_FONT   = '500 43px InterIG'
const COUNT_ZONE_Y = 1285 + BOTTOM_BAR_Y_OFFSET
const COUNT_ZONE_H = 48

const USERNAME_FONT   = '500 38px InterIG'
const USERNAME_X      = 159
const USERNAME_ZONE_Y = 58
const USERNAME_ZONE_H = 59
const VERIFY_SIZE      = 40
const VERIFY_Y          = 71
const GAP_USERNAME_VERIFY = 14

const AVATAR_CX = 83.5, AVATAR_CY = 85.5, AVATAR_R = 48.5
const AVATAR_DRAW = { x: 35, y: 37, w: 97, h: 97 }

const MAIN_PHOTO_ZONE = { x: -3, y: 157, w: 1089, h: 1089 }
const MAIN_PHOTO_BLUR = 28

async function download(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    maxRedirects: 5,
  })
  return Buffer.from(res.data)
}

function isUrl(src) {
  return /^https?:\/\//i.test(src)
}

async function resolveFreshImage(src) {
  const buf = isUrl(src) ? await download(src) : await import('node:fs/promises').then(fs => fs.readFile(src))
  return loadImage(buf)
}

function drawIcon(ctx, img, x, y, size) {
  ctx.drawImage(img, x, y, size, size)
}

function drawCountText(ctx, text, x) {
  ctx.save()
  ctx.font = COUNT_FONT
  ctx.fillStyle = '#f9fdfe'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(text), x, COUNT_ZONE_Y + COUNT_ZONE_H / 2)
  ctx.restore()
}

function drawUsernameText(ctx, text, x) {
  ctx.save()
  ctx.font = USERNAME_FONT
  ctx.fillStyle = '#f9fdfe'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, USERNAME_ZONE_Y + USERNAME_ZONE_H / 2)
  ctx.restore()
}

function drawAvatar(ctx, img) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_R, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  const sw = img.width, sh = img.height
  const crop = Math.min(sw, sh)
  const sx = (sw - crop) / 2
  const sy = (sh - crop) / 2
  ctx.drawImage(img, sx, sy, crop, crop, AVATAR_DRAW.x, AVATAR_DRAW.y, AVATAR_DRAW.w, AVATAR_DRAW.h)
  ctx.restore()
}

function drawMainPhoto(ctx, img, zone, blurPx = MAIN_PHOTO_BLUR) {
  const { x, y, w, h } = zone
  const imgRatio = img.width / img.height
  const boxRatio = w / h

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  let cw, ch
  if (imgRatio > boxRatio) {
    ch = h
    cw = ch * imgRatio
  } else {
    cw = w
    ch = cw / imgRatio
  }
  ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(img, x - (cw - w) / 2, y - (ch - h) / 2, cw, ch)
  ctx.filter = 'none'

  let fw, fh
  if (imgRatio > boxRatio) {
    fw = w
    fh = fw / imgRatio
  } else {
    fh = h
    fw = fh * imgRatio
  }
  ctx.drawImage(img, x + (w - fw) / 2, y + (h - fh) / 2, fw, fh)

  ctx.restore()
}

function computeUsernameLayout(ctx, username) {
  ctx.font = USERNAME_FONT
  const textW = ctx.measureText(username).width
  const verifyX = USERNAME_X + textW + GAP_USERNAME_VERIFY
  return { textX: USERNAME_X, verifyX }
}

function computeBottomBarLayout(ctx, { like, comment, repost }) {
  ctx.font = COUNT_FONT

  const likeX = DEFAULT_X.like
  const likeTextX = likeX + ICON_SIZE + GAP_ICON_TO_TEXT
  const likeTextW = ctx.measureText(String(like)).width

  const minCommentX = likeTextX + likeTextW + GAP_TEXT_TO_ICON
  const commentX = Math.max(DEFAULT_X.comment, minCommentX)
  const commentTextX = commentX + ICON_SIZE + GAP_ICON_TO_TEXT
  const commentTextW = ctx.measureText(String(comment)).width

  const minRepostX = commentTextX + commentTextW + GAP_TEXT_TO_ICON
  const repostX = Math.max(DEFAULT_X.repost, minRepostX)
  const repostTextX = repostX + ICON_SIZE + GAP_ICON_TO_TEXT
  const repostTextW = ctx.measureText(String(repost)).width

  const minShareX = repostTextX + repostTextW + GAP_TEXT_TO_ICON
  const shareX = Math.max(DEFAULT_X.share, minShareX)

  return {
    like:    { iconX: likeX,    textX: likeTextX },
    comment: { iconX: commentX, textX: commentTextX },
    repost:  { iconX: repostX,  textX: repostTextX },
    share:   { iconX: shareX },
    save:    { iconX: DEFAULT_X.save },
  }
}

export default {
  name: "IG Story Generator",
  description: "Generate Instagram Story with profile photo, main photo, username, likes, comments, reposts",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["profilePhoto", "mainPhoto", "username", "like", "comment", "repost"],

  paramsSchema: {
    profilePhoto: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL foto profil",
    },
    mainPhoto: {
      type: "string",
      required: false,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL foto postingan",
    },
    username: {
      type: "string",
      required: false,
      default: "Nothing",
      description: "Nama pengguna",
    },
    like: {
      type: "string",
      required: false,
      default: "100",
      description: "Jumlah like",
    },
    comment: {
      type: "string",
      required: false,
      default: "31",
      description: "Jumlah komentar",
    },
    repost: {
      type: "string",
      required: false,
      default: "489",
      description: "Jumlah repost",
    },
  },

  async run(req, res) {
    try {
      let { profilePhoto, mainPhoto, username = "Nothing", like = "100", comment = "31", repost = "489" } = { ...req.query, ...req.body }

      if (!profilePhoto || !mainPhoto) {
        return res.status(400).json({ status: false, message: "Parameter 'profilePhoto' dan 'mainPhoto' wajib diisi" })
      }

      const likeNum = parseInt(like, 10) || 0
      const commentNum = parseInt(comment, 10) || 0
      const repostNum = parseInt(repost, 10) || 0

      // Register font from local file
      GlobalFonts.registerFromPath(FONT_PATH, 'InterIG')

      // Load local assets
      const [bgImg, avatarImg, photoImg] = await Promise.all([
        loadImage(BG_PATH),
        resolveFreshImage(profilePhoto),
        resolveFreshImage(mainPhoto),
      ])

      // Load icons
      const iconNames = ['like', 'comment', 'repost', 'share', 'save', 'verify']
      const icons = {}
      for (const name of iconNames) {
        const iconPath = join(ICONS_DIR, `${name}.svg`)
        icons[name] = await loadImage(iconPath)
      }

      const canvas = createCanvas(CANVAS_W, CANVAS_H)
      const ctx = canvas.getContext('2d')

      ctx.fillStyle = CANVAS_BG_COLOR
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      ctx.drawImage(bgImg, 0, 0, CANVAS_W, CANVAS_H)

      drawMainPhoto(ctx, photoImg, MAIN_PHOTO_ZONE)
      drawAvatar(ctx, avatarImg)

      const uLayout = computeUsernameLayout(ctx, username)
      drawUsernameText(ctx, username, uLayout.textX)
      drawIcon(ctx, icons.verify, uLayout.verifyX, VERIFY_Y, VERIFY_SIZE)

      const bar = computeBottomBarLayout(ctx, { like: likeNum, comment: commentNum, repost: repostNum })
      drawIcon(ctx, icons.like, bar.like.iconX, ICON_Y, ICON_SIZE)
      drawCountText(ctx, likeNum, bar.like.textX)
      drawIcon(ctx, icons.comment, bar.comment.iconX, ICON_Y, ICON_SIZE)
      drawCountText(ctx, commentNum, bar.comment.textX)
      drawIcon(ctx, icons.repost, bar.repost.iconX, ICON_Y, ICON_SIZE)
      drawCountText(ctx, repostNum, bar.repost.textX)
      drawIcon(ctx, icons.share, bar.share.iconX, ICON_Y, ICON_SIZE)
      drawIcon(ctx, icons.save, bar.save.iconX, ICON_Y, ICON_SIZE)

      const buffer = await canvas.encode('png')
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "post-ig")
      return res.send(buffer)
    } catch (err) {
      logger.error(`[POSTIG] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message })
    }
  },
}
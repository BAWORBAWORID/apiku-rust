import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import logger from "../../src/utils/logger.js"

const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'faketele')
const BG_PATH = path.join(ASSET_DIR, 'bg_tele.png')
const FONT_PATH = path.join(ASSET_DIR, 'RobotoMono-Bold.ttf')

let fontRegistered = false
const FONT_NAME = 'TeleRobotoMono'

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function initLocalAssets() {
  ensureDirSync(ASSET_DIR)
  if (!fontRegistered && fs.existsSync(FONT_PATH)) {
    try {
      GlobalFonts.registerFromPath(FONT_PATH, FONT_NAME)
      fontRegistered = true
    } catch (err) {
      logger.warn(`[FAKETELE] Gagal register font lokal: ${err.message}`)
    }
  }
}

export default {
  name: "Fake Telegram Profile",
  description: "Generate Fake Telegram Profile (foto profil lingkaran + nama, nomor HP, bio & username)",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["nama", "ponsel", "bio", "username", "ppurl"],
  paramsSchema: {
    nama: {
      type: "string",
      required: true,
      description: "Nama lengkap yang tampil di profil",
      example: "Always Codex"
    },
    ponsel: {
      type: "string",
      required: true,
      description: "Nomor HP yang tampil di profil",
      example: "+62 812-3456-7890"
    },
    bio: {
      type: "string",
      required: true,
      description: "Bio singkat",
      example: "Fullstack Developer"
    },
    username: {
      type: "string",
      required: true,
      description: "Username Telegram (tanpa @, otomatis ditambahkan)",
      example: "zyvor"
    },
    ppurl: {
      type: "string",
      required: false,
      description: "URL foto profil (opsional, jika kosong pakai default avatar)",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    }
  },

  async run(req, res) {
    try {
      initLocalAssets()

      const p = { ...req.query, ...req.body }
      const nama = String(p.nama || p.name || "").trim()
      const ponsel = String(p.ponsel || p.number || p.nomor || p.phone || "").trim()
      const bio = String(p.bio || "").trim()
      const username = String(p.username || p.user || "").trim()
      const ppurl = p.ppurl || p.pp || p.avatar || p.profilePhoto || ""

      if (!nama || !ponsel || !bio || !username) {
        return res.status(400).json({
          status: false,
          message: "Parameter wajib: nama, ponsel, bio, username"
        })
      }

      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`File lokal background (${BG_PATH}) tidak ditemukan.`)
      }
      const bg = await loadImage(BG_PATH)
      const canvas = createCanvas(bg.width, bg.height)
      const ctx = canvas.getContext('2d')

      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)

      // Foto profil lingkaran
      let ppImg = bg
      if (ppurl && typeof ppurl === 'string' && ppurl.startsWith('http')) {
        try {
          const ppRes = await axios.get(ppurl, { responseType: 'arraybuffer', timeout: 10000 })
          ppImg = await loadImage(Buffer.from(ppRes.data))
        } catch (err) {
          logger.warn(`[FAKETELE] Gagal load ppurl, pakai fallback: ${err.message}`)
        }
      }

      const fontFamily = fontRegistered ? FONT_NAME : 'sans-serif'

      const config = {
        pp: { x: 571, y: 244, r: 137 },
        nama: { y: 448, size: 50 },
        ponsel: { x: 80, y: 883, size: 35 },
        bio: { x: 83, y: 996, size: 36 },
        username: { x: 83, y: 1143, size: 38 }
      }

      ctx.save()
      ctx.beginPath()
      ctx.arc(config.pp.x, config.pp.y, config.pp.r, 0, Math.PI * 2, true)
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(ppImg, config.pp.x - config.pp.r, config.pp.y - config.pp.r, config.pp.r * 2, config.pp.r * 2)
      ctx.restore()

      const displayUsername = username.startsWith('@') ? username : '@' + username

      ctx.fillStyle = '#FFFFFF'

      // nama
      ctx.font = `bold ${config.nama.size}px ${fontFamily}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(nama, canvas.width / 2, config.nama.y)

      // nomor hp
      ctx.textAlign = 'left'
      ctx.font = `${config.ponsel.size}px ${fontFamily}`
      ctx.fillText(ponsel, config.ponsel.x, config.ponsel.y)

      // bio
      ctx.font = `${config.bio.size}px ${fontFamily}`
      ctx.fillText(bio, config.bio.x, config.bio.y)

      // username
      ctx.font = `${config.username.size}px ${fontFamily}`
      ctx.fillText(displayUsername, config.username.x, config.username.y)

      const buffer = await canvas.encode('png')
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fake-tele")
      return res.send(buffer)

    } catch (err) {
      logger.error(`[FAKETELE] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal menghasilkan Fake Telegram Profile"
      })
    }
  }
}

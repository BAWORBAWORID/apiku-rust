import { Canvas, loadImage, FontLibrary } from 'skia-canvas'
import fs from 'fs'
import path from 'path'
import logger from "../../src/utils/logger.js"

// Per-endpoint assets (offline-first — pre-populated in api/maker/assets/fakeig/)
const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'fakeig')
// Co-locate fonts alongside assets (same convention as the canvas endpoints)
const FONT_DIR = ASSET_DIR

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

async function generate(pp, name, text) {
  await ensureDir(FONT_DIR)
  await ensureDir(ASSET_DIR)

  const fontSB = path.join(FONT_DIR, 'Inter-SemiBold.otf')
  const fontB = path.join(FONT_DIR, 'Inter-Bold.otf')
  const bgPath = path.join(ASSET_DIR, 'ig-bg.jpg')

  await ensureFile('https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Font/Inter-SemiBold.otf', fontSB)
  await ensureFile('https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Font/Inter-Bold.otf', fontB)
  await ensureFile('https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/_20260430144912806.jpg', bgPath)

  FontLibrary.use('Inter-SB', [fontSB])
  FontLibrary.use('Inter-B', [fontB])

  const bg = await loadImage(bgPath)
  const avatar = await loadImage(pp)

  const canvas = new Canvas(bg.width, bg.height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.drawImage(bg, 0, 0)

  const header = { x: 115, y: 388, gap: 25 }
  const p = { cx: header.x, cy: header.y, r: 68 }

  const SAFE_PADDING_X = 100
  const SAFE_PADDING_TOP = 480
  const SAFE_PADDING_BOTTOM = 480

  const safeLeft = SAFE_PADDING_X
  const safeRight = bg.width - SAFE_PADDING_X
  const safeTop = SAFE_PADDING_TOP
  const safeBottom = bg.height - SAFE_PADDING_BOTTOM
  const safeW = safeRight - safeLeft
  const safeH = safeBottom - safeTop
  const safeCX = bg.width / 2
  const safeCY = (safeTop + safeBottom) / 2

  const s = Math.min(avatar.width, avatar.height)
  const sx = (avatar.width - s) / 2
  const sy = (avatar.height - s) / 2

  ctx.save()
  ctx.beginPath()
  ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(avatar, sx, sy, s, s, p.cx - p.r, p.cy - p.r, p.r * 2, p.r * 2)
  ctx.restore()

  ctx.font = 'bold 55px "Inter-SB"'
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(name, p.cx + p.r + header.gap, p.cy)

  function parseTokens(input) {
    const tokens = []
    const regex = /\(([^)]*)\)/g
    let last = 0, match
    while ((match = regex.exec(input)) !== null) {
      if (match.index > last) tokens.push({ text: input.slice(last, match.index), red: false })
      tokens.push({ text: match[1], red: true })
      last = regex.lastIndex
    }
    if (last < input.length) tokens.push({ text: input.slice(last), red: false })
    return tokens
  }

  function wrapTokens(ctx, tokens, maxWidth, fsz) {
    const lines = []
    let curLine = []
    let curW = 0

    const words = []
    for (const tok of tokens) {
      const parts = tok.text.split(/(\s+)/)
      for (const p of parts) {
        if (p === '') continue
        words.push({ text: p, red: tok.red })
      }
    }

    for (const word of words) {
      if (/^\s+$/.test(word.text)) {
        if (curLine.length > 0) {
          ctx.font = `bold ${fsz}px "Inter-SB"`
          const spaceW = ctx.measureText(' ').width
          curW += spaceW
          const last = curLine[curLine.length - 1]
          if (last.red === word.red) last.text += word.text
          else curLine.push({ text: word.text, red: word.red })
        }
        continue
      }

      ctx.font = `bold ${fsz}px "${word.red ? 'Inter-B' : 'Inter-SB'}"`
      const wordW = ctx.measureText(word.text).width
      ctx.font = `bold ${fsz}px "Inter-SB"`
      const spaceW = ctx.measureText(' ').width

      const addW = curLine.length > 0 ? spaceW + wordW : wordW

      if (curW + addW > maxWidth && curLine.length > 0) {
        lines.push(curLine)
        curLine = [{ text: word.text, red: word.red }]
        curW = wordW
      } else {
        if (curLine.length > 0) {
          const last = curLine[curLine.length - 1]
          if (last.red === word.red) {
            last.text += ' ' + word.text
          } else {
            curLine.push({ text: ' ', red: false })
            curLine.push({ text: word.text, red: word.red })
          }
          curW += spaceW + wordW
        } else {
          curLine.push({ text: word.text, red: word.red })
          curW = wordW
        }
      }
    }
    if (curLine.length > 0) lines.push(curLine)
    return lines
  }

  function lineWidth(ctx, segments, fsz) {
    return segments.reduce((sum, seg) => {
      ctx.font = `bold ${fsz}px "${seg.red ? 'Inter-B' : 'Inter-SB'}"`
      return sum + ctx.measureText(seg.text).width
    }, 0)
  }

  function drawScaledText(ctx, input) {
    const tokens = parseTokens(input.trim())

    const MAX_FONT = 65
    const MIN_FONT = 18
    let fsz = MAX_FONT
    let lines, totalH, lh

    do {
      lh = fsz * 1.25
      lines = wrapTokens(ctx, tokens, safeW, fsz)
      totalH = lines.length * lh
      if (totalH <= safeH) break
      fsz -= 1
    } while (fsz > MIN_FONT)

    if (totalH > safeH) {
      const maxLines = Math.floor(safeH / lh)
      lines = lines.slice(0, maxLines)
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]
        ctx.font = `bold ${fsz}px "Inter-SB"`
        const dotsW = ctx.measureText('...').width
        while (lineWidth(ctx, lastLine, fsz) + dotsW > safeW) {
          const last = lastLine[lastLine.length - 1]
          if (last.text.length > 1) {
            last.text = last.text.slice(0, -1).trimEnd()
          } else {
            lastLine.pop()
            if (lastLine.length === 0) break
          }
        }
        lastLine.push({ text: '...', red: false })
      }
      totalH = lines.length * lh
    }

    const startY = safeCY - totalH / 2 + lh / 2
    ctx.textBaseline = 'middle'

    for (let i = 0; i < lines.length; i++) {
      const segments = lines[i]
      const totalW = lineWidth(ctx, segments, fsz)
      let x = safeCX - totalW / 2
      const y = startY + i * lh

      for (const seg of segments) {
        ctx.font = `bold ${fsz}px "${seg.red ? 'Inter-B' : 'Inter-SB'}"`
        ctx.fillStyle = seg.red ? '#e51a1a' : '#000000'
        ctx.textAlign = 'left'
        ctx.fillText(seg.text, x, y)
        x += ctx.measureText(seg.text).width
      }
    }
  }

  drawScaledText(ctx, text)
  return await canvas.toBuffer('png')
}

export default {
  name: "Fake IG Canvas",
  description: "Generate fake Instagram story image with profile picture, name, and custom text. Text inside (parentheses) will be red.",
  category: "Maker",
  methods: ["GET"],
  params: ["pp", "name", "text"],

  paramsSchema: {
    pp: {
      type: "string",
      required: false,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL foto profil",
    },
    name: {
      type: "string",
      required: true,
      description: "Nama pengguna",
    },
    text: {
      type: "string",
      required: true,
      description: "Teks story. Gunakan (teks) untuk warna merah.",
    },
  },

  async run(req, res) {
    try {
      const DEFAULT_PP = "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
      const { pp = DEFAULT_PP, name, text } = req.query || {}
      if (!name) {
        return res.status(400).json({ status: false, message: "Parameter 'name' wajib diisi" })
      }
      if (!text) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" })
      }

      logger.info(`[FAKEIG] Generating for: ${name}`)
      const buffer = await generate(pp, name, text)

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("X-Generator", "fakeig")
      return res.send(buffer)
    } catch (error) {
      logger.error(`[FAKEIG] Error: ${error.message}`)
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}

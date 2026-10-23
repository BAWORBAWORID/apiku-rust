import axios from "axios"
import logger from "../../src/utils/logger.js"

const API_URL = "https://nexupscaleid.vercel.app/api/upscale"
const MODES = ["hd", "ultrahd", "4x", "4xv2"]
const DEFAULT_HEADERS = {
  "content-type": "application/json",
  "origin": "https://nexupscaleid.vercel.app",
  "referer": "https://nexupscaleid.vercel.app/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
}

function mimeFromBuffer(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg"
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return "image/webp"
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp"
  return "image/jpeg"
}

async function prepareImage(imageUrl) {
  if (!imageUrl) throw new Error("Parameter 'url' wajib diisi")

  if (typeof imageUrl !== "string") throw new Error("Format URL tidak didukung")

  if (imageUrl.startsWith("data:image")) return imageUrl

  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 })
    const buf = Buffer.from(res.data)
    if (!imageUrl.includes("data:")) {
      const mime = mimeFromBuffer(buf)
      return `data:${mime};base64,${buf.toString("base64")}`
    }
    return imageUrl
  }

  try {
    const buf = Buffer.from(imageUrl, "base64")
    if (!buf.length) throw new Error("Base64 kosong")
    return `data:${mimeFromBuffer(buf)};base64,${buf.toString("base64")}`
  } catch {
    throw new Error("Parameter 'url' harus berupa URL gambar atau base64")
  }
}

export default {
  name: "NexUpscale",
  description: "Upscale gambar AI (mode HD, Ultra HD, 4x, 4x V2) — output langsung berupa gambar",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "mode"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar, dataURL, atau base64",
      example: "https://example.com/image.jpg"
    },
    mode: {
      type: "string",
      required: false,
      default: "4x",
      description: "Mode upscale",
      enum: MODES
    }
  },

  async run(req, res) {
    try {
      const { url, mode = "4x" } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const m = String(mode).toLowerCase()
      if (!MODES.includes(m)) {
        return res.status(400).json({ status: false, message: `Mode tidak valid. Pilihan: ${MODES.join(", ")}` })
      }

      const imageBase64 = await prepareImage(url)

      const resApi = await axios.post(API_URL, { mode: m, imageBase64 }, {
        headers: DEFAULT_HEADERS,
        timeout: 90000,
      })

      if (resApi.data?.status !== true || !resApi.data?.resultUrl) {
        return res.status(502).json({ status: false, message: "NexUpscale gagal memproses gambar" })
      }

      const resultUrl = resApi.data.resultUrl

      const dl = await axios.get(resultUrl, {
        responseType: "arraybuffer",
        headers: {
          "user-agent": DEFAULT_HEADERS["user-agent"],
          "referer": "https://nexupscaleid.vercel.app/",
        },
        timeout: 60000,
      })

      const buffer = Buffer.from(dl.data)
      const contentType = dl.headers["content-type"]?.split(";")[0] || mimeFromBuffer(buffer)

      logger.info(`[NEXUPSCALE] ${m} | ${url.slice(0, 60)} | ${(buffer.length / 1024).toFixed(1)}KB`)

      res.setHeader("Content-Type", contentType)
      res.setHeader("X-Upscale-Mode", m)
      res.setHeader("X-Upscale-Source", resultUrl)
      return res.send(buffer)
    } catch (err) {
      logger.error(`[NEXUPSCALE] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Upscale failed" })
    }
  }
}
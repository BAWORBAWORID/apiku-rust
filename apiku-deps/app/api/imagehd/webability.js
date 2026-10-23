import axios from 'axios'
import logger from "../../src/utils/logger.js"

const API_URL = "https://www.webability.io/api/upscale-image"
const DEFAULT_HEADERS = {
  "accept": "*/*",
  "accept-language": "id-ID,id;q=0.9",
  "cache-control": "no-cache",
  "content-type": "application/json",
  "origin": "https://www.webability.io",
  "pragma": "no-cache",
  "referer": "https://www.webability.io/tools/ai-image-upscaler",
  "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"
}

function toDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`
}

async function prepareImage(imageUrl) {
  if (!imageUrl) throw new Error("Parameter 'url' wajib diisi")

  if (typeof imageUrl === "string") {
    if (imageUrl.startsWith("data:image")) return imageUrl
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 })
      return toDataUrl(Buffer.from(res.data))
    }
    try {
      return toDataUrl(Buffer.from(imageUrl, "base64"))
    } catch {}
  }
  throw new Error("Format URL tidak didukung")
}

export default {
  name: "WebAbility Upscaler",
  description: "Upscale gambar AI (scale 2/4, model esrgan, mode photo/anime)",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "scale", "model", "mode"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar atau base64",
      example: "https://example.com/image.jpg"
    },
    scale: {
      type: "string",
      required: false,
      default: "2",
      description: "Skala upscale",
      enum: ["2", "4"]
    },
    model: {
      type: "string",
      required: false,
      default: "esrgan",
      description: "Model upscale",
      enum: ["esrgan", "realesrgan", "realesrgan-anime"]
    },
    mode: {
      type: "string",
      required: false,
      default: "photo",
      description: "Mode gambar",
      enum: ["photo", "anime"]
    }
  },

  async run(req, res) {
    try {
      const { url, scale = "2", model = "esrgan", mode = "photo" } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const imageDataUrl = await prepareImage(url)

      const payload = { image: imageDataUrl, scale, model, mode }

      const resApi = await axios.post(API_URL, payload, { headers: DEFAULT_HEADERS, timeout: 60000 })
      const data = resApi.data

      if (data?.success === false) {
        return res.status(500).json({ status: false, message: data.error || "Upscale gagal" })
      }

      logger.info(`[WEBABILITY] Upscale success | url=${url} | scale=${scale} | model=${model}`)

      return res.json({
        status: true,
        result: data
      })
    } catch (err) {
      logger.error(`[WEBABILITY] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Upscale failed" })
    }
  }
}
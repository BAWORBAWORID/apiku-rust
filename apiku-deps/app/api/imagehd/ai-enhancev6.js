import axios from "axios"
import FormData from "form-data"
import logger from "../../src/utils/logger.js"

const API_URL = "https://ai-services.visual-paradigm.com/api/super-resolution/file"
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": BROWSER_UA },
  })
  return Buffer.from(res.data)
}

export default {
  name: "AI Enhance HD v6",
  description: "Super-resolution via FormData — cepat, tanpa auth",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan di-upscale",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      logger.info(`[AI-ENHANCE-V6] Start | ip=${req.ip}`)

      logger.info("[AI-ENHANCE-V6] Downloading image...")
      const imageBuffer = await downloadImage(url)

      logger.info("[AI-ENHANCE-V6] Sending to Visual Paradigm AI...")
      const form = new FormData()
      form.append("file", imageBuffer, { filename: "image.jpg", contentType: "image/jpeg" })

      const response = await axios.post(API_URL, form, {
        headers: {
          ...form.getHeaders(),
          "User-Agent": BROWSER_UA,
        },
        responseType: "arraybuffer",
        timeout: 120000,
        validateStatus: () => true,
      })

      if (response.status !== 200) {
        const msg = Buffer.from(response.data).toString("utf8")
        throw new Error(`Visual Paradigm returned ${response.status}: ${msg.substring(0, 200)}`)
      }

      const contentType = response.headers["content-type"] || ""
      if (!contentType.includes("image")) {
        const text = Buffer.from(response.data).toString("utf8")
        throw new Error(`Unexpected response type ${contentType}: ${text.substring(0, 200)}`)
      }

      const resultBuffer = Buffer.from(response.data)
      logger.info(`[AI-ENHANCE-V6] Done | size=${resultBuffer.length} bytes`)

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("X-Enhance-Service", "visual-paradigm-v6")

      return res.send(resultBuffer)
    } catch (err) {
      logger.error(`[AI-ENHANCE-V6] Error | ip=${req.ip} | ${err.message}`)

      if (err.message.includes("download")) {
        return res.status(502).json({ status: false, message: "Gagal download gambar" })
      }

      return res.status(500).json({ status: false, message: err.message || "Gagal memproses" })
    }
  }
}
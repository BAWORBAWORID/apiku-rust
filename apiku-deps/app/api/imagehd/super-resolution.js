/**
 * AI Super Resolution Image API
 * 
 * GET /tools/super-resolution?url=https://example.com/photo.jpg
 * 
 * result: 
 * - Langsung menampilkan gambar enhanced super resolution di browser
 * 
 * Author : Zyyvor
 * Base   : https://online.visual-paradigm.com
 */

import axios from "axios"
import FormData from "form-data"
import logger from "../../src/utils/logger.js"

async function enhanceImage(buffer) {
  const form = new FormData()
  form.append("file", buffer, { filename: "image.jpg", contentType: "image/jpeg" })

  const result = await axios.post("https://ai-services.visual-paradigm.com/api/super-resolution/file", form, {
    headers: {
      ...form.getHeaders(),
      "origin": "https://online.visual-paradigm.com",
      "referer": "https://online.visual-paradigm.com/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"
    },
    responseType: "arraybuffer",
    timeout: 60000
  })

  return Buffer.from(result.data)
}

export default {
  name: "AI Super Resolution",
  description: "Enhance image resolution and quality up to HD/4K using Visual Paradigm AI",
  category: "Image HD",
  methods: ["GET"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://cdn.yupra.my.id/yp/7ihn1v2f.jpg",
      description: "URL gambar yang akan di-enhance"
    }
  },

  async run(req, res) {
    try {
      const { url } = req.query || {}

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      /* =======================================
         AI SUPER RESOLUTION PROCESS
      ======================================= */

      logger.info(`[SUPER-RESOLUTION] Starting process | ip=${req.ip} | url=${url.substring(0, 50)}...`)

      // 1. Download input image
      const imgRes = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      })

      const imageBuffer = Buffer.from(imgRes.data)

      if (!imageBuffer || imageBuffer.length < 100) {
        return res.status(400).json({
          status: false,
          message: "Gagal mendownload gambar dari URL yang diberikan",
        })
      }

      // 2. Process super resolution
      logger.info(`[SUPER-RESOLUTION] Sending to Visual Paradigm API | size=${imageBuffer.length} bytes`)
      const enhancedBuffer = await enhanceImage(imageBuffer)

      if (!enhancedBuffer || enhancedBuffer.length < 100) {
        throw new Error("Proses super resolution gagal atau hasil kosong")
      }

      logger.info(
        `[SUPER-RESOLUTION] Success | ip=${req.ip} | url=${url.substring(0, 50)}... | output_size=${enhancedBuffer.length} bytes`
      )

      // Set header
      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("X-Enhance-Service", "visual-paradigm")
      res.setHeader("Content-Length", enhancedBuffer.length)

      // Kirim buffer langsung
      return res.send(enhancedBuffer)

    } catch (err) {
      logger.error(
        `[SUPER-RESOLUTION] Error | ip=${req.ip} | error=${err.message}`
      )

      // Check specific errors
      if (err.message.includes("timeout") || err.code === "ECONNABORTED") {
        return res.status(504).json({
          status: false,
          message: "Proses super resolution memakan waktu terlalu lama. Coba gambar lain.",
        })
      }

      if (err.response?.status === 404) {
        return res.status(404).json({
          status: false,
          message: "Gambar tidak ditemukan",
        })
      }

      if (err.message.includes("Proses super resolution gagal")) {
        return res.status(500).json({
          status: false,
          message: "Server gagal memproses super resolution gambar",
        })
      }

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses AI Super Resolution",
      })
    }
  },
}

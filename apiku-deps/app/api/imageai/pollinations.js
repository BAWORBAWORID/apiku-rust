import axios from "axios"
import logger from "../../src/utils/logger.js"

export default {
  name: "Pollinations AI Image",
  description: "Generate gambar AI. Mendukung berbagai prompt gambar.",
  category: "Image AI",
  methods: ["GET"],
  params: ["prompt"],

  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Deskripsi gambar yang ingin dibuat"
    }
  },

  features: {
    free: true,
    no_auth: true,
    high_resolution: true
  },

  async run(req, res) {
    try {
      const { prompt } = req.query || {}

      if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'prompt' wajib diisi",
        })
      }

      if (prompt.length > 1000) {
        return res.status(400).json({
          status: false,
          message: "Prompt terlalu panjang (maksimal 1000 karakter)",
        })
      }

      const encodedPrompt = encodeURIComponent(prompt.trim())
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=42&nologo=true`

      logger.info(`[POLLINATIONS] Fetching image for prompt: ${prompt.trim().substring(0, 50)}`)

      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      const contentType = response.headers['content-type'] || 'image/jpeg'
      const buffer = Buffer.from(response.data)

      res.setHeader("Content-Type", contentType)
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.setHeader("X-Image-Generator", "pollinations.ai")
      res.setHeader("X-Prompt", prompt.trim())

      return res.send(buffer)

    } catch (err) {
      logger.error(`[POLLINATIONS] Error: ${err.message}`)

      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        return res.status(504).json({
          status: false,
          message: "Timeout mengambil gambar dari Pollinations",
          code: "TIMEOUT"
        })
      }

      res.status(500).json({
        status: false,
        message: err.message || "Gagal generate gambar",
        code: "INTERNAL_ERROR"
      })
    }
  },
}

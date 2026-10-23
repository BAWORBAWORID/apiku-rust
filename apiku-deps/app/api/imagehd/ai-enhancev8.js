import axios from "axios"
import FormData from "form-data"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const BASE_URL = "https://image-upscaling.net"

function generateClientId() {
  return crypto.randomBytes(16).toString("hex")
}

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36" },
  })
  return Buffer.from(res.data)
}

async function uploadImage(buffer, clientId, scale, model, useFaceEnhance) {
  const form = new FormData()
  form.append("scale", scale)
  form.append("model", model)
  form.append("use_webp", "true")
  form.append("prompt", "")
  if (useFaceEnhance) form.append("fx", "")
  form.append("image", buffer, { filename: `upscale-${Date.now()}.jpg`, contentType: "image/jpeg" })

  const res = await axios.post(`${BASE_URL}/upscaling_upload`, form, {
    headers: {
      ...form.getHeaders(),
      Cookie: `client_id=${clientId}`,
    },
    responseType: "text",
    timeout: 60000,
  })

  return res.data
}

async function getStatus(clientId) {
  const res = await axios.get(`${BASE_URL}/upscaling_get_status_v2`, {
    headers: { Cookie: `client_id=${clientId}` },
    timeout: 15000,
  })
  return res.data
}

async function pollResult(clientId, originalFilename, interval = 2000, timeout = 120000) {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const list = await getStatus(clientId)

    if (Array.isArray(list)) {
      const item = list.find(x => x.original_filename === originalFilename || x.filename === originalFilename || list.length === 1)
      if (item && item.completed) {
        return `${item.image_url}?client_id=${clientId}&delete_after_download=`
      }
    }

    await new Promise(r => setTimeout(r, interval))
  }

  throw new Error("Timeout: image upscale not completed")
}

export default {
  name: "AI Enhance HD v8",
  description: "Upscale gambar — support scale 2x/4x, face enhancement",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "scale", "model"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan di-upscale"
    },
    scale: {
      type: "number",
      required: true,
      default: 4,
      description: "Scale factor",
      enum: [2, 4]
    },
    model: {
      type: "string",
      required: true,
      default: "general",
      description: "Model upscale",
      enum: ["general", "plus"]
    }
  },

  async run(req, res) {
    try {
      const { url, scale = 4, model = "general" } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      logger.info(`[AI-ENHANCE-V8] Start | ip=${req.ip}`)

      logger.info("[AI-ENHANCE-V8] Downloading image...")
      const imageBuffer = await downloadImage(url)

      const clientId = generateClientId()
      const useFaceEnhance = false

      logger.info("[AI-ENHANCE-V8] Uploading to image-upscaling.net...")
      const originalFilename = await uploadImage(imageBuffer, clientId, scale, model, useFaceEnhance)

      logger.info("[AI-ENHANCE-V8] Polling for result...")
      const downloadUrl = await pollResult(clientId, originalFilename)

      logger.info("[AI-ENHANCE-V8] Downloading result...")
      const result = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
        headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36" },
      })

      const resultBuffer = Buffer.from(result.data)
      const contentType = result.headers["content-type"] || "image/jpeg"
      logger.info(`[AI-ENHANCE-V8] Done | size=${resultBuffer.length} bytes`)

      res.setHeader("Content-Type", contentType)
      res.setHeader("X-Enhance-Service", "image-upscaling-net-v8")
      return res.send(resultBuffer)
    } catch (err) {
      logger.error(`[AI-ENHANCE-V8] Error | ip=${req.ip} | ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Gagal memproses" })
    }
  }
}

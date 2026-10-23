import axios from "axios"
import FormData from "form-data"
import logger from "../../src/utils/logger.js"

const CLOUD_NAME = "dtz0urit6"
const API_KEY = "985946268373735"
const UPLOAD_PRESET = "cloudinary-tools"
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`
const SIGNATURE_URL = "https://cloudinary-tools.netlify.app/.netlify/functions/sign-upload-params"

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": BROWSER_UA },
  })
  return Buffer.from(res.data)
}

async function getUploadSignature(timestamp) {
  const res = await axios.post(SIGNATURE_URL, {
    paramsToSign: {
      timestamp,
      upload_preset: UPLOAD_PRESET,
      source: "uw",
    },
  }, { timeout: 10000 })
  return res.data.signature
}

async function uploadToCloudinary(buffer, filename, signature, timestamp) {
  const form = new FormData()
  form.append("file", buffer, { filename, contentType: "image/png" })
  form.append("upload_preset", UPLOAD_PRESET)
  form.append("api_key", API_KEY)
  form.append("timestamp", String(timestamp))
  form.append("signature", signature)
  form.append("source", "uw")

  const res = await axios.post(UPLOAD_URL, form, {
    headers: { ...form.getHeaders() },
    timeout: 60000,
    validateStatus: () => true,
  })

  if (res.status !== 200) {
    throw new Error(`Upload failed (${res.status}): ${JSON.stringify(res.data)}`)
  }

  if (res.data.error) {
    throw new Error(`Upload error: ${res.data.error.message}`)
  }

  return res.data.public_id
}

export default {
  name: "AI Enhance HD v7",
  description: "Upscale via cloud AI — upload, signature, transform",
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

      logger.info(`[AI-ENHANCE-V7] Start | ip=${req.ip}`)

      logger.info("[AI-ENHANCE-V7] Downloading image...")
      const imageBuffer = await downloadImage(url)

      const timestamp = Math.floor(Date.now() / 1000)
      logger.info("[AI-ENHANCE-V7] Getting upload signature...")
      const signature = await getUploadSignature(timestamp)

      logger.info("[AI-ENHANCE-V7] Uploading to Cloudinary...")
      const publicId = await uploadToCloudinary(imageBuffer, `upscale-${Date.now()}.png`, signature, timestamp)
      logger.info(`[AI-ENHANCE-V7] Uploaded | public_id=${publicId}`)

      const upscaledUrl = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/e_upscale/${publicId}.png`
      logger.info("[AI-ENHANCE-V7] Downloading upscaled result...")
      const result = await axios.get(upscaledUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
        headers: { "User-Agent": BROWSER_UA },
      })

      const resultBuffer = Buffer.from(result.data)
      const contentType = result.headers["content-type"] || "image/png"
      logger.info(`[AI-ENHANCE-V7] Done | size=${resultBuffer.length} bytes`)

      res.setHeader("Content-Type", contentType)
      res.setHeader("X-Enhance-Service", "cloudinary-v7")
      res.setHeader("X-Task-Id", publicId)

      return res.send(resultBuffer)
    } catch (err) {
      logger.error(`[AI-ENHANCE-V7] Error | ip=${req.ip} | ${err.message}`)

      if (err.message.includes("download")) {
        return res.status(502).json({ status: false, message: "Gagal download gambar" })
      }

      return res.status(500).json({ status: false, message: err.message || "Gagal memproses" })
    }
  }
}
import axios from "axios"
import FormData from "form-data"
import logger from "../../src/utils/logger.js"

const BASE = "https://restapi.cutout.pro"

const BROWSER_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7339.0 Mobile Safari/537.36"

async function uploadImage(buffer, filename) {
  const form = new FormData()
  form.append("file", buffer, { filename, contentType: "image/jpeg" })

  const { data } = await axios.post(`${BASE}/oss/upload`, form, {
    headers: {
      ...form.getHeaders(),
      Origin: "https://www.cutout.pro",
      "User-Agent": BROWSER_UA,
    },
    timeout: 30000,
  })

  if (data.code !== 0 || !data.data) {
    throw new Error(data.msg || "Gagal upload gambar ke server")
  }

  return data.data
}

async function submitTask(imageUrl) {
  const encoded = encodeURIComponent(imageUrl)
  const { data } = await axios.get(
    `${BASE}/webMatting/photoEnhancer/submitTaskByUrl?token=&imageUrl=${encoded}`,
    {
      headers: {
        Origin: "https://www.cutout.pro",
        Referer: "https://www.cutout.pro/",
        "User-Agent": BROWSER_UA,
      },
      timeout: 30000,
    }
  )

  if (data.code !== 0 || !data.data) {
    throw new Error(data.msg || "Gagal submit task enhance")
  }

  return data.data
}

async function getTaskInfo(taskId) {
  const { data } = await axios.get(
    `${BASE}/webMatting/photoEnhancer/getTaskInfo?token=&id=${taskId}`,
    {
      headers: {
        Origin: "https://www.cutout.pro",
        Referer: "https://www.cutout.pro/",
        "User-Agent": BROWSER_UA,
      },
      timeout: 15000,
    }
  )

  if (data.code !== 0) {
    throw new Error(data.msg || "Gagal mendapatkan info task")
  }

  return data.data
}

async function pollTask(taskId, maxAttempts = 30, interval = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await getTaskInfo(taskId)

    if (info.status === "success") {
      return info
    }

    if (info.status === "failed") {
      throw new Error("Task enhance gagal diproses")
    }

    await new Promise(r => setTimeout(r, interval))
  }

  throw new Error("Timeout menunggu hasil enhance")
}

async function downloadImage(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
      headers: { "User-Agent": BROWSER_UA },
    })
    return Buffer.from(res.data)
  } catch (e) {
    logger.error(`[AI-ENHANCE-V3] Download failed: ${e.message}`)
    return null
  }
}

export default {
  name: "AI Enhance HD v3",
  description: "Upscale via upload, task, dan polling",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan di-enhance"
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      logger.info(`[AI-ENHANCE-V3] Starting | ip=${req.ip} | url=${url.substring(0, 60)}...`)

      const imageBuffer = await downloadImage(url)
      if (!imageBuffer) {
        return res.status(400).json({
          status: false,
          message: "Gagal mendownload gambar dari URL",
        })
      }

      const filename = `enhance-${Date.now()}.jpg`

      logger.info("[AI-ENHANCE-V3] Uploading to OSS...")
      const ossUrl = await uploadImage(imageBuffer, filename)
      logger.info(`[AI-ENHANCE-V3] Uploaded | ossUrl=${ossUrl.substring(0, 60)}...`)

      logger.info("[AI-ENHANCE-V3] Submitting task...")
      const taskId = await submitTask(ossUrl)
      logger.info(`[AI-ENHANCE-V3] Task submitted | id=${taskId}`)

      logger.info("[AI-ENHANCE-V3] Polling for result...")
      const result = await pollTask(taskId)
      logger.info(`[AI-ENHANCE-V3] Task completed | status=${result.status}`)

      const resultUrl = result.bgRemovedPreview || result.downloadFileUrl || result.original
      if (!resultUrl) {
        return res.status(500).json({
          status: false,
          message: "Tidak ada URL hasil enhance",
        })
      }

      const enhancedBuffer = await downloadImage(resultUrl)
      if (!enhancedBuffer) {
        return res.status(500).json({
          status: false,
          message: "Gagal mendownload hasil enhance",
        })
      }

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("X-Enhance-Service", "cutout-pro-v3")
      res.setHeader("X-Task-Id", taskId)
      res.setHeader("X-Original-Width", result.originalWidth || "unknown")
      res.setHeader("X-Original-Height", result.originalHeight || "unknown")
      res.setHeader("X-Preview-Width", result.previewWidth || "unknown")
      res.setHeader("X-Preview-Height", result.previewHeight || "unknown")

      return res.send(enhancedBuffer)
    } catch (err) {
      logger.error(`[AI-ENHANCE-V3] Error | ip=${req.ip} | error=${err.message}`)

      if (err.message.includes("upload")) {
        return res.status(502).json({ status: false, message: "Gagal upload ke server" })
      }
      if (err.message.includes("submit")) {
        return res.status(502).json({ status: false, message: "Gagal submit task" })
      }
      if (err.message.includes("Timeout")) {
        return res.status(504).json({ status: false, message: "Timeout menunggu hasil" })
      }

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses AI enhance v3",
      })
    }
  }
}

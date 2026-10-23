/**
 * AI Enhance-HD Image API
 * 
 * GET /tools/ai-enhance?url=https://example.com/photo.jpg
 * 
 * result: 
 * - Langsung menampilkan gambar enhanced di browser
 * 
 * Author : Gienetic
 * Base   : https://play.google.com/store/apps/details?id=photoeditor.photocut.background.eraser.collagemaker.cutout
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"
import crypto from "crypto"

const BASE_URL = "https://aiapi.thinkyeah.com"

const HEADERS = {
  "Host": "aiapi.thinkyeah.com",
  "accept": "application/json",
  "content-type": "application/json; charset=utf-8",
  "accept-encoding": "gzip",
  "user-agent": "okhttp/4.11.0"
}

const generateIdentity = () => {
  return {
    adid: crypto.randomUUID(),
    dcid: crypto.randomUUID(),
    is_pro_user: "false",
    region: "ID",
    language: "in",
    app_version_code: "2310",
    package_name: "photoeditor.photocut.background.eraser.collagemaker.cutout",
    purchase_token: "",
    firebase_user_id: crypto.randomBytes(16).toString('hex'),
    is_internal_user: "false"
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function urlToBase64(url) {
  try {
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    return Buffer.from(response.data).toString('base64')
  } catch (e) {
    return null
  }
}

async function enhanceImage(base64Data, identity) {
  try {
    const payload = {
      "upscale": "2",
      "is_upscale": "true",
      "model": "default",
      "imagedata": base64Data
    }

    const { data } = await axios.post(`${BASE_URL}/api/enhance/async`, payload, {
      headers: HEADERS,
      params: { ...identity, request_id: crypto.randomUUID() },
      timeout: 30000
    })

    if (data?.code === 200) return data.data.task_id
    return null
  } catch (e) {
    return null
  }
}

async function getResult(taskId, identity) {
  let attempts = 0
  const maxAttempts = 30 // Max 45 detik (30 * 1.5 detik)
  
  while (attempts < maxAttempts) {
    try {
      const { data } = await axios.get(`${BASE_URL}/api/task/query`, {
        headers: HEADERS,
        params: { ...identity, task_id: taskId },
        timeout: 30000
      })

      if (data?.data?.status === 'success') {
        return data.data.result
      } else if (data?.data?.status === 'fail') {
        throw new Error("Proses enhance gagal")
      }
    } catch (e) {
      if (e.message.includes("Proses enhance gagal")) {
        throw e
      }
    }
    
    attempts++
    await sleep(1500)
  }
  
  throw new Error("Timeout proses enhance")
}

export default {
  name: "AI Enhance HD",
  description: "Enhance image resolution and quality using AI (Premium v2)",
  category: "Image HD",
  methods: ["GET"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar "
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
         AI ENHANCE PROCESS
      ======================================= */
      
      logger.info(`[AI-ENHANCE] Starting process | ip=${req.ip} | url=${url.substring(0, 50)}...`)

      // 1. Generate identity
      const identity = generateIdentity()

      // 2. Download image and convert to base64
      const base64 = await urlToBase64(url)
      
      if (!base64) {
        return res.status(400).json({
          status: false,
          message: "Gagal mendownload gambar dari URL yang diberikan",
        })
      }

      // 3. Create enhance job
      const taskId = await enhanceImage(base64, identity)
      
      if (!taskId) {
        return res.status(502).json({
          status: false,
          message: "Gagal membuat task enhance. Server sedang sibuk.",
        })
      }

      logger.info(`[AI-ENHANCE] Task created | ip=${req.ip} | taskId=${taskId}`)

      // 4. Poll for result
      const result = await getResult(taskId, identity)
      
      if (!result) {
        throw new Error("Hasil enhance tidak ditemukan")
      }

      const outputUrl = result.result_url || result.url || result.output_url
      
      if (!outputUrl) {
        throw new Error("URL hasil enhance tidak ditemukan")
      }

      // 5. Download enhanced image
      const finalImage = await axios.get(outputUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      const imageBuffer = Buffer.from(finalImage.data)

      logger.info(
        `[AI-ENHANCE] Success | ip=${req.ip} | url=${url.substring(0, 50)}... | taskId=${taskId}`
      )

      // Determine content type from response headers or default to JPEG
      let contentType = finalImage.headers['content-type'] || "image/jpeg"
      
      // Fallback jika content-type tidak valid
      if (!contentType.startsWith('image/')) {
        contentType = "image/jpeg"
      }

      // Set header
      res.setHeader("Content-Type", contentType)
      res.setHeader("X-Enhance-Service", "thinkyeah")
      res.setHeader("X-Task-ID", taskId)
      
      // Kirim buffer langsung
      return res.send(imageBuffer)

    } catch (err) {
      logger.error(
        `[AI-ENHANCE] Error | ip=${req.ip} | error=${err.message}`
      )
      
      // Check specific errors
      if (err.message.includes("Timeout")) {
        return res.status(504).json({
          status: false,
          message: "Proses enhance memakan waktu terlalu lama. Coba gambar lain.",
        })
      }
      
      if (err.code === "ECONNABORTED") {
        return res.status(504).json({
          status: false,
          message: "Timeout mengambil gambar",
        })
      }
      
      if (err.response?.status === 404) {
        return res.status(404).json({
          status: false,
          message: "Gambar tidak ditemukan",
        })
      }
      
      if (err.message.includes("Proses enhance gagal")) {
        return res.status(500).json({
          status: false,
          message: "Server gagal memproses enhance gambar",
        })
      }
      
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses AI enhance",
      })
    }
  },
}
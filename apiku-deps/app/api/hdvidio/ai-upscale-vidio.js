/**
 * Video Upscale API (Direct Video Response)
 * 
 * GET /tools/upscale-video?url=https://example.com/video.mp4&resolution=2k
 * 
 * result: 
 * - Langsung menampilkan/mendownload video upscaled di browser
 */

import axios from "axios"
import FormData from "form-data"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

// Enum untuk resolusi video
const VideoResolution = {
  SD_480P: "480p",
  HD_720P: "720p",
  FULL_HD_1080P: "1080p",
  QHD_2K: "2k",
  UHD_4K: "4k",
  
  // Untuk validasi
  isValid(resolution) {
    return Object.values(this).includes(resolution)
  },
  
  // Untuk mendapatkan nilai numerik (jika diperlukan)
  getNumericValue(resolution) {
    const map = {
      "480p": 480,
      "720p": 720,
      "1080p": 1080,
      "2k": 1440,
      "4k": 2160
    }
    return map[resolution] || 1080
  },
  
  // Deskripsi untuk response
  getDescription(resolution) {
    const descriptions = {
      "480p": "SD (480p) - Standard Definition",
      "720p": "HD (720p) - High Definition",
      "1080p": "Full HD (1080p) - Full High Definition",
      "2k": "QHD (2K) - Quad High Definition",
      "4k": "UHD (4K) - Ultra High Definition"
    }
    return descriptions[resolution] || resolution
  }
}

export default {
  name: "Video Upscale AI",
  description: "Upscale video resolution and quality (supports up to 4K)",
  category: "HD Video",
  methods: ["GET"],
  params: ["url", "resolution"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video yang akan diupscale"
    },
    resolution: {
      type: "string",
      required: false,
      description: `Resolusi target: ${Object.values(VideoResolution).filter(v => typeof v === 'string').join(', ')}`,
      enum: Object.values(VideoResolution).filter(v => typeof v === 'string'),
      default: VideoResolution.FULL_HD_1080P
    }
  },

  async run(req, res) {
    try {
      const { url, resolution = VideoResolution.FULL_HD_1080P } = req.query || {}

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      // Validasi resolusi menggunakan enum
      if (!VideoResolution.isValid(resolution)) {
        return res.status(400).json({
          status: false,
          message: `Resolusi tidak valid. Pilih salah satu: ${Object.values(VideoResolution).filter(v => typeof v === 'string').join(', ')}`,
          validResolutions: Object.values(VideoResolution).filter(v => typeof v === 'string'),
          resolutionInfo: {
            "480p": "SD (480p) - Untuk video pendek, kualitas standar",
            "720p": "HD (720p) - Kualitas menengah, ukuran file sedang",
            "1080p": "Full HD (1080p) - Kualitas tinggi, ukuran file besar",
            "2k": "2K/QHD - Kualitas sangat tinggi, ukuran file lebih besar",
            "4k": "4K/UHD - Kualitas tertinggi, ukuran file terbesar"
          }
        })
      }

      /* =======================================
         VIDEO UPSCALE PROCESS
      ======================================= */

      logger.info(`[VIDEO-UPSCALE] Starting | ip=${req.ip} | url=${url.substring(0, 50)}... | resolution=${resolution} (${VideoResolution.getDescription(resolution)})`)

      // 1. Download video from URL
      let videoResponse
      try {
        videoResponse = await axios.get(url, { 
          responseType: 'arraybuffer',
          timeout: 60000, // 60 detik untuk download video
          maxContentLength: 100 * 1024 * 1024, // Max 100MB
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })
      } catch (error) {
        if (error.code === 'ECONNABORTED') {
          throw new Error("Timeout saat mendownload video")
        }
        if (error.response?.status === 404) {
          throw new Error("Video tidak ditemukan")
        }
        throw new Error(`Gagal mendownload video: ${error.message}`)
      }
      
      const videoBuffer = Buffer.from(videoResponse.data)
      
      // Cek ukuran file
      const fileSizeMB = videoBuffer.length / (1024 * 1024)
      if (fileSizeMB > 100) {
        return res.status(400).json({
          status: false,
          message: "Ukuran video terlalu besar. Maksimal 100MB",
          currentSize: `${fileSizeMB.toFixed(2)}MB`,
          maxSize: "100MB"
        })
      }

      // Cek tipe file
      const contentType = videoResponse.headers['content-type']
      if (!contentType?.includes('video/')) {
        return res.status(400).json({
          status: false,
          message: "URL harus mengarah ke file video",
          contentType: contentType || 'unknown'
        })
      }

      // 2. Generate serial dan headers
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      const SERIAL = crypto.createHash('md5').update(UA + Date.now()).digest('hex')

      const headers = (extra = {}) => Object.assign({
        'accept': '*/*',
        'product-serial': SERIAL,
        'user-agent': UA,
        'origin': 'https://unblurimage.ai',
        'referer': 'https://unblurimage.ai/',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
      }, extra)

      // 3. Register upload URL
      const fileName = crypto.randomBytes(3).toString('hex') + '_video.mp4'
      const formReg = new FormData()
      formReg.append('video_file_name', fileName)

      logger.debug(`[VIDEO-UPSCALE] Registering upload for ${fileName}`)

      const reg = await axios.post(
        'https://api.unblurimage.ai/api/upscaler/v1/ai-video-enhancer/upload-video',
        formReg,
        { 
          headers: Object.assign(headers(), formReg.getHeaders()),
          timeout: 30000
        }
      )

      if (!reg.data?.result?.url || !reg.data?.result?.object_name) {
        throw new Error("Gagal mendapatkan upload URL")
      }

      const { url: ossUrl, object_name: objectName } = reg.data.result

      // 4. Upload video ke OSS
      logger.debug(`[VIDEO-UPSCALE] Uploading video to OSS...`)

      await axios.put(ossUrl, videoBuffer, {
        headers: { 
          'Content-Type': contentType || 'video/mp4', 
          'User-Agent': UA 
        },
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024
      })

      // 5. Create upscale job
      const formJob = new FormData()
      formJob.append('original_video_file', `https://cdn.unblurimage.ai/${objectName}`)
      formJob.append('resolution', resolution)
      formJob.append('is_preview', 'false')

      logger.debug(`[VIDEO-UPSCALE] Creating job with resolution ${resolution}`)

      const create = await axios.post(
        'https://api.unblurimage.ai/api/upscaler/v2/ai-video-enhancer/create-job',
        formJob,
        { 
          headers: Object.assign(headers(), formJob.getHeaders()),
          timeout: 30000
        }
      )

      const jobId = create.data?.result?.job_id
      if (!jobId) {
        throw new Error("Gagal membuat job upscale")
      }

      // 6. Polling for result
      logger.info(`[VIDEO-UPSCALE] Job created: ${jobId}. Waiting for processing...`)

      let outputUrl = null
      let attempts = 0
      const maxAttempts = 120 // 120 * 5 detik = 10 menit max
      const pollInterval = 5000 // 5 detik

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))

        const check = await axios.get(
          `https://api.unblurimage.ai/api/upscaler/v2/ai-video-enhancer/get-job/${jobId}`,
          { 
            headers: headers(),
            timeout: 30000
          }
        )

        const status = check.data?.result?.status
        const jobOutput = check.data?.result?.output_url

        if (jobOutput) {
          outputUrl = jobOutput
          logger.info(`[VIDEO-UPSCALE] Job completed after ${attempts + 1} attempts`)
          break
        }

        if (status === 'error' || status === 'failed') {
          throw new Error(`Job failed: ${check.data?.result?.message || 'Unknown error'}`)
        }

        attempts++
        
        if (attempts % 12 === 0) { // Log setiap 1 menit
          logger.debug(`[VIDEO-UPSCALE] Still processing... attempt ${attempts}/${maxAttempts}`)
        }
      }

      if (!outputUrl) {
        throw new Error(`Timeout setelah ${maxAttempts * pollInterval / 1000} detik`)
      }

      // 7. Download upscaled video
      logger.debug(`[VIDEO-UPSCALE] Downloading upscaled video from ${outputUrl}`)

      const finalVideo = await axios.get(outputUrl, {
        responseType: 'arraybuffer',
        timeout: 120000, // 2 menit untuk download hasil
        maxContentLength: 500 * 1024 * 1024, // Max 500MB untuk hasil
        headers: {
          'User-Agent': UA
        }
      })

      const videoBufferResult = Buffer.from(finalVideo.data)
      const resultSizeMB = videoBufferResult.length / (1024 * 1024)

      logger.info(
        `[VIDEO-UPSCALE] Success | ip=${req.ip} | ` +
        `original=${fileSizeMB.toFixed(2)}MB | ` +
        `result=${resultSizeMB.toFixed(2)}MB | ` +
        `resolution=${resolution} | attempts=${attempts + 1}`
      )

      // Tentukan content type
      let resultContentType = finalVideo.headers['content-type'] || "video/mp4"
      
      if (!resultContentType.startsWith('video/')) {
        resultContentType = "video/mp4"
      }

      // Set headers untuk response
      res.setHeader("Content-Type", resultContentType)
      res.setHeader("Content-Disposition", `attachment; filename="upscaled_${resolution}_${fileName}"`)
      res.setHeader("X-Video-Processor", "unblurimage.ai")
      res.setHeader("X-Resolution", resolution)
      res.setHeader("X-Resolution-Info", VideoResolution.getDescription(resolution))
      res.setHeader("X-Job-ID", jobId)
      res.setHeader("X-Original-Size-MB", fileSizeMB.toFixed(2))
      res.setHeader("X-Result-Size-MB", resultSizeMB.toFixed(2))
      res.setHeader("X-Processing-Attempts", attempts + 1)
      
      return res.send(videoBufferResult)

    } catch (err) {
      logger.error(
        `[VIDEO-UPSCALE] Error | ip=${req.ip} | error=${err.message}`
      )
      
      // Handle specific errors
      if (err.message.includes("Timeout saat mendownload video")) {
        return res.status(504).json({
          status: false,
          message: "Timeout saat mendownload video. Pastikan video dapat diakses.",
        })
      }
      
      if (err.message.includes("Video tidak ditemukan")) {
        return res.status(404).json({
          status: false,
          message: "Video tidak ditemukan di URL tersebut",
        })
      }
      
      if (err.message.includes("Gagal mendapatkan upload URL")) {
        return res.status(502).json({
          status: false,
          message: "Server upload video sedang bermasalah",
        })
      }
      
      if (err.message.includes("Gagal membuat job")) {
        return res.status(502).json({
          status: false,
          message: "Server upscale video sedang bermasalah",
        })
      }
      
      if (err.message.includes("Job failed")) {
        return res.status(500).json({
          status: false,
          message: "Proses upscale video gagal",
          detail: err.message,
        })
      }
      
      if (err.message.includes("Timeout setelah")) {
        return res.status(504).json({
          status: false,
          message: "Proses upscale video terlalu lama. Coba dengan resolusi lebih rendah atau video lebih pendek.",
        })
      }
      
      if (err.code === "ECONNABORTED") {
        return res.status(504).json({
          status: false,
          message: "Koneksi timeout",
        })
      }
      
      if (err.response?.status === 429) {
        return res.status(429).json({
          status: false,
          message: "Terlalu banyak permintaan. Silakan coba lagi nanti.",
        })
      }
      
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses upscale video",
        resolution: resolution,
        validResolutions: Object.values(VideoResolution).filter(v => typeof v === 'string')
      })
    }
  },
}

// Export enum untuk digunakan di module lain jika diperlukan
export { VideoResolution }
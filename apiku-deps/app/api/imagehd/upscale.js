/**
 * Upscale API (Direct Image Response)
 * 
 * GET /tools/upscale?url=https://example.com/photo.jpg
 * 
 * result: 
 * - Langsung menampilkan gambar upscaled di browser
 */

import axios from "axios"
import FormData from "form-data"
import logger from "../../src/utils/logger.js"

export default {
  name: "Upscale AI",
  description: "Upscale image resolution and quality",
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
         UPSCALE PROCESS
      ======================================= */
      
      // 1. Download image from URL
      const imageResponse = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      
      const buffer = Buffer.from(imageResponse.data)

      // 2. Create Upscale Job
      const form = new FormData()
      form.append('original_image_file', buffer, 'image.jpg')

      const createJobResponse = await axios.post(
        'https://api.imgupscaler.ai/api/image-upscaler/v2/upscale/create-job',
        form,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 15; 23124RA7EO Build/AQ3A.240829.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.174 Mobile Safari/537.36',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'sec-ch-ua-platform': '"Android"',
            'authorization': '',
            'timezone': 'Asia/Jakarta',
            'sec-ch-ua': '"Chromium";v="142", "Android WebView";v="142", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?1',
            'product-serial': '0a78953065c51e7532fbb98019e2233b',
            'origin': 'https://imgupscaler.ai',
            'x-requested-with': 'mark.via.gp',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://imgupscaler.ai/',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'priority': 'u=1, i',
            ...form.getHeaders()
          },
          timeout: 30000
        }
      )

      if (!createJobResponse.data?.result?.job_id) {
        throw new Error("Gagal membuat upscale job")
      }

      const jobId = createJobResponse.data.result.job_id

      // 3. Polling Result
      let result
      let attempts = 0
      const maxAttempts = 120 // Max 120 detik (60 * 2 detik)
      
      while (attempts < maxAttempts) {
        result = await axios.get(
          `https://api.imgupscaler.ai/api/image-upscaler/v1/universal_upscale/get-job/${jobId}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Linux; Android 15; 23124RA7EO Build/AQ3A.240829.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.174 Mobile Safari/537.36',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'access-control-request-method': 'GET',
              'access-control-request-headers': 'product-serial',
              'origin': 'https://imgupscaler.ai',
              'sec-fetch-mode': 'cors',
              'x-requested-with': 'mark.via.gp',
              'sec-fetch-site': 'same-site',
              'sec-fetch-dest': 'empty',
              'referer': 'https://imgupscaler.ai/',
              'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
              'priority': 'u=1, i'
            },
            timeout: 30000
          }
        )

        const outputUrl = result.data?.result?.output_url
        
        if (outputUrl) {
          break
        }
        
        // Check for error status
        const status = result.data?.result?.status
        if (status === "error" || status === "failed") {
          throw new Error("Proses upscale gagal: " + (result.data?.result?.message || "Unknown error"))
        }
        
        await new Promise(r => setTimeout(r, 2000)) // Poll setiap 2 detik
        attempts++
      }

      if (attempts >= maxAttempts) {
        throw new Error("Timeout proses upscale")
      }

      const outputUrl = result.data.result.output_url
      if (!outputUrl) {
        throw new Error("Hasil upscale tidak ditemukan")
      }

      // 4. Download Upscaled Image
      const finalImage = await axios.get(outputUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      const imageBuffer = Buffer.from(finalImage.data)

      logger.info(
        `[UPSCALE] image sent | ip=${req.ip} | url=${url.substring(0, 50)}... | attempts=${attempts}`
      )

      // Determine content type from response headers or default to JPEG
      let contentType = finalImage.headers['content-type'] || "image/jpeg"
      
      // Fallback jika content-type tidak valid
      if (!contentType.startsWith('image/')) {
        contentType = "image/jpeg"
      }

      // Set header agar browser mengenali ini sebagai gambar
      res.setHeader("Content-Type", contentType)
      //res.setHeader("Cache-Control", "public, max-age=86400") // Cache 1 hari
      //res.setHeader("X-Image-Processor", "imgupscaler.ai")
      //res.setHeader("X-Upscale-Service", "v2")
      //res.setHeader("X-Job-ID", jobId)
      //res.setHeader("X-Polling-Attempts", attempts)
      //res.setHeader("X-Original-URL", url)
      
      // Kirim buffer langsung
      return res.send(imageBuffer)

    } catch (err) {
      logger.error(
        `[UPSCALE] Error | ip=${req.ip} | error=${err.message}`
      )
      
      // Check specific errors
      if (err.message.includes("Gagal membuat upscale job")) {
        return res.status(502).json({
          status: false,
          message: "Server upscale sedang bermasalah",
        })
      }
      
      if (err.message.includes("Timeout")) {
        return res.status(504).json({
          status: false,
          message: "Proses upscale memakan waktu terlalu lama. Coba gambar lain.",
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
      
      if (err.message.includes("Proses upscale gagal")) {
        return res.status(500).json({
          status: false,
          message: "Proses upscale mengalami error",
          detail: err.message.replace("Proses upscale gagal: ", "")
        })
      }
      
      if (err.message.includes("endsWith")) {
        return res.status(500).json({
          status: false,
          message: "Error processing image URL format",
        })
      }
      
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses upscale",
      })
    }
  },
}
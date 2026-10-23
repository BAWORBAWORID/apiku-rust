/**
 * Ghibli Style Image Generator
 * Provider: ghibli-proxy (overchat.ai)
 * Parameter: url
 * NO API KEY
 */

import axios from "axios"

/* ===============================
   KONFIGURASI
================================ */
const API_URL = 'https://ghibli-proxy.netlify.app/.netlify/functions/ghibli-proxy'
const DEFAULT_PROMPT = 'Transform this image into beautiful Studio Ghibli anime art style with soft colors, dreamy atmosphere, and hand-painted aesthetic'



const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://overchat.ai',
  'Referer': 'https://overchat.ai/image/ghibli'
}

/* ===============================
   FUNGSI UTAMA GHIBLI PROCESSOR
================================ */
async function ghibliTransform(imageUrl) {
  try {
    // 1. Download gambar dari URL
    const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(imageRes.data)
    const contentType = imageRes.headers['content-type'] || 'image/jpeg'
    const base64Image = `data:${contentType};base64,${buffer.toString('base64')}`

    // 2. Siapkan payload dengan prompt default
    const payload = {
      image: base64Image,
      prompt: DEFAULT_PROMPT,
      model: 'gpt-image-1',
      n: 1,
      size: '1024x1024',
      quality: 'low'
    }

    // 3. Kirim ke proxy Ghibli
    const response = await axios.post(API_URL, payload, { headers: HEADERS })

    if (!response.data || !response.data.success) {
      throw new Error("Ghibli API responded with failure.")
    }

    const resultData = response.data.data[0]
    let resultBuffer

    if (resultData.b64_json) {
      // Hasil dalam bentuk base64
      resultBuffer = Buffer.from(resultData.b64_json, 'base64')
    } else if (resultData.url) {
      // Hasil berupa URL, download lagi
      const imgRes = await axios.get(resultData.url, { responseType: 'arraybuffer' })
      resultBuffer = Buffer.from(imgRes.data)
    } else {
      throw new Error("API success but no image data returned.")
    }

    return resultBuffer
  } catch (error) {
    const msg = error.response
      ? `API Error ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message
    throw new Error(`Ghibli transformation failed: ${msg}`)
  }
}

/* ===============================
   EXPORT API (SESUAI FORMAT AWAL)
================================ */
export default {
  name: "Ghibli Style Generator",
  description: "Transform images into Studio Ghibli anime art style",
  category: "Image",
  methods: ["GET"],
  params: ["url"],
  paramsSchema: {
     url: {
          type: "string",
          required: true,
          default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
          description: "URL gambar yang akan diubah"
      }
  },

  async run(req, res) {
    try {
      const { url } = req.query

      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi (URL gambar)"
        })
      }

      // Validasi URL
      try {
        new URL(url)
      } catch (e) {
        return res.status(400).json({
          status: false,
          message: "URL tidak valid"
        })
      }

      // Proses transformasi Ghibli
      const imageBuffer = await ghibliTransform(url.trim())

      // Kirim langsung gambar hasil (format PNG)
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Content-Length', imageBuffer.length)
      return res.send(imageBuffer)

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Ghibli transformation request failed"
      })
    }
  },
}
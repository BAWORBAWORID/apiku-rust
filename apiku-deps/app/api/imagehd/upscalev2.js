/**
 * Image Upscaler
 * Provider: picupscaler.com
 * Parameter: image (file upload), scale (opsional: 2,4,8)
 * NO API KEY
 */

import formidable from "formidable"
import fs from "fs"
import axios from "axios"
import { shz as bycf } from "bycf"
import FormData from "form-data"

/* ===============================
   UPSCALER CONFIGURATION
================================ */
const SCALE_OPTIONS = ['2', '4', '8']

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'Accept-Language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6'
}

/* ===============================
   TURNSTILE SOLVER
================================ */
async function solveTurnstile() {
  try {
    const res = await Promise.race([
      bycf.turnstileMin('https://picupscaler.com', '0x4AAAAAABvAGhZHOnPwmOvR'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Turnstile solver timeout')), 6000))
    ])
    const token = typeof res === 'object' && res?.token ? res.token : res
    return token || ''
  } catch (error) {
    // PicUpscaler API tetap memproses upscale meskipun token kosong
    return ''
  }
}

/* ===============================
   UPSCALER CLIENT FUNCTION
================================ */
async function upscaleImage(imagePath, scale = '2') {
  try {
    // Validasi parameter
    if (!imagePath) {
      throw new Error("Image path cannot be empty")
    }

    if (!fs.existsSync(imagePath)) {
      throw new Error("Image file does not exist")
    }

    // Validasi scale
    if (!SCALE_OPTIONS.includes(String(scale))) {
      throw new Error(`Invalid scale. Must be one of: ${SCALE_OPTIONS.join(', ')}`)
    }

    // Get Turnstile token
    const turnstileToken = await solveTurnstile()

    // Prepare form data
    const form = new FormData()
    form.append(
      'image',
      fs.createReadStream(imagePath),
      {
        filename: imagePath.split('/').pop(),
        contentType: 'image/jpeg'
      }
    )
    form.append('user_id', '')
    form.append('is_public', 'true')
    form.append('turnstile_token', turnstileToken)
    form.append('scale', String(scale))

    // Send request to upscaler API
    const response = await axios.post(
      'https://picupscaler.com/api/generate/handle',
      form,
      {
        headers: {
          ...HEADERS,
          ...form.getHeaders(),
          'origin': 'https://picupscaler.com',
          'referer': 'https://picupscaler.com/',
          'accept': 'application/json, text/plain, */*'
        },
        maxBodyLength: Infinity,
        timeout: 120000 // 2 menit timeout untuk proses upscale
      }
    )

    if (!response.data) {
      throw new Error("No response received from upscaler service")
    }

    return {
      success: true,
      data: response.data,
      scale: scale,
      message: "Image successfully upscaled"
    }

  } catch (error) {
    console.error("Upscaler Error:", error.message)
    throw new Error(`Failed to upscale image: ${error.message}`)
  }
}

/* ===============================
   CLEANUP TEMP FILE
================================ */
function cleanupTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (error) {
    console.warn("Failed to cleanup temp file:", error.message)
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "Image Upscaler",
  description: "Image Upscaler V2",
  category: "Image HD",
  methods: ["POST"],
  params: ["image", "scale"],
  paramsSchema: {
    image: {
      type: "file",
      required: true,
      description: "Image file to upscale",
    },
    scale: {
      type: "string",
      required: false,
      default: "2",
      enum: SCALE_OPTIONS,
      description: "Upscale factor: 2, 4, or 8",
    },
  },

  async run(req, res) {
    let tempFilePath = null

    try {
      // Parse form data with formidable
      const form = formidable({
        multiples: false,
        keepExtensions: true,
        maxFileSize: 10 * 1024 * 1024, // 10MB limit
      })

      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err)
          resolve([fields, files])
        })
      })

      // Get image file
      const imageFile = files.image
      if (!imageFile || !imageFile[0]) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'image' wajib diisi (file upload)",
        })
      }

      // Get scale parameter
      const scale = fields.scale?.[0] || '2'
      
      // Validate image type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
      if (!allowedTypes.includes(imageFile[0].mimetype)) {
        cleanupTempFile(imageFile[0].filepath)
        return res.status(400).json({
          status: false,
          message: "Format file tidak didukung. Gunakan: JPG, PNG, atau WEBP",
        })
      }

      tempFilePath = imageFile[0].filepath

      // Process upscale
      const result = await upscaleImage(tempFilePath, scale)

      // Cleanup temp file
      cleanupTempFile(tempFilePath)

      // Return response
      res.json({
        status: true,
        scale: result.scale,
        result: result.data,
        message: result.message,
        timestamp: Date.now(),
      })

    } catch (err) {
      // Cleanup temp file if exists
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }

      res.status(500).json({
        status: false,
        message: err.message || "Image upscale request failed"
      })
    }
  },
}
/**
 * Image Upscaler V3
 * Provider: imgupscaler.com
 * Parameter: image (file upload), scale (opsional: 2)
 * NO API KEY
 */

import formidable from "formidable"
import fs from "fs"
import axios from "axios"
import path from "path"

/* ===============================
   UPSCALER CONFIGURATION
================================ */
const SCALE_OPTIONS = ['2'] // Provider hanya mendukung scale 2

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Origin': 'https://imgupscaler.com',
  'Referer': 'https://imgupscaler.com/'
}

/* ===============================
   UPSCALER CLIENT CLASS
================================ */
class ImgUpscaler {
  constructor() {
    this.baseUrl = 'https://get1.imglarger.com'
    this.headers = { ...HEADERS }
  }

  async uploadImage(imagePath) {
    try {
      const form = new FormData()
      const filename = path.basename(imagePath)
      
      form.append('myfile', fs.createReadStream(imagePath), filename)
      form.append('scaleRadio', '2')

      const response = await axios.post(`${this.baseUrl}/api/UpscalerNew/UploadNew`, form, {
        headers: {
          ...this.headers,
          ...form.getHeaders()
        },
        maxBodyLength: Infinity,
        timeout: 60000 // 60 detik untuk upload
      })

      if (!response.data || !response.data.data || !response.data.data.code) {
        throw new Error("Invalid response from upload service")
      }

      return response.data
    } catch (error) {
      console.error("Upload Error:", error.message)
      throw new Error(`Failed to upload image: ${error.message}`)
    }
  }

  async checkStatus(code) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/UpscalerNew/CheckStatusNew`, {
        code: code,
        scaleRadio: 2
      }, {
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 detik untuk check status
      })

      return response.data
    } catch (error) {
      console.error("Check Status Error:", error.message)
      throw new Error(`Failed to check status: ${error.message}`)
    }
  }

  async waitForResult(code) {
    let result = null
    let attempts = 0
    const maxAttempts = 30 // Maksimal 30 percobaan (sekitar 1.5 menit)
    const delay = 3000 // 3 detik antar percobaan

    while (attempts < maxAttempts) {
      try {
        result = await this.checkStatus(code)
        
        // Cek berbagai kondisi sukses
        if (result.code === 200 && result.data) {
          // Jika ada download_url atau img_url, berarti sudah selesai
          if (result.data.download_url || result.data.img_url) {
            return result
          }
          
          // Jika status success
          if (result.data.status === 'success' || result.data.status === 'completed') {
            return result
          }
        }
        
        // Jika error
        if (result.code !== 200) {
          throw new Error(`Server returned error code: ${result.code}`)
        }
        
      } catch (error) {
        if (attempts === maxAttempts - 1) {
          throw error
        }
      }
      
      attempts++
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    
    throw new Error(`Timeout after ${maxAttempts * delay / 1000} seconds`)
  }

  async process(imagePath) {
    // Upload image
    const upload = await this.uploadImage(imagePath)
    
    if (!upload.data || !upload.data.code) {
      throw new Error("Failed to get upload code")
    }
    
    // Wait for processing result
    const result = await this.waitForResult(upload.data.code)
    
    return {
      success: true,
      code: upload.data.code,
      upload: upload,
      result: result,
      message: "Image successfully upscaled"
    }
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
  name: "Image Upscaler V3",
  description: "Image Upscaler V3",
  category: "Image HD",
  methods: ["POST"],
  params: ["image", "scale"],
  paramsSchema: {
    image: { 
      type: "file", 
      required: true, 
      description: "Image file to upscale (JPG, PNG, WEBP)" 
    },
    scale: { 
      type: "string", 
      required: false, 
      default: "2", 
      enum: SCALE_OPTIONS, 
      description: "Upscale factor (hanya 2 yang didukung)" 
    }
  },

  async run(req, res) {
    let tempFilePath = null
    const upscaler = new ImgUpscaler()

    try {
      // Parse form data with formidable
      const form = formidable({
        multiples: false,
        keepExtensions: true,
        maxFileSize: 20 * 1024 * 1024, // 20MB limit
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
      const result = await upscaler.process(tempFilePath)

      // Cleanup temp file
      cleanupTempFile(tempFilePath)

      // Extract download URL
      let downloadUrl = null
      if (result.result.data) {
        downloadUrl = result.result.data.download_url || result.result.data.img_url || null
      }

      // Return response
      res.json({
        status: true,
        code: result.code,
        download_url: downloadUrl,
        result: result.result,
        message: result.message,
        timestamp: Date.now(),
      })

    } catch (err) {
      // Cleanup temp file if exists
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }

      console.error("Upscaler V3 Error:", err)

      res.status(500).json({
        status: false,
        message: err.message || "Image upscale request failed",
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
      })
    }
  },
}
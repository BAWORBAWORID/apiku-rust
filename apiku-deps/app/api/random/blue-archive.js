/**
 * Random BLUE ARCHIVE API (Direct Image Response)
 * REAL anti-cache implementation
 *
 * Endpoint:
 *   GET /tools/BLUE ARCHIVE
 *
 * Result:
 *   - Browser langsung menampilkan gambar
 *   - Gambar SELALU berbeda
 *   - Tidak bisa di-cache (browser / proxy / CDN)
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

/* ===============================
   CORE FETCH LOGIC
================================ */
async function getRandomBlueArchiveImage() {
  try {
    const GIST_URL = "https://gist.githubusercontent.com/siputzx/e985e0566c0529df3a2289fd64047d21/raw/1568d9d26ee25dbe82fb0bdf51b5c88727e3f602/bluearchive.json"
    
    const { data: images } = await axios.get(GIST_URL, {
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    })

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("No image URLs found in the GIST.")
    }

    // Get random image data
    const randomImageData = images[Math.floor(Math.random() * images.length)]
    
    // If it's just a string URL, fetch the actual image
    if (typeof randomImageData === 'string') {
      const imageResponse = await axios.get(randomImageData, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      })
      
      return {
        buffer: imageResponse.data,
        url: randomImageData,
        type: imageResponse.headers['content-type'] || 'image/jpeg'
      }
    } else if (randomImageData.url) {
      // If it's an object with url property
      const imageResponse = await axios.get(randomImageData.url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      })
      
      return {
        buffer: imageResponse.data,
        url: randomImageData.url,
        type: imageResponse.headers['content-type'] || 'image/jpeg',
        metadata: randomImageData
      }
    } else {
      throw new Error("Invalid image data format")
    }
    
  } catch (error) {
    console.error("API Error:", error.message)
    throw new Error("Failed to get random Blue Archive image from API")
  }
}

/* ===============================
   EXPORT API MODULE
================================ */

export default {
  name: "random blue archive",
  description: "This API endpoint provides a random image from the popular game 'Blue Archive'. It fetches image URLs from a curated GitHub Gist and returns a binary image response. This can be used for various applications requiring random image content related to Blue Archive, such as fan-made apps, entertainment bots, or personal projects. The endpoint ensures a direct image delivery for seamless integration.",
  category: "Random",
  methods: ["GET"],
  params: [],

  sources: [
    {
      name: "GitHub Gist",
      url: "https://gist.github.com/siputzx/e985e0566c0529df3a2289fd64047d21",
      type: "image_urls"
    }
  ],

  async run(req, res) {
    try {
      logger.info(`[BLUE_ARCHIVE] Request IP=${req.ip}`)
      
      // Check if client wants JSON response
      const acceptHeader = req.headers.accept || ''
      const returnJson = req.query.format === 'json' || acceptHeader.includes('application/json')
      
      const imageData = await getRandomBlueArchiveImage()
      
      if (returnJson) {
        return res.json({
          status: true,
          result: {
            url: imageData.url,
            type: imageData.type,
            size: imageData.buffer.length,
            timestamp: Date.now(),
            metadata: imageData.metadata || null
          },
          timestamp: Date.now(),
        })
      }
      
      // Direct image response
      res.setHeader("Content-Type", imageData.type || "image/jpeg")
      res.setHeader("Content-Length", imageData.buffer.length)
      
      // KILL ALL CACHE (browser, proxy, CDN)
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
      res.setHeader("Pragma", "no-cache")
      res.setHeader("Expires", "0")
      res.setHeader("Surrogate-Control", "no-store")
      res.setHeader("X-Accel-Expires", "0") // For nginx
      
      // Security headers
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("X-Frame-Options", "DENY")
      res.setHeader("X-XSS-Protection", "1; mode=block")
      
      // Add random query param to prevent caching
      res.setHeader("Vary", "*")
      
      return res.end(imageData.buffer)
      
    } catch (err) {
      logger.error(`[BLUE_ARCHIVE_API_ERROR] ${err.message}`)

      return res.status(503).json({
        status: false,
        message: "BLUE ARCHIVE service unavailable",
        reason: err.message,
        timestamp: Date.now(),
        retry: "Try again in a few seconds"
      })
    }
  }
}
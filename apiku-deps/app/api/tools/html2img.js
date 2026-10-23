import { chromium } from "playwright"
import { Buffer } from "buffer"
import logger from "../../src/utils/logger.js"

/* ===============================
   HTML TO IMAGE CONVERTER
================================ */
async function convertHtmlToImage(htmlCode) {
  let browser = null
  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote"
      ],
    })

    const context = await browser.newContext()
    const page = await context.newPage()

    // Set viewport default
    await page.setViewportSize({ width: 1920, height: 1080 })

    // Load HTML
    await page.setContent(htmlCode.trim(), { 
      waitUntil: "networkidle",
      timeout: 30000 
    })

    // Wait 1 second for rendering
    await page.waitForTimeout(1000)

    // Take full page screenshot
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "png"
    })

    return Buffer.from(screenshotBuffer)

  } catch (error) {
    throw new Error(`Failed to convert HTML to image: ${error.message}`)
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "HTML to Image Converter",
  description: "Convert HTML code to PNG image directly",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["htmlCode"],

  paramsSchema: {
    htmlCode: {
      type: "string",
      required: true,
      description: "HTML code to convert to image",
      minLength: 1,
      maxLength: 50000,
      example: "<h1>Hello World!</h1><p style='color: blue;'>This is a test</p>"
    }
  },

  async run(req, res) {
    try {
      // Get HTML code from GET or POST
      let htmlCode = ""
      
      if (req.method === 'GET') {
        htmlCode = req.query.htmlCode || ""
      } else if (req.method === 'POST') {
        if (req.headers['content-type']?.includes('application/json')) {
          htmlCode = req.body?.htmlCode || ""
        } else {
          htmlCode = req.body?.htmlCode || ""
        }
      }

      // Validation
      if (!htmlCode || htmlCode.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'htmlCode' is required and cannot be empty"
        })
      }

      if (htmlCode.length > 50000) {
        return res.status(400).json({
          status: false,
          message: "HTML code too long (max 50000 characters)"
        })
      }

      logger.info(`[HTML2IMG] Request | ip=${req.ip} | length=${htmlCode.length}`)

      /* =======================================
         CONVERT HTML TO IMAGE
      ======================================= */
      const imageBuffer = await convertHtmlToImage(htmlCode)

      logger.info(`[HTML2IMG] Generated | ip=${req.ip} | size=${imageBuffer.length} bytes`)

      /* =======================================
         SEND IMAGE RESPONSE
      ======================================= */
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", imageBuffer.length)
      res.setHeader("Cache-Control", "public, max-age=3600, immutable")
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("X-Generated-At", new Date().toISOString())
      res.setHeader("Content-Disposition", "inline; filename=\"html-to-image.png\"")

      return res.send(imageBuffer)

    } catch (err) {
      logger.error(`[HTML2IMG] Error | ip=${req.ip} | error=${err.message}`)
      
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate image from HTML"
      })
    }
  }
}
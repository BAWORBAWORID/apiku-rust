/**
 * Screenshot Web API (Direct Image Response)
 *
 * GET /tools/ssweb?url=https://google.com&theme=light&device=desktop
 *
 * result: 
 * - Langsung menampilkan gambar PNG di browser
 */

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker'
import { Buffer } from 'buffer'
import logger from "../../src/utils/logger.js"

// Setup puppeteer dengan plugin stealth
puppeteer.use(StealthPlugin())
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))

const takeScreenshot = async (url, options = {}) => {
  let browser = null
  let page = null
  
  try {
    const {
      theme = "light",
      device = "desktop",
      delay = 1000,
      format = "png",
      quality = 80,
      fullPage = true
    } = options

    // Format URL
    const formattedUrl = url.startsWith('http') ? url : `https://${url}`
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      ignoreHTTPSErrors: true,
    })
    
    // Create page
    page = await browser.newPage()

    // Set user agent
    const defaultUserAgents = {
      desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      tablet: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    }

    const ua = defaultUserAgents[device] || defaultUserAgents.desktop
    await page.setUserAgent(ua)

    // Set viewport
    const viewportSizes = {
      desktop: { width: 1920, height: 1080 },
      mobile: { width: 375, height: 812, isMobile: true },
      tablet: { width: 768, height: 1024, isMobile: true }
    }

    await page.setViewport(viewportSizes[device] || viewportSizes.desktop)

    // Navigate ke URL
    await page.goto(formattedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })

    // Delay
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // Apply theme jika dark
    if (theme === 'dark') {
      await page.evaluate(() => {
        const style = document.createElement('style')
        style.textContent = `
          * {
            background-color: #1a1a1a !important;
            color: #ffffff !important;
          }
        `
        document.head.appendChild(style)
      })
      
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Take screenshot
    const screenshotOptions = {
      type: format,
      fullPage: fullPage,
      encoding: 'binary'
    }

    if (format === 'jpeg') {
      screenshotOptions.quality = quality
    }

    const screenshotBuffer = await page.screenshot(screenshotOptions)

    return Buffer.from(screenshotBuffer)

  } catch (error) {
    logger.error(`[SSWEB] Error: ${error.message}`)
    throw new Error(`Failed to take screenshot: ${error.message}`)
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

export default {
  name: "Screenshot Web",
  description: "Take website screenshots directly as image",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["url", "theme", "device", "delay", "format", "quality", "fullPage"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
    },
    theme: {
      type: "string",
      required: true,
      enum: ["light", "dark"],
      default: "light",
    },
    device: {
      type: "string",
      required: true,
      enum: ["desktop", "mobile", "tablet"],
      default: "desktop",
    },
    delay: {
      type: "number",
      default: 1000,
    },
    format: {
      type: "string",
      required: true,
      enum: ["png", "jpeg"],
      default: "png",
    },
    quality: {
      type: "number",
      min: 1,
      max: 100,
      default: 80,
    },
    fullPage: {
      type: "string",
      required: true,
      enum: ["true", "false"],
      default: "false",
    },
  },

  async run(req, res) {
    try {
      const { 
        url, 
        theme = "light", 
        device = "desktop",
        delay = 1000,
        format = "png",
        quality = 80,
        fullPage = true
      } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      // Konversi tipe data
      const options = {
        theme,
        device,
        delay: Number(delay),
        format,
        quality: Number(quality),
        fullPage: fullPage === 'true' || fullPage === true
      }

      logger.info(
        `[SSWEB] request | ip=${req.ip} | url=${url} | device=${device}`
      )

      /* =======================================
         GENERATE SCREENSHOT AS BUFFER
      ======================================= */
      const screenshotBuffer = await takeScreenshot(url, options)

      logger.info(
        `[SSWEB] screenshot sent | ip=${req.ip} | size=${screenshotBuffer.length}`
      )

      // Set header agar browser mengenali ini sebagai gambar
      res.setHeader("Content-Type", `image/${format}`)
      res.setHeader("Cache-Control", "public, max-age=3600")
      
      // Kirim buffer langsung
      return res.send(screenshotBuffer)

    } catch (err) {
      logger.error(
        `[SSWEB] Error | ip=${req.ip} | error=${err.message}`
      )
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate screenshot",
      })
    }
  },
}